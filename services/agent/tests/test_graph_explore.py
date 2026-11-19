import json

import pytest

import config
import graph_explore as gx
import sse

HOST_REC = {"rid": "R-MRGL-S5-1", "bank": "MRGL", "raw_name": "Usman Ghani", "urdu_name": "عثمان غنی",
            "phone": "0300-5550505", "device": "dev-1", "cnic_syn": "12345-1234567-1", "script": "urdu"}
PARTNER_ACCT = {"iban": "PK36RAVI0000000000050003", "bank": "RAVI", "title_raw": "BILAL AHMED"}
PARTNER_REC = {"rid": "R-RAVI-S5-3", "bank": "RAVI", "raw_name": "Bilal Ahmed", "urdu_name": "بلال احمد"}


# ---------------------------------------------------------------- privacy
def test_partner_nodes_never_carry_names():
    for label, p in (("Account", PARTNER_ACCT), ("Record", PARTNER_REC)):
        assert gx.is_partner(label, p)
        props = gx.safe_props(label, p)
        assert set(props) <= {"iban", "rid", "bank"}
        n = gx.gnode(gx.ui_id(label, p), label, p)
        assert "Bilal" not in n["label"] and "BILAL" not in n["label"] and n["hollow"]
        assert n["bank"] == "RAVI"


def test_host_record_keeps_names_but_drops_raw_identifiers():
    props = gx.safe_props("Record", HOST_REC)
    assert props["raw_name"] == "Usman Ghani" and props["urdu_name"]
    assert not {"phone", "device", "cnic_syn"} & set(props)
    assert gx.gnode("R-MRGL-S5-1", "Record", HOST_REC)["label"] == "Usman Ghani"


def test_ui_ids():
    assert gx.ui_id("Phone", {"h": "ab"}) == "ph:ab"
    assert gx.ui_id("Device", {"h": "cd"}) == "dv:cd"
    assert gx.ui_id("Fingerprint", {"fp": "ef", "bank": "RAVI"}) == "fp:ef"
    assert gx.ui_id("Account", PARTNER_ACCT) == "PK36RAVI0000000000050003"
    assert gx._split_ids(["ph:1", "dv:2", "fp:3", "RM-S5"]) == (["RM-S5"], ["1"], ["2"], ["3"])


# ---------------------------------------------------------------- provenance templates
def test_provenance_templates():
    p = gx.provenance("HOLDS", {"bank": "MRGL", "rid": "R-1", "iban": "PK..."})
    assert p["title"] == "Record holds account" and "MRGL" in p["cause"] and p["origin"] == "MRGL KYC file"
    p = gx.provenance("USES_PHONE", {"bank": "MRGL", "hash": "e7edcb403e8aea", "records": 2,
                                     "banks": ["INDS", "MRGL", "RAVI"], "partner_accounts": 3})
    assert p["title"] == "Shared phone" and "INDS, RAVI" in p["cause"] and "2 records" in p["cause"]
    assert {"k": "Hash", "v": "e7edcb403e8a"} in p["evidence"]
    p = gx.provenance("RESOLVES_TO", {"score": 0.9123})
    assert p["title"] == "Same person" and "0.91" in p["cause"]
    p = gx.provenance("HAS_FP", {"bank": "RAVI", "kind": "device", "batch": "B-RAVI-1", "accounts": 2})
    assert p["title"] == "Partner fingerprint" and "RAVI contributed a signed HMAC fingerprint (device)" in p["cause"]
    p = gx.provenance("SAME_AS", {"kind": "phone", "banks": ["MRGL", "RAVI"]})
    assert p["title"] == "Fingerprint match" and "RAVI" in p["cause"]
    p = gx.provenance("SENT", {"count": 3, "first": "2026-10-14T08:30:00Z", "last": "2026-10-15T09:00:00Z"})
    assert p["title"] == "Transfers" and p["cause"].startswith("3 transfers") and "2026-10-14 to 2026-10-15" in p["cause"]
    assert gx.provenance("SENT", {"count": 1})["cause"].startswith("1 transfer ")
    p = gx.provenance("ABOUT", {})
    assert p["title"] == "About" and p["origin"] == "Shanakht graph"
    # missing facts never produce empty evidence rows
    assert gx.provenance("HOLDS", {})["evidence"] == []


