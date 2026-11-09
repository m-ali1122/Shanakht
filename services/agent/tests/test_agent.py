import json
import uuid
from types import SimpleNamespace

import jsonschema
import pytest

import case_agent
import sse
from cypher_guard import UnsafeCypher, guard
from cypher_session import CypherSession
from gateway.egress import EgressLog
from gateway.gateway import Gateway
from gateway.vault import Vault
from modelview import model_view

IBAN = "PK36RAVI0000000000020001"


# ---------------------------------------------------------------- guard
@pytest.mark.parametrize("q", [
    "CREATE (n:X) RETURN n", "MATCH (n) SET n.a=1 RETURN n", "MATCH (n) DETACH DELETE n RETURN 1",
    "MERGE (n:X) RETURN n", "MATCH (n) REMOVE n.a RETURN n", "DROP INDEX x", "LOAD CSV FROM 'x' AS r RETURN r",
    "CALL dbms.listConfig() YIELD name RETURN name", "MATCH (n) RETURN n; MATCH (m) RETURN m", "MATCH (n)",
    "CALL apoc.periodic.iterate('a','b',{}) RETURN 1",
])
def test_guard_rejects_writes_and_unsafe(q):
    with pytest.raises(UnsafeCypher):
        guard(q)


def test_guard_allows_reads_and_forces_limit():
    assert guard("MATCH (n:Account) RETURN n.iban").endswith("LIMIT 200")
    assert guard("MATCH (n) RETURN n LIMIT 5").endswith("LIMIT 5")
    assert guard("MATCH (n) RETURN n LIMIT 99999").endswith("LIMIT 200")
    assert "CREATE" in guard("MATCH (n) WHERE n.t = 'CREATE me' RETURN n")   # keyword inside a string literal is fine
    assert guard("```cypher\nMATCH (n) RETURN n;\n```").endswith("LIMIT 200")
    assert guard("MATCH (n) RETURN n.x AS created_at LIMIT 3")                # identifiers containing keywords


# ---------------------------------------------------------------- fakes
class ScriptedAdapter:
    provider, model = "fake", "fake-1"

    def __init__(self, replies):
        self.replies, self.sent = list(replies), []

    def build_request(self, messages, tools=None, json_schema=None):
        return {"model": self.model, "messages": messages, "tools": tools or []}

    def complete(self, messages, tools=None, json_schema=None, request=None):
        self.sent.append(json.dumps(request, ensure_ascii=False))
        return self.replies.pop(0)


def tc(name, **args):
    return {"id": "c" + uuid.uuid4().hex[:6], "name": name, "arguments": json.dumps(args)}


def reply(calls=None, content=""):
    return {"content": content, "tool_calls": calls or [], "usage": {}}


def make_gw(tmp_path, replies):
    return Gateway(Vault(tmp_path / "v.sqlite", "k"), EgressLog(tmp_path / "e.sqlite"), ScriptedAdapter(replies))


def gate_ok(rows):
    ids = sorted({v for r in rows for v in r.values() if isinstance(v, str)})
    return SimpleNamespace(rows=rows, excluded_rows=0, excluded_elements=[], note="", epoch=3, root="0xabc",
                           leaves={f"X:{i}": "leaf-" + i for i in ids},
                           step={"step": "integrity", "status": "ok", "data": {"verified": len(ids), "total": len(ids)}})


GOOD = {"trigger": "close match", "narrative": "n", "evidence": [{"claim": "c", "node_ids": ["RM-S2"]}],
        "risk": "low", "recommended_action": "proceed", "confidence": 0.8}


def drive(gen):
    events = []
    try:
        while True:
            events.append(next(gen))
    except StopIteration as e:
        return events, e.value


