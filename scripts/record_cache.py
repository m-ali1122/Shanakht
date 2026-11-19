"""Record the offline demo cache (P11). Needs all services online (Neo4j, chain, banks, resolver, agent on 8103, LLM).

  .venv/Scripts/python.exe scripts/record_cache.py [--agent http://localhost:8103] [--s5-runs 3]

Order: POST /demo/reset, S1-S4 payee checks (+graph), S2 case/reverify/approve, S5 case (up to --s5-runs; stops at the
first run containing a GENUINE failed-then-repaired Cypher; nothing is ever injected; otherwise keeps the last valid
model run), S5 reverify/approve/incoming, S6 voice via real audio (demo/audio), then S5 tamper + reverify, then a final
reset, then the console graph explore answers (grand graph, patterns, scenario node/edge/search/expand/path; also
`--only explore`). Writes demo/cache/*.json and demo/cache/manifest.json (every step's wall time). Run with the agent in normal
(online) mode; DEMO_RECORD must stay on."""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

from urllib.parse import quote

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "agent"))
CACHE = ROOT / "demo" / "cache"
APPROVER = "analyst-02"
MANIFEST: list[dict] = []
INFO: dict = {}


def write(name: str, **body):
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / f"{name}.json").write_text(json.dumps({"recorded_from": "live", **body}, ensure_ascii=False, indent=1,
                                                    default=str), encoding="utf-8")


def mark(name: str, endpoint: str, ms: int, **extra):
    MANIFEST.append({"name": name, "endpoint": endpoint, "ms": ms, **extra})
    print(f"  [{ms:>7} ms] {name}", flush=True)


class Rec:
    def __init__(self, base: str):
        self.base = base
        self.c = httpx.Client(timeout=httpx.Timeout(600, connect=10))

    def call(self, method, path, name=None, **kw):
        t0 = time.perf_counter()
        r = self.c.request(method, self.base + path, **kw)
        ms = int((time.perf_counter() - t0) * 1000)
        r.raise_for_status()
        mark(name or path, f"{method} {path}", ms)
        return r.json(), ms

    def sse(self, path, body, name):
        events, t0 = [], time.perf_counter()
        with self.c.stream("POST", self.base + path, json=body) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if line.startswith("data: "):
                    events.append(json.loads(line[6:]))
        ms = int((time.perf_counter() - t0) * 1000)
        mark(name, f"POST {path}", ms, steps=[{"step": e["step"], "ms": e.get("ms")} for e in events])
        return events, ms


def snapshot(rec: Rec, kind: str, key: str):
    if kind == "ledger":
        res, ms = rec.call("GET", "/ledger/blocks?limit=20", f"ledger-{key}")
    else:
        res, ms = rec.call("GET", "/gateway/counter", f"counter-{key}")
    write(f"{kind}-{key}", ms=ms, result=res)


def egress(rec: Rec, case_id: str, name: str):
    res, ms = rec.call("GET", f"/gateway/egress?case_id={case_id}", name)
    write(name, ms=ms, result=res)


def final_ok(events):
    f = events[-1] if events else {}
    return f.get("step") == "final" and f.get("status") == "ok"


def model_ok(events) -> bool:
    return final_ok(events) and not any(e["step"] == "model" and e["status"] == "unavailable" for e in events)


def genuine_repair(events) -> bool:
    """A real Cypher error followed by a later successful query in the same model run (not the deterministic
    fallback). Nothing is ever injected."""
    if not model_ok(events):
        return False
    seen_err = False
    for e in events:
        if e["step"] == "cypher":
            if e["status"] == "error":
                seen_err = True
            elif e["status"] == "ok" and seen_err:
                return True
    return False