# ---------------------------------------------------------------- sampling / caching / assembly
def test_sample_order_deterministic_and_input_order_free():
    items = [f"P-{i:04d}" for i in range(200)]
    a = gx.sample_order(items, 20261111)
    b = gx.sample_order(list(reversed(items)), 20261111)
    assert a == b and sorted(a) == sorted(items) and a != sorted(items)
    assert gx.sample_order(items, 1) != a


def test_cache_key():
    assert gx.cache_key("grand") == "explore-grand"
    assert gx.cache_key("node", "RM-S5") == "explore-node-RM-S5"
    assert gx.cache_key("node", "ph:abc") == "explore-node-ph_abc"
    k = gx.cache_key("edge", "HOLDS", "R-1", "PK1")
    assert k == gx.cache_key("edge", "HOLDS", "R-1", "PK1") and k.startswith("explore-edge-") and len(k) == 29
    assert len(gx.cache_key("node", "fp:" + "a" * 64)) < 40


def _row(k, si, sl, sp, t, ei, el, ep, c=None, rp=None):
    return {"k": k, "si": si, "sl": sl, "sp": sp, "t": t, "rp": rp or {}, "ei": ei, "el": el, "ep": ep, "c": c}


def test_assemble_matches_caps_whole_matches():
    rows = []
    for m in range(10):
        rm = {"rmid": f"RM-{m}", "name": "x"}
        for j in range(5):
            rows.append(_row(f"RM-{m}", f"r{m}", "Remitter", rm, "SENT", f"a{m}{j}", "Account",
                             {"iban": f"PK{m}{j}", "bank": "RAVI"}, c=j + 1))
    g, matches = gx.assemble_matches(rows, node_cap=14)
    assert len(matches) == 2 and len(g.nodes) == 12          # a third match (6 nodes) would exceed 14
    d = g.gdata()
    sent = [l for l in d["links"] if l["rel"] == "SENT"]
    assert len(sent) == 10 and {l["count"] for l in sent} == {1, 2, 3, 4, 5} and sent[0]["label"] == "1"
    assert next(n for n in d["nodes"] if n["id"] == "RM-0")["degree"] == 5


def test_rank_results():
    rows = [{"l": "Remitter", "p": {"rmid": "RM1", "name": "Usman Bhatti"}, "m": "name"},
            {"l": "Record", "p": {"rid": "R-1", "bank": "MRGL", "raw_name": "M. Usman"}, "m": "record name"},
            {"l": "Person", "p": {"pid": "P-1", "canonical_name": "Usman Ghani"}, "m": "canonical name"},
            {"l": "Person", "p": {"pid": "P-1", "canonical_name": "Usman Ghani"}, "m": "canonical name"}]
    out = gx.rank_results(rows, "usman", 10)
    assert [x["id"] for x in out] == ["P-1", "R-1", "RM1"]


def test_scenario_seeds_cover_all_six():
    seeds = gx.scenario_seeds()
    assert set(seeds) == {"S1", "S2", "S3", "S4", "S5", "S6"} and all(seeds.values())
    assert "RM-S5" in seeds["S6"] and "RM-RC" in seeds["S6"]


# ---------------------------------------------------------------- offline: never touches Neo4j
GRAND = {
    "nodes": [
        {"id": "RM-S5", "label": "Faisal Nawaz", "kind": "remitter", "bank": None, "hollow": False, "tampered": False,
         "scenarios": ["S5"], "degree": 2},
        {"id": "PK36RAVI0000000000050003", "label": "RAVI ··0003", "kind": "account", "bank": "RAVI", "hollow": True,
         "tampered": False, "scenarios": ["S5"], "degree": 2},
        {"id": "fp:abc", "label": "abc", "kind": "fingerprint", "bank": "RAVI", "hollow": True, "tampered": False,
         "fpKind": "phone", "scenarios": ["S5"], "degree": 1},
        {"id": "R-MRGL-S5-1", "label": "Usman Ghani", "kind": "record", "bank": "MRGL", "hollow": False,
         "tampered": False, "scenarios": ["S5"], "degree": 0},
    ],
    "links": [
        {"id": "SENT:RM-S5>PK36RAVI0000000000050003", "source": "RM-S5", "target": "PK36RAVI0000000000050003",
         "rel": "SENT", "count": 1, "label": "1"},
        {"id": "HAS_FP:PK36RAVI0000000000050003>fp:abc", "source": "PK36RAVI0000000000050003", "target": "fp:abc",
         "rel": "HAS_FP", "label": None},
    ],
    "stats": {"shown_nodes": 4},
}