# ---------------------------------------------------------------- repair loop
def test_repair_loop_emits_both_attempts_and_model_sees_error(tmp_path):
    gw = make_gw(tmp_path, [
        reply([tc("run_cypher", query="MATCH (rm:Remitter {rmid:'RM-S2'}) RETRN rm.rmid")]),
        reply([tc("run_cypher", query="MATCH (rm:Remitter {rmid:'RM-S2'}) RETURN rm.rmid AS rmid")]),
        reply(),                                              # model stops calling tools
        reply(content=json.dumps(GOOD)),                      # final CASE_OUTPUT
    ])
    calls = []

    def runner(q, params):
        calls.append(q)
        if "RETRN" in q:
            raise RuntimeError("Invalid input 'RETRN': expected RETURN")
        return [{"rmid": "RM-S2"}]

    sess = CypherSession(gw, "c1", runner=runner, gate=gate_ok)
    # guard rejects the typo query before the runner (no RETURN) -> genuine failure path with a real error message
    events, (out, info) = drive(case_agent.llm_investigation(gw, "c1", {"type": "close_match", "ref_ids": ["RM-S2", IBAN]},
                                                             sess, sse.Steps()))
    cy = [e for e in events if e["step"] == "cypher"]
    assert [e["status"] for e in cy] == ["error", "ok"]
    assert cy[1]["data"]["repair"] is True and cy[1]["data"]["repair_n"] == 1
    assert "RETURN" in cy[0]["data"]["error"]
    assert out["recommended_action"] == "proceed" and info["tool_calls"] == 2
    assert "must RETURN" in gw.adapter.sent[1]                 # the model was shown the real error
    assert [a["ok"] for a in sess.attempts] == [False, True]


def test_repair_limit_two_then_abandon(tmp_path):
    bad = reply([tc("run_cypher", query="MATCH (n) WHERE RETURN n")])
    gw = make_gw(tmp_path, [bad, bad, bad, reply(), reply(content=json.dumps(GOOD))])

    def runner(q, p):
        raise RuntimeError("Syntax error")
    sess = CypherSession(gw, "c2", runner=runner, gate=gate_ok)
    events, _ = drive(case_agent.llm_investigation(gw, "c2", {"type": "ring_alert", "ref_ids": ["RM-S5"]}, sess, sse.Steps()))
    assert len(sess.attempts) == 3                             # original + 2 repairs
    assert "abandon" in gw.adapter.sent[3]


def test_max_six_tool_calls(tmp_path):
    q = "MATCH (n) RETURN n.rid AS rid"
    gw = make_gw(tmp_path, [reply([tc("run_cypher", query=q)] * 4), reply([tc("run_cypher", query=q)] * 4),
                            reply(content=json.dumps(GOOD))])
    sess = CypherSession(gw, "c3", runner=lambda q, p: [{"rid": "R-1"}], gate=gate_ok)
    _, (_, info) = drive(case_agent.llm_investigation(gw, "c3", {"type": "ring_alert", "ref_ids": ["RM-S5"]}, sess, sse.Steps()))
    assert info["tool_calls"] == 6 and len(sess.attempts) == 6


# ---------------------------------------------------------------- schema validation
def test_schema_validation_and_single_retry(tmp_path):
    bad = {"trigger": "x", "narrative": "n", "evidence": [], "risk": "extreme", "recommended_action": "freeze", "confidence": 3}
    with pytest.raises(jsonschema.ValidationError):
        case_agent.validate_output(bad)
    gw = make_gw(tmp_path, [reply(), reply(content=json.dumps(bad)), reply(content=json.dumps(GOOD))])
    sess = CypherSession(gw, "c4", runner=lambda q, p: [], gate=gate_ok)
    events, (out, _) = drive(case_agent.llm_investigation(gw, "c4", {"type": "close_match", "ref_ids": ["RM-S2"]}, sess, sse.Steps()))
    assert [e["status"] for e in events if e["step"] == "validate"] == ["retry", "ok"]
    assert out["recommended_action"] == "proceed"
    gw2 = make_gw(tmp_path, [reply(), reply(content=json.dumps(bad)), reply(content=json.dumps(bad))])
    sess2 = CypherSession(gw2, "c5", runner=lambda q, p: [], gate=gate_ok)
    with pytest.raises(ValueError):
        drive(case_agent.llm_investigation(gw2, "c5", {"type": "close_match", "ref_ids": ["RM-S2"]}, sess2, sse.Steps()))


# ---------------------------------------------------------------- planner/executor split
def test_model_never_sees_row_values(tmp_path):
    gw = make_gw(tmp_path, [
        reply([tc("run_cypher", query="MATCH (a:Account) RETURN a.iban AS iban, a.title_raw AS title_raw, a.h AS h")]),
        reply(), reply(content=json.dumps(GOOD))])
    fp = "ab" * 32
    rows = [{"iban": IBAN, "title_raw": "MUHAMMAD ALI", "h": fp, "rid": "R-MRGL-S2-1"}]
    sess = CypherSession(gw, "c6", runner=lambda q, p: rows, gate=gate_ok)
    drive(case_agent.llm_investigation(gw, "c6", {"type": "close_match", "ref_ids": ["RM-S2", IBAN]}, sess, sse.Steps()))
    sent = " ".join(gw.adapter.sent)
    assert IBAN not in sent and "MUHAMMAD ALI" not in sent and fp not in sent
    assert "ACCT_1" in sent and "R-MRGL-S2-1" in sent          # tokens and non-PII node ids only


