"""P8: case agent. POST /case (SSE), /case/{id}/approve, /case/{id}/reject.

Planner/executor split: the model writes queries and the case; local code runs the queries and the model only
ever sees tokenized, capped aggregates. Nothing here injects errors: a repair happens only if Neo4j really fails."""
from __future__ import annotations

import hashlib
import json
import re
import uuid
from pathlib import Path

import jsonschema
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import config
import graphdb
import sse
from cypher_session import CypherSession
from gateway import GatewayBlocked, get_gateway, parse_json
from gateway.egress import canonical
from prompts import CASE_AGENT, CASE_OUTPUT, SCHEMA, TOOLS

router = APIRouter(tags=["case"])

MAX_TOOL_CALLS = 6
MAX_REPAIRS = 2
CASES: dict[str, dict] = {}
CASE_DIR = config.STATE_DIR / "cases"
_HEX64 = re.compile(r"^(?:0x)?[0-9a-f]{64}$", re.I)


class TriggerReq(BaseModel):
    trigger: dict


class ApproveReq(BaseModel):
    approver_id: str


class RejectReq(BaseModel):
    approver_id: str | None = None
    reason: str | None = None


# ---------------------------------------------------------------- persistence
def save_case(c: dict):
    CASES[c["case_id"]] = c
    try:
        CASE_DIR.mkdir(parents=True, exist_ok=True)
        (CASE_DIR / f"{c['case_id']}.json").write_text(json.dumps(c, ensure_ascii=False, default=str), encoding="utf-8")
    except Exception:
        pass


def get_case(case_id: str) -> dict | None:
    if case_id in CASES:
        return CASES[case_id]
    p = CASE_DIR / f"{case_id}.json"
    if p.exists():
        CASES[case_id] = json.loads(p.read_text(encoding="utf-8"))
        return CASES[case_id]
    return None


# ---------------------------------------------------------------- pure helpers (unit-tested)
def _citable(node_id: str, seen: set[str]) -> str | None:
    """Return the canonical id if the model's citation matches something it was actually shown."""
    if not isinstance(node_id, str):
        return None
    cands = [node_id, node_id.strip()]
    if ":" in node_id:
        cands.append(node_id.split(":", 1)[1])
    for c in cands:
        if c in seen:
            return c
        low = c.lower().removeprefix("0x")
        for s in seen:
            if isinstance(s, str) and s.lower().removeprefix("0x") == low and len(low) >= 8:
                return s
    return None


def strip_citations(case: dict, seen: set[str]) -> dict:
    """Drop cited ids the model never saw in a tool result; drop evidence left with nothing to cite."""
    stripped, ev_out = [], []
    for ev in case.get("evidence", []):
        ok = []
        for nid in ev.get("node_ids", []):
            c = _citable(nid, seen)
            if c is None:
                stripped.append(nid)
            elif c not in ok:
                ok.append(c)
        if ok:
            ev_out.append({**ev, "node_ids": ok})
        else:
            stripped.append(f"claim:{ev.get('claim', '')[:60]}")
    case["evidence"] = ev_out
    fps_ok = []
    for f in case.get("fingerprints_to_publish", []) or []:
        c = _citable(f, seen)
        if c and _HEX64.match(c):
            fps_ok.append(c.lower().removeprefix("0x"))
        else:
            stripped.append(f)
    if "fingerprints_to_publish" in case:
        case["fingerprints_to_publish"] = list(dict.fromkeys(fps_ok))
    if case.get("recommended_action") == "hold_and_publish" and not case.get("fingerprints_to_publish"):
        case["recommended_action"] = "hold"
        case.setdefault("open_questions", []).append(
            "Downgraded to hold: no cited fingerprints were available to publish.")
    case["stripped_citations"] = stripped
    return case


_RISK_NUM = {0: "low", 1: "low", 2: "medium", 3: "high"}