@pytest.fixture
def offline(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DEMO_OFFLINE", True)
    monkeypatch.setattr(sse, "CACHE_DIR", tmp_path)
    (tmp_path / "explore-grand.json").write_text(json.dumps({"recorded_from": "live", "ms": 10, "result": GRAND}),
                                                 encoding="utf-8")

    def boom(*a, **k):
        raise AssertionError("Neo4j touched offline")
    monkeypatch.setattr(gx, "lookup", boom)
    monkeypatch.setattr(gx, "_tampered_uids", boom)
    return tmp_path


def test_read_refuses_offline(monkeypatch):
    monkeypatch.setattr(config, "DEMO_OFFLINE", True)
    with pytest.raises(RuntimeError):
        gx._read("RETURN 1 AS x")


def test_offline_grand_and_fallbacks(offline):
    g = gx.graph_grand()
    assert g["replayed"] and len(g["nodes"]) == 4
    n = gx.graph_node("PK36RAVI0000000000050003")
    assert n["degree"] == {"SENT": 1, "HAS_FP": 1} and n["integrity"]["eid"] == "Account:PK36RAVI0000000000050003"
    assert gx.graph_node("fp:abc")["integrity"]["eid"] == "Fingerprint:RAVI:abc"
    e = gx.graph_edge("FP", "PK36RAVI0000000000050003", "fp:abc")
    assert e["rel"] == "HAS_FP" and e["title"] == "Partner fingerprint" and "RAVI" in e["cause"]
    e = gx.graph_edge("SENT", "RM-S5", "PK36RAVI0000000000050003")
    assert e["cause"].startswith("1 transfer")
    s = gx.graph_search("usman")
    assert [r["id"] for r in s["results"]] == ["R-MRGL-S5-1"]
    assert gx.graph_search("PK36RAVI")["results"][0]["id"] == "PK36RAVI0000000000050003"
    p = gx.graph_path("RM-S5", "fp:abc")
    assert p["found"] and [l["rel"] for l in p["links"]] == ["SENT", "HAS_FP"]
    x = gx.graph_expand("RM-S5", 1)
    assert {n["id"] for n in x["nodes"]} == {"RM-S5", "PK36RAVI0000000000050003"}
    assert gx.graph_patterns()["patterns"][0]["key"] == "shared-phone"
    assert gx.graph_pattern("fan-in")["count"] == 0


def test_offline_prefers_recordings(offline):
    rec = {"id": "RM-S5", "kind": "remitter", "label": "Faisal Nawaz", "props": {"rmid": "RM-S5"}}
    (offline / f"{gx.cache_key('node', 'RM-S5')}.json").write_text(
        json.dumps({"recorded_from": "live", "ms": 0, "result": rec}), encoding="utf-8")
    assert gx.graph_node("RM-S5")["props"] == {"rmid": "RM-S5"}


# ---------------------------------------------------------------- live Neo4j (skipped when unreachable)
def _live():
    import graphdb
    return graphdb.available()


live = pytest.mark.skipif("not _live()", reason="Neo4j not reachable")


@live
def test_live_search_and_privacy():
    res = gx.search("Usman", 20)
    assert any(r["id"] == "R-MRGL-S5-1" for r in res)
    assert all(r["bank"] in (None, config.HOST_BANK) or r["kind"] not in ("record",) for r in res)
    n = gx.node_detail("PK36RAVI0000000000050003")
    assert n and n["hollow"] and set(n["props"]) <= {"iban", "bank"}


@live
def test_live_patterns_non_empty():
    for key in gx.PATTERNS:
        r = gx.run_pattern(key)
        assert r["count"] > 0 and r["nodes"] and r["links"] and len(r["nodes"]) <= gx.PATTERN_NODE_CAP, key


@live
def test_live_edge_and_path():
    e = gx.edge_detail("SENT", "RM-S5", "PK36RAVI0000000000050003")
    assert e and e["transfers"] and e["title"] == "Transfers"
    p = gx.path("R-MRGL-S5-1", "PK36INDS0000000000050005", 6)
    assert p["found"] and any(l["rel"] == "SAME_AS" for l in p["links"])
