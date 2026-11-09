"""Graph canvas data (Cytoscape elements), ledger proxy, and demo reset."""
from __future__ import annotations

import json

import httpx
from fastapi import APIRouter, HTTPException

import config
import graphdb
import sse
from integrity.leaves import KEY_PROPS, node_id

router = APIRouter(tags=["graph"])
CAP = 40                       # max neighbours pulled per node per hop
SKIP = ("Bank", "ExchangeHouse")   # hubs: never expanded or drawn as neighbours
KEYS = sorted(set(KEY_PROPS.values()))


def _scenarios() -> dict:
    return {s["id"]: s for s in json.loads(
        (config.ROOT_DIR / "demo" / "scenarios.json").read_text(encoding="utf-8"))["scenarios"]}


def _label(label: str, p: dict) -> str:
    if label == "Remitter":
        return p.get("name") or p.get("rmid")
    if label == "Record":
        return p.get("raw_name") or p.get("rid")
    if label == "Person":
        return p.get("canonical_name") or p.get("pid")
    if label == "Account":
        return f"{p.get('bank', '')} ··{str(p.get('iban', ''))[-4:]}"
    if label in ("Phone", "Device"):
        return str(p.get("h", ""))[:6]
    if label == "Fingerprint":
        return str(p.get("fp", ""))[:6]
    if label == "Decision":
        return f"decision {p.get('did')}"
    return p.get("name") or p.get("code") or label


def ui_id(label: str, p: dict) -> str:
    """Ids the web UI uses: rmid / iban / rid, ph:<h> phone, dv:<h> device, fp:<fp> fingerprint."""
    return {"Remitter": lambda: p.get("rmid"), "Account": lambda: p.get("iban"), "Record": lambda: p.get("rid"),
            "Person": lambda: p.get("pid"), "Phone": lambda: "ph:" + str(p.get("h")),
            "Device": lambda: "dv:" + str(p.get("h")), "Fingerprint": lambda: "fp:" + str(p.get("fp")),
            "Decision": lambda: p.get("did")}.get(label, lambda: node_id(label, p)[0])()


def to_elements(nodes: dict, edges: list, focus: set[str]) -> dict:
    """nodes: ui_id -> (label, props); edges: (rel, src, dst, label|None)."""
    out_nodes = {}
    for eid, (label, p) in nodes.items():
        bank = p.get("bank")
        hollow = label == "Fingerprint" or (label in ("Account", "Record") and bank and bank != config.HOST_BANK)
        d = {"id": eid, "label": _label(label, p), "kind": label.lower(), "bank": bank, "hollow": bool(hollow),
             "focus": eid in focus, "tampered": bool(p.get("tampered")), "eid": node_id(label, p)[0]}
        if label == "Fingerprint":
            d["fpKind"] = p.get("kind")
        out_nodes[eid] = {"data": d}
    out_edges, seen = [], set()
    for rel, a, b, lab in edges:
        if a in out_nodes and b in out_nodes and (rel, a, b) not in seen:
            seen.add((rel, a, b))
            d = {"id": f"{rel}:{a}>{b}", "source": a, "target": b, "rel": rel}
            d["label"] = lab if lab is not None else None
            out_edges.append({"data": d})
    return {"nodes": list(out_nodes.values()), "edges": out_edges}


REL_UI = {"HAS_FP": "FP"}