def record_explore(rec: Rec, sc: dict):
    """Console v2 graph explore API: grand graph, patterns, and node/edge/search/expand/path answers for the
    scenario entities. File names come from graph_explore.cache_key so offline replay finds them."""
    from graph_explore import cache_key
    print("graph explore (grand, patterns, details)")
    g, ms = rec.call("GET", "/graph/grand?limit=2500", "graph/grand")
    write(cache_key("grand"), ms=ms, result=g)
    res, ms = rec.call("GET", "/graph/patterns", "graph/patterns")
    write(cache_key("patterns"), ms=ms, result=res)
    for p in res["patterns"]:
        r, ms = rec.call("GET", f"/graph/pattern/{p['key']}", f"graph/pattern/{p['key']}")
        write(cache_key("pattern", p["key"]), ms=ms, result=r)
    nodes = {n["id"]: n for n in g["nodes"]}
    focus = [i for s in sc.values() for i in s.get("focus_ids", [])]
    s5 = [n["id"] for n in g["nodes"] if "S5" in (n.get("scenarios") or [])]
    node_ids = list(dict.fromkeys(focus + s5))
    phone = next((i for i in s5 if i.startswith("ph:")), None)
    queries = ["Usman", "Faisal Nawaz", "Bilal", "RM-S5", "R-MRGL-S5", "PK36RAVI0000000000050003",
               sc["S2"]["iban"], sc["S4"]["iban"]] + ([phone[:9], phone[3:9]] if phone else [])
    for q in queries:
        r, ms = rec.call("GET", f"/graph/search?q={quote(q)}&limit=20", f"graph/search {q}")
        write(cache_key("search", q.strip().lower(), 20), ms=ms, result=r)
    for i in node_ids:
        try:
            r, ms = rec.call("GET", f"/graph/node/{quote(i, safe=':')}", f"graph/node {i[:20]}")
        except httpx.HTTPStatusError as e:
            print("   skip node", i, e.response.status_code)
            continue
        write(cache_key("node", i), ms=ms, result=r)
    s5set = set(s5)
    links = [l for l in g["links"] if l["source"] in s5set and l["target"] in s5set][:60]
    for l in links:
        try:
            r, ms = rec.call("GET", f"/graph/edge?rel={l['rel']}&source={quote(l['source'], safe=':')}"
                                    f"&target={quote(l['target'], safe=':')}", f"graph/edge {l['id'][:40]}")
        except httpx.HTTPStatusError as e:
            print("   skip edge", l["id"], e.response.status_code)
            continue
        write(cache_key("edge", l["rel"], l["source"], l["target"]), ms=ms, result=r)
    for i in [x for x in sc["S5"]["focus_ids"] if x in nodes]:
        r, ms = rec.call("GET", f"/graph/expand?id={quote(i, safe=':')}&depth=1", f"graph/expand {i}")
        write(cache_key("expand", i, 1), ms=ms, result=r)
    ring = [b["iban"] for b in sc["S5"]["ring"]["beneficiaries"]]
    for a, b in [("RM-S5", ring[-1]), ("R-MRGL-S5-1", ring[-1]), ("R-MRGL-S5-1", ring[2])]:
        r, ms = rec.call("GET", f"/graph/path?source={a}&target={b}&max=6", f"graph/path {a}>{b}")
        write(cache_key("path", a, b, 6), ms=ms, result=r)
    INFO["explore"] = {"grand_nodes": len(g["nodes"]), "grand_links": len(g["links"]), "nodes": len(node_ids),
                       "edges": len(links), "searches": len(queries)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--agent", default="http://localhost:8103")
    ap.add_argument("--s5-runs", type=int, default=3)
    ap.add_argument("--from-s5", action="store_true",
                    help="resume: skip reset and S1-S4/S2 (already recorded; S2 already approved on the live stack)")
    ap.add_argument("--only", choices=["voice", "tamper", "explore"],
                    help="re-record just the S6 voice clips, the S5 tamper+reverify (re-runs one S5 case first), "
                         "or just the graph explore answers (grand, patterns, node/edge details)")
    a = ap.parse_args()
    rec = Rec(a.agent)
    h = rec.c.get(a.agent + "/health").json()
    if h.get("demo_offline"):
        sys.exit("agent is in DEMO_OFFLINE mode; restart it online before recording")
    sc = {s["id"]: s for s in json.loads((ROOT / "demo" / "scenarios.json").read_text(encoding="utf-8"))["scenarios"]}

    if not a.from_s5 and not a.only:
        print("reset")
        res, ms = rec.call("POST", "/demo/reset", "demo/reset")
        write("reset", ms=ms, result=res)
        snapshot(rec, "ledger", "base")
        snapshot(rec, "counter", "base")

        for sid in ("S1", "S2", "S3", "S4"):
            s = sc[sid]
            print(sid, "payee-check + graph")
            body = {"scenario": sid, "exchange_house": s["exchange_house"], "remitter_id": s["remitter_id"],
                    "typed_name": s["typed_name"], "iban": s["iban"], "amount": s["amount"]["pkr"]}
            ev, _ = rec.sse("/payee-check", body, f"payee-{sid}")
            write(f"payee-{sid}", events=ev)
            egress(rec, ev[-1]["data"]["payee_check_id"], f"egress-payee-{sid}")
            g, ms = rec.call("GET", f"/graph/scenario/{sid}", f"graph-{sid}")
            write(f"graph-{sid}", events=[], result=g)
        g, ms = rec.call("GET", "/graph/scenario/S5", "graph-S5")
        write("graph-S5", events=[], result=g)

        print("S2 case")
        ev, _ = rec.sse("/case", {"trigger": sc["S2"]["case_trigger"]}, "case-S2")
        if not final_ok(ev):
            sys.exit("S2 case failed: " + json.dumps(ev[-1])[:300])
        write("case-S2", events=ev)
        cid = ev[-1]["data"]["case_id"]
        egress(rec, cid, "egress-case-S2")
        snapshot(rec, "counter", "S2")
        ev2, _ = rec.sse(f"/case/{cid}/reverify", {}, "reverify-S2-clean")
        write("reverify-S2-clean", events=ev2)
        res, ms = rec.call("POST", f"/case/{cid}/approve", "approve-S2", json={"approver_id": APPROVER})
        write("approve-S2", ms=ms, result=res)
        snapshot(rec, "ledger", "S2")

    if not a.only:
        print("S5 case (up to", a.s5_runs, "runs)")
        keep, runs = None, []
        for n in range(1, a.s5_runs + 1):
            ev, ms = rec.sse("/case", {"trigger": sc["S5"]["case_trigger"]}, f"case-S5 run {n}")
            rep, ok = genuine_repair(ev), model_ok(ev)
            runs.append({"run": n, "valid_model_run": ok, "genuine_repair": rep, "ms": ms,
                         "cypher_errors": [e["data"].get("error") for e in ev if e["step"] == "cypher" and e["status"] == "error"]})
            print("   run", n, runs[-1])
            if ok:
                keep = ev
                INFO["s5_kept_run"] = n
                INFO["s5_kept_genuine_repair"] = rep
            if rep:
                break
        INFO["s5_runs"] = runs
        if keep is None:
            sys.exit(f"no valid S5 model run in {a.s5_runs} attempts")
        write("case-S5", events=keep)
        cid5 = keep[-1]["data"]["case_id"]
        egress(rec, cid5, "egress-case-S5")
        snapshot(rec, "counter", "S5")
        ev2, _ = rec.sse(f"/case/{cid5}/reverify", {}, "reverify-S5-clean")
        write("reverify-S5-clean", events=ev2)
        res, ms = rec.call("POST", f"/case/{cid5}/approve", "approve-S5", json={"approver_id": APPROVER})
        write("approve-S5", ms=ms, result=res)
        snapshot(rec, "ledger", "S5")
        inc = sc["S5"]["incoming_after_publish"]
        res, ms = rec.call("POST", f"/banks/{inc['bank']}/incoming", f"incoming-{inc['bank']}",
                           json={"iban": inc["iban"], "typed_name": inc["typed_name"], "remitter": inc["remitter_id"],
                                 "amount": inc["amount"]["pkr"]})
        write(f"incoming-{inc['bank']}-{inc['iban']}", ms=ms, result=res)
        INFO["incoming"] = {k: res.get(k) for k in ("registry_check", "kind", "fingerprint")}
        if res.get("registry_check") != "HIT" or res.get("kind") != "device":
            print("WARNING: expected registry HIT on device, got", INFO["incoming"])

    if a.only in (None, "voice"):
        print("S6 voice (real audio through POST /voice)")
        INFO["voice"] = {}
        for q in sc["S6"]["voice_queries"]:
            path = ROOT / q["audio"]
            with open(path, "rb") as fh:
                t0 = time.perf_counter()
                r = rec.c.post(a.agent + "/voice", files={"audio": (path.name, fh, "audio/wav")}, data={"qid": q["qid"]})
                ms = int((time.perf_counter() - t0) * 1000)
            r.raise_for_status()
            res = r.json()
            mark(f"voice-{q['qid']} (audio)", "POST /voice", ms)
            norm = lambda t: re.sub(r"\W+", " ", t.lower()).strip()
            exact = norm(res["transcript"]) == norm(q["text"])
            INFO["voice"][q["qid"]] = {"transcript": res["transcript"], "exact": exact, "language": res["language"],
                                       "answer": res.get("answer"), "stt": res.get("stt")}
            if not exact or not res.get("answer"):
                # The synthetic clip was misheard; the cached playback answers the scripted question instead.
                res, ms2 = rec.call("POST", "/voice/text", f"voice-{q['qid']} (scripted text)",
                                    json={"text": q["text"], "qid": q["qid"]})
                res["stt"] = INFO["voice"][q["qid"]]["stt"]
                ms += ms2
            if res.get("error") or not res.get("answer"):
                print("   NOT cached (error, e.g. LLM daily quota):", str(res.get("error"))[:120])
                INFO["voice"][q["qid"]]["cached"] = False
                continue
            INFO["voice"][q["qid"]]["cached"] = True
            write(f"voice-{q['qid']}", ms=ms, result=res)
            egress(rec, res["case_id"], f"egress-voice-{q['qid']}")
        snapshot(rec, "counter", "V")

    if a.only == "tamper":
        ev, _ = rec.sse("/case", {"trigger": sc["S5"]["case_trigger"]}, "case-S5 (for tamper)")
        if not model_ok(ev):
            sys.exit("model run failed (rate limit?); nothing tampered")
        keep, cid5 = ev, ev[-1]["data"]["case_id"]
    if a.only in (None, "tamper"):
        print("S5 tamper + reverify")
        first = next(n for e in keep[-1]["data"]["case"]["evidence"] for n in e["node_ids"])
        res, ms = rec.call("POST", "/integrity/tamper", "tamper-S5", json={"element_id": first})
        INFO["tamper_element"] = first
        ev3, _ = rec.sse(f"/case/{cid5}/reverify", {}, "reverify-S5-tampered")
        if model_ok(ev3):
            write("tamper-S5", ms=ms, result=res)
            write("reverify-S5-tampered", events=ev3)
        else:
            print("   tamper reverify NOT cached: agent re-run failed (LLM unavailable?)")
            INFO["tamper_cached"] = False

    if a.only != "explore":
        print("final reset (restores the tampered node and chain)")
        rec.call("POST", "/demo/reset", "demo/reset (final)")
    if a.only in (None, "explore"):
        record_explore(rec, sc)
    mf = CACHE / "manifest.json"
    if a.only and mf.exists():                         # partial re-record: keep the earlier manifest, add this run
        old = json.loads(mf.read_text(encoding="utf-8"))
        old["info"].update(INFO)
        MANIFEST[:0] = []
        old["steps"] += MANIFEST
        INFO.clear(); INFO.update(old["info"]); MANIFEST[:] = old["steps"]
    mf.write_text(json.dumps({"agent": h, "info": INFO, "steps": MANIFEST}, ensure_ascii=False,
                                                    indent=1, default=str), encoding="utf-8")
    print("done:", len(MANIFEST), "calls")


if __name__ == "__main__":
    main()