def coerce_output(obj):
    """Repair common type slips from the model (risk as a number, confidence as
    a string or 0-100 scale, enum case) before schema validation. Never adds
    content; only normalises representation."""
    if not isinstance(obj, dict):
        return obj
    r = obj.get("risk")
    if isinstance(r, (int, float)) and not isinstance(r, bool):
        obj["risk"] = _RISK_NUM.get(int(round(r)), "high" if r > 3 else "low")
    elif isinstance(r, str):
        obj["risk"] = r.strip().lower()
    c = obj.get("confidence")
    if isinstance(c, str):
        try:
            c = float(c.strip().rstrip("%"))
        except ValueError:
            c = {"low": 0.3, "medium": 0.6, "high": 0.85}.get(c.strip().lower(), c)
    if isinstance(c, (int, float)) and not isinstance(c, bool):
        obj["confidence"] = round(c / 100, 3) if c > 1 else c
    a = obj.get("recommended_action")
    if isinstance(a, str):
        obj["recommended_action"] = a.strip().lower()
    return obj


def validate_output(obj) -> None:
    jsonschema.validate(coerce_output(obj), CASE_OUTPUT)


RING_QUERY = (
    "MATCH (rm:Remitter {rmid:$rmid})-[:SENT]->(t:Transfer)-[:TO]->(a:Account) "
    "OPTIONAL MATCH (a)-[:HAS_FP]->(f:Fingerprint) "
    "OPTIONAL MATCH (a)<-[:HOLDS]-(:Record)-[:USES_PHONE|USES_DEVICE]->(x) "
    "RETURN rm.rmid AS rmid, a.iban AS iban, a.bank AS bank, count(DISTINCT t) AS transfers, "
    "sum(t.amount_pkr) AS pkr, min(t.ts) AS first_ts, max(t.ts) AS last_ts, "
    "collect(DISTINCT f.fp) + collect(DISTINCT x.h) AS fps")


def shared_ring_fps(rows) -> list[str]:
    by_fp: dict[str, set] = {}
    for r in rows:
        for f in r.get("fps") or []:
            by_fp.setdefault(f, set()).add(r["iban"])
    return sorted(f for f, v in by_fp.items() if len(v) >= 2)


def complete_publish_list(out: dict, trigger: dict, sess) -> list[str]:
    """Executor-side guard: when the model recommends hold_and_publish on a ring
    alert, publish every fingerprint shared by 2+ of the ring's accounts, not
    only the ones the model happened to list. Runs locally through the same
    read-only guard and integrity gate; nothing new is sent to the model."""
    if out.get("recommended_action") != "hold_and_publish" or trigger.get("type") != "ring_alert":
        return []
    refs = trigger.get("ref_ids") or []
    if not refs:
        return []
    rec = sess.execute(RING_QUERY, {"rmid": refs[0]})
    if not rec["ok"]:
        return []
    have = set(out.get("fingerprints_to_publish") or [])
    added = [f for f in shared_ring_fps(rec["rows"]) if f not in have]
    out["fingerprints_to_publish"] = sorted(have | set(added))
    return added


def decision_payload(case: dict, approver_hash: str) -> dict:
    return {
        "case_id": case["case_id"],
        "trigger": case["trigger"],
        "recommended_action": case["output"]["recommended_action"],
        "fingerprints_to_publish": sorted(case["output"].get("fingerprints_to_publish") or []),
        "evidence_leaves": {k: case["evidence_leaves"][k] for k in sorted(case["evidence_leaves"])},
        "egress_sha256": list(case.get("egress_hashes", [])),
        "model_version": case["model_version"],
        "graph_epoch": case["epoch"],
        "graph_root": case["root"],
        "approver_hash": approver_hash,
    }


def decision_hash(payload: dict) -> str:
    """SHA-256 over canonical JSON (sorted keys, no whitespace): identical inputs always give the same hash."""
    return hashlib.sha256(canonical(payload).encode("utf-8")).hexdigest()


def model_version() -> str:
    return hashlib.sha256(f"{config.LLM_PROVIDER}:{config.LLM_MODEL}".encode()).hexdigest()