def neighborhood(ids: list[str], depth: int = 2) -> dict:
    """BFS from nodes whose business key matches `ids`. Transfers are collapsed into Remitter-SENT->Account edges
    labelled with the transfer count; Bank/ExchangeHouse hubs are skipped."""
    ids = [i.split(":", 1)[1] if i[:3] in ("ph:", "fp:", "dv:") else i for i in ids]
    start = graphdb.run_read(
        "MATCH (n) WHERE any(k IN $keys WHERE n[k] IN $ids) AND NOT n:Bank AND NOT n:Transfer "
        "RETURN elementId(n) AS i, labels(n)[0] AS l, properties(n) AS p LIMIT 200", {"keys": KEYS, "ids": ids})
    nodes: dict[str, tuple] = {}
    internal: dict[str, str] = {}

    def add(i, l, p):
        u = ui_id(l, p)
        internal[i] = u
        nodes.setdefault(u, (l, p))
        return u

    for r in start:
        add(r["i"], r["l"], r["p"])
    focus = {internal[r["i"]] for r in start}
    frontier = list(internal)
    edges: list = []
    for _ in range(depth):
        if not frontier:
            break
        nxt = []
        rows = graphdb.run_read(
            "UNWIND $f AS f MATCH (n) WHERE elementId(n)=f "
            "CALL { WITH n MATCH (n)-[r]-(m) WHERE NOT m:Bank AND NOT m:ExchangeHouse AND NOT m:Transfer "
            "AND NOT n:Transfer RETURN r, m LIMIT " + str(CAP) + " } "
            "RETURN elementId(n) AS ni, type(r) AS t, startNode(r)=n AS out, elementId(m) AS mi, "
            "labels(m)[0] AS ml, properties(m) AS mp", {"f": frontier})
        for r in rows:
            if r["mi"] not in internal:
                add(r["mi"], r["ml"], r["mp"])
                nxt.append(r["mi"])
            a, b = (internal[r["ni"]], internal[r["mi"]]) if r["out"] else (internal[r["mi"]], internal[r["ni"]])
            edges.append((REL_UI.get(r["t"], r["t"]), a, b, None))
        sent = graphdb.run_read(
            "UNWIND $f AS f MATCH (n) WHERE elementId(n)=f AND (n:Remitter OR n:Account) "
            "CALL { WITH n MATCH (r:Remitter)-[:SENT]->(t:Transfer)-[:TO]->(a:Account) "
            "WHERE (n:Remitter AND r=n) OR (n:Account AND a=n) RETURN r, a, count(t) AS c LIMIT " + str(CAP) + " } "
            "RETURN elementId(r) AS ri, properties(r) AS rp, elementId(a) AS ai, properties(a) AS ap, c",
            {"f": frontier})
        for r in sent:
            for i, l, p in ((r["ri"], "Remitter", r["rp"]), (r["ai"], "Account", r["ap"])):
                if i not in internal:
                    add(i, l, p)
                    nxt.append(i)
            edges.append(("SENT", internal[r["ri"]], internal[r["ai"]], str(r["c"])))
        frontier = nxt
    return to_elements(nodes, edges, focus)


@router.get("/graph/scenario/{sid}")
def graph_scenario(sid: str):
    sid = sid.upper()
    if config.DEMO_OFFLINE:
        c = sse.load_cache(f"graph-{sid}")
        if c:
            return {**c["result"], "replayed": True}
    sc = _scenarios().get(sid)
    if not sc:
        raise HTTPException(404, f"unknown scenario {sid}")
    ids = list(sc.get("focus_ids", []))
    try:
        els = neighborhood(ids, depth=2)
    except Exception as e:
        raise HTTPException(503, f"graph unavailable: {type(e).__name__}: {e}")
    res = {"scenario": sid, "focus_ids": ids, **els}
    if config.DEMO_RECORD and els["nodes"]:
        sse.save_cache(f"graph-{sid}", [], {"result": res})
    return res


@router.get("/graph/neighborhood")
def graph_neighborhood(ids: str, depth: int = 1):
    id_list = [i for i in ids.split(",") if i]
    try:
        return neighborhood(id_list, depth=max(1, min(depth, 3)))
    except Exception as e:
        raise HTTPException(503, f"graph unavailable: {type(e).__name__}: {e}")


@router.get("/ledger/blocks")
def ledger_blocks(limit: int = 20):
    import ledger
    try:
        return ledger.blocks(limit)
    except Exception as e:
        raise HTTPException(502, f"ledger unavailable: {type(e).__name__}: {e}")


@router.post("/banks/{code}/incoming")
def banks_incoming(code: str, payload: dict):
    """Proxy to the banks service; adds which fingerprint kind hit the registry."""
    from chain_client import get_chain
    try:
        r = httpx.post(f"{config.BANKS_URL}/banks/{code.upper()}/incoming", json=payload, timeout=8).json()
    except Exception as e:
        raise HTTPException(502, f"banks service unavailable: {e}")
    kind, fp = None, None
    full = r.get("fingerprint_full") or {}
    if r.get("registry_check") == "HIT":
        try:
            for k, f in full.items():
                if get_chain().is_flagged(f)["flagged"]:
                    kind, fp = k, f[:16]
                    break
        except Exception:
            pass
    if fp is None and full:
        k0 = next(iter(full))
        kind, fp = (kind or k0), full[k0][:16]
    block = None
    if r.get("registry_check") == "HIT":
        try:  # a registry check is a view call (no tx); label it with the chain head it was read at
            ch = get_chain(); ch._connect(); head = int(ch._w3.eth.block_number)
        except Exception:
            head = 0
        block = {"id": head, "kind": "registry_hit", "hash": "0x" + (full.get(kind) or ""), "tx": "", "bank": code.upper(),
                 "fp": fp, "fpKind": kind, "ts": __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                 "detail": {"event": "MuleRegistry.isFlagged", "result": "HIT"}}
    return {"registry_check": r.get("registry_check"), "fingerprint": fp, "kind": kind, "bank": code.upper(),
            "block": block, "fingerprints": r.get("fingerprint")}