def test_model_view_caps_rows_and_tokenizes(tmp_path):
    gw = make_gw(tmp_path, [])
    v = model_view(gw, "c7", [{"iban": IBAN, "n": 9_999_999_999_999, "x": "Faisal Nawaz"} for _ in range(40)])
    assert v["row_count"] == 40 and len(v["rows"]) == 25 and v["truncated"]
    s = json.dumps(v)
    assert IBAN not in s and "9999999999999" not in s and "Faisal" not in s


# ---------------------------------------------------------------- citation stripping
def test_citation_stripping():
    seen = {"RM-S5", "R-MRGL-S5-1", IBAN, "ab" * 32}
    case = {"evidence": [{"claim": "ok", "node_ids": ["RM-S5", "Account:" + IBAN, "R-INVENTED-9"]},
                         {"claim": "all invented", "node_ids": ["R-NOPE"]}],
            "fingerprints_to_publish": ["ab" * 32, "cd" * 32], "recommended_action": "hold_and_publish"}
    out = case_agent.strip_citations(case, seen)
    assert out["evidence"] == [{"claim": "ok", "node_ids": ["RM-S5", IBAN]}]
    assert out["fingerprints_to_publish"] == ["ab" * 32]
    assert "R-INVENTED-9" in out["stripped_citations"] and "R-NOPE" in out["stripped_citations"]
    assert out["recommended_action"] == "hold_and_publish"
    out2 = case_agent.strip_citations({"evidence": [], "fingerprints_to_publish": ["cd" * 32],
                                       "recommended_action": "hold_and_publish"}, seen)
    assert out2["recommended_action"] == "hold"                # nothing legitimate to publish


# ---------------------------------------------------------------- decision hash
def test_decision_hash_is_deterministic_and_sensitive():
    case = {"case_id": "case-1", "trigger": {"type": "ring_alert", "ref_ids": ["RM-S5"]}, "epoch": 4, "root": "0x" + "11" * 32,
            "evidence_leaves": {"b": "2", "a": "1"}, "egress_hashes": ["h1", "h2"], "model_version": "mv",
            "output": {"recommended_action": "hold_and_publish", "fingerprints_to_publish": ["bb", "aa"]}}
    p1 = case_agent.decision_payload(case, "appr")
    reordered = dict(case, evidence_leaves={"a": "1", "b": "2"})
    h1 = case_agent.decision_hash(p1)
    assert h1 == case_agent.decision_hash(case_agent.decision_payload(reordered, "appr"))
    assert h1 == case_agent.decision_hash(json.loads(json.dumps(p1)))
    assert len(h1) == 64
    assert h1 != case_agent.decision_hash(case_agent.decision_payload(case, "other-approver"))
    case["evidence_leaves"]["a"] = "tampered"
    assert h1 != case_agent.decision_hash(case_agent.decision_payload(case, "appr"))


def test_coerce_output_repairs_type_slips():
    from case_agent import coerce_output, validate_output
    o = {"trigger": "t", "narrative": "n", "evidence": [], "risk": 3,
         "recommended_action": "HOLD", "confidence": "85%"}
    validate_output(o)
    assert o["risk"] == "high" and o["recommended_action"] == "hold" and o["confidence"] == 0.85


def test_publish_list_adds_all_shared_ring_fps():
    from case_agent import complete_publish_list

    class S:
        def execute(self, q, p):
            return {"ok": True, "rows": [
                {"iban": "A", "fps": ["ph1", "dv1"]}, {"iban": "B", "fps": ["ph1", "dv1"]},
                {"iban": "C", "fps": ["ph1", "solo"]}]}
    out = {"recommended_action": "hold_and_publish", "fingerprints_to_publish": ["ph1"]}
    added = complete_publish_list(out, {"type": "ring_alert", "ref_ids": ["RM-S5"]}, S())
    assert added == ["dv1"] and out["fingerprints_to_publish"] == ["dv1", "ph1"]
    out2 = {"recommended_action": "hold", "fingerprints_to_publish": []}
    assert complete_publish_list(out2, {"type": "ring_alert", "ref_ids": ["RM-S5"]}, S()) == []