# ---------------------------------------------------------------- the agent
def _trigger_message(gw, case_id: str, trigger: dict) -> str:
    refs = []
    for r in trigger.get("ref_ids", []):
        if re.fullmatch(r"PK\d{2}[A-Z0-9]{4}\d{16}", r, re.I):
            t = gw.token(case_id, "acct", r)
            refs.append(f"account {t} (query parameter ${t})")
        else:
            refs.append(f"id {r}")
    return (f"Case trigger: {trigger.get('type')}. References: {'; '.join(refs)}. Today is {config.TODAY}. "
            "Transfer.ts values are ISO-8601 datetimes. Investigate and recommend.")


def _tool_msg(call_id, payload) -> dict:
    return {"role": "tool", "tool_call_id": call_id, "content": json.dumps(payload, ensure_ascii=False, default=str)}


def _registry(gw, case_id, fp_raw: str) -> dict:
    from chain_client import get_chain
    try:
        r = get_chain().is_flagged(fp_raw.lower().removeprefix("0x"))
        return {"flagged": r["flagged"]}
    except Exception as e:
        return {"error": f"registry unavailable: {type(e).__name__}"}


def llm_investigation(gw, case_id, trigger, sess: CypherSession, s: sse.Steps):
    """Generator: yields UI events; returns (output_obj, info) through StopIteration.value."""
    messages = [{"role": "system", "content": CASE_AGENT + "\n\nGraph schema:\n" + SCHEMA},
                {"role": "user", "content": _trigger_message(gw, case_id, trigger)}]
    calls = repairs_in_chain = 0
    proposed = None
    summaries = []
    last_failed = False
    while calls < MAX_TOOL_CALLS:
        res = gw.complete(case_id, messages, tools=TOOLS, purpose="case_agent")
        yield s.ev("model", "ok", {"purpose": "case_agent", "egress_sha256": res.egress_sha256,
                                   "tool_calls": [c["name"] for c in res.tool_calls], "ms": res.ms})
        if not res.tool_calls:
            break
        messages.append({"role": "assistant", "content": res.content_tokens or None, "tool_calls": [
            {"id": c["id"], "type": "function",
             "function": {"name": c["name"], "arguments": json.dumps(c["arguments_tokens"], ensure_ascii=False)}}
            for c in res.tool_calls]})
        for c in res.tool_calls:
            if calls >= MAX_TOOL_CALLS:
                messages.append(_tool_msg(c["id"], {"error": "tool call budget exhausted; write the final case"}))
                continue
            calls += 1
            name, args = c["name"], c["arguments"]
            if name == "run_cypher":
                is_repair = last_failed
                rec = sess.execute(args.get("query", ""))
                data = {"attempt": rec["attempt"], "tool_call": calls, "query": rec["query"],
                        "purpose": args.get("purpose"), "repair": is_repair,
                        "repair_n": repairs_in_chain + 1 if is_repair else 0}
                if rec["ok"]:
                    last_failed, repairs_in_chain = False, 0
                    yield s.ev("cypher", "ok", {**data, "row_count": len(rec["rows"]), "rows": rec["rows"][:20]})
                    yield {**rec["gate"], "ms": 0}
                    messages.append(_tool_msg(c["id"], rec["view"]))
                    summaries.append({"purpose": args.get("purpose"), "result": rec["view"]})
                else:
                    last_failed = True
                    repairs_in_chain += 1 if is_repair else 0
                    yield s.ev("cypher", "error", {**data, "error": rec["error"]})
                    if repairs_in_chain >= MAX_REPAIRS:
                        messages.append(_tool_msg(c["id"], {"error": rec["error"],
                                                            "note": "repair limit reached; abandon this query"}))
                        last_failed, repairs_in_chain = False, 0
                    else:
                        messages.append(_tool_msg(c["id"], {"error": rec["error"]}))
            elif name == "get_registry_status":
                out = _registry(gw, case_id, args.get("fp", ""))
                yield s.ev("registry", "ok" if "error" not in out else "unavailable", out)
                messages.append(_tool_msg(c["id"], out))
            elif name == "propose_action":
                proposed = {"action": args.get("action"), "rationale": args.get("rationale")}
                yield s.ev("propose_action", "ok", proposed)
                messages.append(_tool_msg(c["id"], {"recorded": True}))
            else:
                messages.append(_tool_msg(c["id"], {"error": f"unknown tool {name}"}))

    # Final structured output. History is flattened to text so any OpenAI-compatible provider accepts it.
    ask = ("Produce the final case now as JSON matching CASE_OUTPUT (keys: trigger, narrative, narrative_ur, evidence "
           "[{claim,node_ids}], risk, recommended_action, fingerprints_to_publish, confidence, open_questions). "
           "Cite only ids that appear in the results below.\n\nTool results so far:\n"
           + json.dumps(summaries, ensure_ascii=False, default=str)
           + (f"\n\nYour proposed action: {json.dumps(proposed)}" if proposed else ""))
    fmsgs = [messages[0], messages[1], {"role": "user", "content": ask}]
    out, err = None, None
    for attempt in range(2):                         # validate, retry once
        res = gw.complete(case_id, fmsgs, json_schema=CASE_OUTPUT, purpose="case_output")
        yield s.ev("model", "ok", {"purpose": "case_output", "egress_sha256": res.egress_sha256, "ms": res.ms})
        try:
            cand = parse_json(res.content_tokens)
            validate_output(cand)
            out, err = gw.reidentify_obj(case_id, cand), None
            break
        except Exception as e:
            err = getattr(e, "message", str(e))
            yield s.ev("validate", "retry" if attempt == 0 else "error", {"error": err})
            fmsgs = fmsgs[:3] + [{"role": "assistant", "content": res.content_tokens},
                                 {"role": "user", "content": f"That output failed validation: {err}. Return corrected JSON only."}]
    if out is None:
        raise ValueError(f"CASE_OUTPUT validation failed twice: {err}")
    yield s.ev("validate", "ok", {"schema": "CASE_OUTPUT"})
    return out, {"mode": "llm", "tool_calls": calls}


def deterministic_investigation(gw, case_id, trigger, sess: CypherSession, s: sse.Steps):
    """No-LLM fallback with the same guard, gate and evidence rules. Used only when the model is unreachable."""
    refs = trigger.get("ref_ids", [])
    ttype = trigger.get("type")
    if ttype == "close_match" and len(refs) >= 2:
        rec = sess.execute("MATCH (rm:Remitter {rmid:$rmid})-[:SENT]->(t:Transfer)-[:TO]->(a:Account {iban:$iban}) "
                           "RETURN rm.rmid AS rmid, a.iban AS iban, count(t) AS transfers, sum(t.amount_pkr) AS pkr, "
                           "min(t.ts) AS first_ts, max(t.ts) AS last_ts", {"rmid": refs[0], "iban": refs[1]})
        yield s.ev("cypher", "ok" if rec["ok"] else "error", {"attempt": rec["attempt"], "query": rec["query"],
                   "error": rec["error"], "rows": rec["rows"][:20], "row_count": len(rec["rows"])})
        if rec["ok"] and rec["gate"]:
            yield {**rec["gate"], "ms": 0}
        row = rec["rows"][0] if rec["rows"] else {}
        n = row.get("transfers") or 0
        ev = [{"claim": f"{n} prior transfers from this remitter to this account, first {str(row.get('first_ts'))[:10]}, "
                        f"last {str(row.get('last_ts'))[:10]}", "node_ids": [x for x in (row.get("rmid"), row.get("iban")) if x]}] if n else []
        action = "proceed" if n >= 3 else "hold"
        out = {"trigger": f"Close name match for remitter {refs[0]}", "narrative":
               (f"{n} earlier transfers from the same remitter to this account were found, so the pattern is consistent "
                "with a repeat beneficiary. Recommend proceeding." if n >= 3 else
                "Little or no history links this remitter to this account. Evidence is thin; recommend hold."),
               "evidence": ev, "risk": "low" if n >= 3 else "medium", "recommended_action": action,
               "confidence": 0.8 if n >= 3 else 0.4, "open_questions": []}
        return out, {"mode": "deterministic", "tool_calls": 1}
    # ring alert
    rec = sess.execute(
        "MATCH (rm:Remitter {rmid:$rmid})-[:SENT]->(t:Transfer)-[:TO]->(a:Account) "
        "OPTIONAL MATCH (a)-[:HAS_FP]->(f:Fingerprint) "
        "OPTIONAL MATCH (a)<-[:HOLDS]-(:Record)-[:USES_PHONE|USES_DEVICE]->(x) "
        "RETURN rm.rmid AS rmid, a.iban AS iban, a.bank AS bank, count(DISTINCT t) AS transfers, "
        "sum(t.amount_pkr) AS pkr, min(t.ts) AS first_ts, max(t.ts) AS last_ts, "
        "collect(DISTINCT f.fp) + collect(DISTINCT x.h) AS fps", {"rmid": refs[0]})
    yield s.ev("cypher", "ok" if rec["ok"] else "error", {"attempt": rec["attempt"], "query": rec["query"],
               "error": rec["error"], "rows": rec["rows"][:20], "row_count": len(rec["rows"])})
    if not rec["ok"]:
        raise RuntimeError(rec["error"])
    yield {**rec["gate"], "ms": 0}
    rows = rec["rows"]
    from datetime import datetime
    by_fp: dict[str, set] = {}
    for r in rows:
        for f in r.get("fps") or []:
            by_fp.setdefault(f, set()).add(r["iban"])
    shared = {f: a for f, a in by_fp.items() if len(a) >= 3}
    ts = [datetime.fromisoformat(x[:19]) for r in rows for x in (r["first_ts"], r["last_ts"]) if x]
    hours = (max(ts) - min(ts)).total_seconds() / 3600 if ts else None
    banks = sorted({r["bank"] for r in rows})
    total = sum(r["pkr"] or 0 for r in rows)
    clustered = hours is not None and hours <= 72
    action = "hold_and_publish" if shared and clustered else "hold"
    ev = [{"claim": f"{len(rows)} beneficiary accounts across {len(banks)} banks ({', '.join(banks)}), PKR {total:,} in total",
           "node_ids": [r["rmid"] for r in rows[:1]] + [r["iban"] for r in rows]}]
    if shared:
        multi = sorted(f for f, v in by_fp.items() if len(v) >= 2)
        ev.append({"claim": f"{len(multi)} fingerprints are shared by 2 or more beneficiary accounts, "
                            f"{len(shared)} by 3 or more", "node_ids": multi})
    if hours is not None:
        ev.append({"claim": f"All transfers fall within {hours:.0f} hours", "node_ids": [rows[0]["rmid"]]})
    out = {"trigger": f"Ring alert for remitter {refs[0]}",
           "narrative": (f"{len(rows)} beneficiaries at {len(banks)} banks share {len(shared)} fingerprints; transfers "
                         f"cluster within {hours:.0f} hours. Hold pending review" +
                         ("; publish the shared fingerprints to the consortium registry." if action == "hold_and_publish" else ".")),
           "evidence": ev, "risk": "high" if action == "hold_and_publish" else "medium", "recommended_action": action,
           "fingerprints_to_publish": sorted(f for f, v in by_fp.items() if len(v) >= 2) if action == "hold_and_publish" else [],
           "confidence": 0.85 if shared else 0.5, "open_questions": []}
    return out, {"mode": "deterministic", "tool_calls": 1}


def _key_of(eid: str) -> str:
    if ":" not in eid:
        return eid
    label, _, rest = eid.partition(":")
    return rest.split(":", 1)[1] if label == "Fingerprint" and ":" in rest else rest


def build_integrity(element_ids) -> dict | None:
    """UI Integrity object for a set of evidence elements (nodes only), proven against the on-chain root."""
    from integrity.routes import get_integrity
    ids = sorted(i for i in element_ids if ">" not in i)
    if not ids:
        return None
    try:
        integ = get_integrity()
        proof = integ.prove(ids)
        last = integ.store.latest_epoch() or {}
    except Exception:
        return None
    items = [{"id": _key_of(i["element_id"]), "element_id": i["element_id"], "label": i["element_id"].split(":")[0],
              "leaf": (i["leaf_epoch"] or i["leaf_current"] or "")[:16], "status": i["status"]} for i in proof["items"]]
    return {"verified": proof["verified"], "total": proof["total"], "epoch": proof["epoch"], "root": proof["root"],
            "block": last.get("block"), "items": items}


def run_case(trigger: dict, force_deterministic: bool = False, case_id: str | None = None, emit_start: bool = True,
             extra_ids=()):
    s = sse.Steps()
    gw = get_gateway()
    case_id = case_id or "case-" + uuid.uuid4().hex[:10]
    sess = CypherSession(gw, case_id)
    if emit_start:
        yield s.ev("start", "ok", {"case_id": case_id, "trigger": trigger, "max_tool_calls": MAX_TOOL_CALLS})
    info = {}
    out = None
    try:
        if force_deterministic:
            raise RuntimeError("deterministic requested")
        out, info = yield from llm_investigation(gw, case_id, trigger, sess, s)
    except GatewayBlocked as e:
        yield s.ev("gateway", "blocked", {"error": str(e), "kinds": e.kinds})
        yield s.ev("final", "error", {"error": str(e), "case_id": case_id})
        return
    except Exception as e:
        yield s.ev("model", "unavailable", {"error": f"{type(e).__name__}: {str(e)[:200]}",
                                            "fallback": "deterministic investigator (same guard, gate and evidence rules)"})
        sess = CypherSession(gw, case_id)
        out, info = yield from deterministic_investigation(gw, case_id, trigger, sess, s)
    added = complete_publish_list(out, trigger, sess)
    if added:
        yield s.ev("publish_list", "ok", {"added": [f[:16] for f in added],
                                          "note": "all fingerprints shared by 2+ ring accounts"})
    out = strip_citations(out, sess.seen)
    yield s.ev("evidence", "ok", {"items": len(out["evidence"]), "stripped": out["stripped_citations"]})
    stripped = out.pop("stripped_citations")
    case = {"case_id": case_id, "status": "pending", "trigger": trigger, "output": out, "stripped_citations": stripped,
            "epoch": sess.epoch, "root": sess.root, "evidence_leaves": sess.leaves,
            "excluded_elements": sorted(sess.excluded), "egress_hashes": gw.egress.hashes(case_id),
            "model_version": model_version(), "mode": info.get("mode"), "tool_calls": info.get("tool_calls"),
            "cypher_attempts": [{k: a[k] for k in ("attempt", "query", "ok", "error")} for a in sess.attempts]}
    if sess.excluded:
        out.setdefault("open_questions", []).append(
            f"{len(sess.excluded)} facts excluded: changed after epoch {sess.epoch}.")
    save_case(case)
    integrity = build_integrity(set(sess.leaves) | set(extra_ids) | sess.excluded)
    yield s.ev("final", "ok", {**out, "id": case_id, "case_id": case_id, "integrity": integrity, "case": out,
                               "epoch": sess.epoch, "root": sess.root,
                               "evidence_leaves": sess.leaves, "excluded_elements": case["excluded_elements"],
                               "egress_hashes": case["egress_hashes"], "mode": case["mode"],
                               "stripped_citations": stripped, "cypher_attempts": case["cypher_attempts"]})


def _cache_name(trigger: dict) -> str | None:
    refs = trigger.get("ref_ids", [])
    for sid, key in (("S2", "RM-S2"), ("S5", "RM-S5")):
        if key in refs:
            return f"case-{sid}"
    return None


def _register_replay(events: list[dict]):
    fin = events[-1] if events else None
    if fin and fin.get("step") == "final" and fin["data"].get("case"):
        d = fin["data"]
        save_case({"case_id": d["case_id"], "status": "pending", "trigger": {}, "output": d["case"],
                   "epoch": d.get("epoch"), "root": d.get("root"), "evidence_leaves": d.get("evidence_leaves", {}),
                   "egress_hashes": d.get("egress_hashes", []), "model_version": model_version(), "replayed": True})


@router.post("/case")
def post_case(req: TriggerReq):
    return sse.stream(lambda: run_case(req.trigger), _cache_name(req.trigger), on_replay=_register_replay)


def run_reverify(case_id: str):
    c = get_case(case_id)
    s = sse.Steps()
    ids = sorted(c["evidence_leaves"])
    integ = build_integrity(ids)
    bad = []
    if integ:
        bad = [i for i in integ["items"] if i["status"] != "verified"]
        n = len(bad)
        text = (f"{n} fact{'s' if n != 1 else ''} excluded: changed after epoch {integ['epoch']}" if bad
                else f"{integ['verified']} of {integ['total']} evidence items verified against epoch {integ['epoch']}")
        yield s.ev("integrity", "excluded" if bad else "ok", {**integ, "text": text})
    else:
        yield s.ev("integrity", "ok", {"text": "nothing to verify"})
    if not bad:
        yield s.ev("final", "ok", {**c["output"], "id": case_id, "case_id": case_id, "integrity": integ})
        return
    yield s.ev("rerun", "info", {"text": "agent re-running with verified context only"})
    trig = c.get("trigger") or {}
    if not trig.get("type"):
        yield s.ev("final", "error", {"error": "case has no stored trigger to re-run"})
        return
    for e in run_case(trig, case_id=case_id, emit_start=False, extra_ids=ids):
        yield e


@router.post("/case/{case_id}/reverify")
def reverify(case_id: str):
    if not get_case(case_id):
        raise HTTPException(404, "unknown case")
    return sse.stream(lambda: run_reverify(case_id))


@router.get("/case/{case_id}")
def read_case(case_id: str):
    c = get_case(case_id)
    if not c:
        raise HTTPException(404, "unknown case")
    return c


# ---------------------------------------------------------------- approve / reject
def fp_kind(fp: str) -> int:
    try:
        rows = graphdb.run_read(
            "MATCH (n) WHERE n.h=$fp OR n.fp=$fp RETURN labels(n)[0] AS l, n.kind AS k LIMIT 1", {"fp": fp})
        if rows:
            l, k = rows[0]["l"], rows[0]["k"]
            return config.KINDS.get(k or l.lower(), 1)
    except Exception:
        pass
    return config.KINDS["phone"]


@router.post("/case/{case_id}/approve")
def approve(case_id: str, req: ApproveReq):
    from chain_client import ChainUnavailable, get_chain
    from integrity.routes import get_integrity
    c = get_case(case_id)
    if not c:
        raise HTTPException(404, "unknown case")
    if c["status"] != "pending":
        raise HTTPException(409, f"case already {c['status']}")
    integ, chain = get_integrity(), get_chain()
    ids = sorted(c["evidence_leaves"])
    proof = integ.prove(ids) if ids else {"items": [], "epoch": None, "root": None}
    bad = [i for i in proof["items"] if i["status"] != "verified"]
    if bad:
        return JSONResponse(status_code=409, content={
            "error": "evidence changed after the committed epoch; refusing to anchor",
            "changed": [{"element_id": i["element_id"], "status": i["status"]} for i in bad],
            "epoch": proof["epoch"]})
    if not chain.available():
        raise HTTPException(503, "chain unavailable")
    epoch, root = (proof["epoch"], proof["root"]) if ids else chain.latest_root()
    approver_hash = hashlib.sha256(req.approver_id.encode()).hexdigest()
    c["epoch"], c["root"] = epoch, root
    payload = decision_payload(c, approver_hash)
    dh = decision_hash(payload)
    action = c["output"]["recommended_action"]
    band = 2 if c.get("trigger", {}).get("type") == "close_match" else 3
    try:
        anchor = chain.anchor(dh, c["model_version"], root, epoch, band, config.ACTIONS[action], approver_hash)
        published = []
        if action == "hold_and_publish":
            for fp in c["output"].get("fingerprints_to_publish", []):
                kind_i = fp_kind(fp)
                tx = chain.publish(fp, kind_i, config.BANK_IDS[config.HOST_BANK])
                published.append({"fp": fp[:16], "tx": tx["tx"], "block": tx["block"],
                                  "kind": {v: k for k, v in config.KINDS.items()}.get(kind_i)})
    except ChainUnavailable as e:
        raise HTTPException(503, str(e))
    c.update(status="approved", decision_hash=dh, approver_hash=approver_hash, anchor=anchor, published=published)
    # Decision node, then a new epoch that includes it.
    did = f"D-{anchor['id']}"
    refs = c.get("trigger", {}).get("ref_ids", [])
    try:
        graphdb.run_write(
            "MERGE (d:Decision {did:$did}) SET d.hash=$h, d.band=$band, d.action=$action, d.approver=$ap, "
            "d.ts=datetime(), d.tx=$tx WITH d UNWIND $refs AS ref "
            "OPTIONAL MATCH (n) WHERE n.rmid=ref OR n.iban=ref WITH d, n WHERE n IS NOT NULL "
            "MERGE (d)-[:ABOUT]->(n)",
            {"did": did, "h": dh, "band": band, "action": action, "ap": approver_hash[:16], "tx": anchor["tx"],
             "refs": refs})
        commit = integ.commit()
    except Exception as e:
        commit = {"error": f"{type(e).__name__}: {e}"}
    save_case(c)
    import datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    is_ring = c.get("trigger", {}).get("type") == "ring_alert"
    blocks = [{"id": anchor["block"], "kind": "decision", "hash": "0x" + dh, "tx": anchor["tx"],
               "band": "RING" if is_ring else "CLOSE", "action": action, "approver": req.approver_id,
               "epoch": epoch, "ts": now,
               "detail": {"event": "DecisionLog.Anchored", "decision_id": anchor["id"], "case": case_id}}]
    for pb in published:
        full = next((f for f in c["output"].get("fingerprints_to_publish", []) if f.startswith(pb["fp"])), pb["fp"])
        blocks.append({"id": pb["block"], "kind": "publish", "hash": "0x" + full, "tx": pb["tx"],
                       "bank": config.HOST_BANK, "fp": pb["fp"], "fpKind": pb.get("kind"), "ts": now,
                       "detail": {"event": "MuleRegistry.Published"}})
    if commit.get("tx"):
        blocks.append({"id": commit["block"], "kind": "commit", "hash": commit["root"], "tx": commit["tx"],
                       "epoch": commit["epoch"], "ts": now, "detail": {"event": "GraphRootLog.Committed"}})
    return {"blocks": blocks, "case_id": case_id, "status": "approved", "decision_id": anchor["id"], "decision_hash": dh,
            "anchor_tx": anchor["tx"], "anchor_block": anchor["block"], "published": published,
            "epoch_anchored": epoch, "graph_root": root, "new_epoch": commit,
            "verified": f"{proof['verified']} of {proof['total']} evidence items verified against epoch {epoch}" if ids else None}


@router.post("/case/{case_id}/reject")
def reject(case_id: str, req: RejectReq | None = None):
    c = get_case(case_id)
    if not c:
        raise HTTPException(404, "unknown case")
    if c["status"] != "pending":
        raise HTTPException(409, f"case already {c['status']}")
    c.update(status="rejected", reject_reason=(req.reason if req else None))
    save_case(c)
    return {"case_id": case_id, "status": "rejected"}
