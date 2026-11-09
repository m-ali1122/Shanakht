"""Ledger strip data in the UI's LedgerBlock shape. Reads contract events straight from the node
(the explorer on 8104 is tried first; if it errors, e.g. BigInt serialisation, we read the logs ourselves)."""
from __future__ import annotations

import datetime as dt

import httpx

import config
from chain_client import get_chain

BANDS = {1: "MATCH", 2: "CLOSE", 3: "NO_MATCH"}
ACTIONS = {v: k for k, v in config.ACTIONS.items()}
KINDS = {v: k for k, v in config.KINDS.items()}
BANKS = {v: k for k, v in config.BANK_IDS.items()}


def _iso(ts) -> str:
    return dt.datetime.fromtimestamp(int(ts), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _h(b) -> str:
    return "0x" + bytes(b).hex()


def web3_blocks(limit: int = 20) -> list[dict]:
    c = get_chain()
    c._connect()
    w3, out = c._w3, []
    for name, ev, kind in (("GraphRootLog", "Committed", "commit"), ("DecisionLog", "Anchored", "decision"),
                           ("MuleRegistry", "Published", "publish")):
        if name not in c._c:
            continue
        for lg in getattr(c._c[name].events, ev).get_logs(from_block=0):
            a = lg["args"]
            b = {"id": lg["blockNumber"], "kind": kind, "tx": _h(lg["transactionHash"]), "hash": "",
                 "ts": _iso(a["ts"]), "detail": {"event": f"{name}.{ev}", "block": lg["blockNumber"]}}
            if kind == "commit":
                b.update(hash=_h(a["root"]), epoch=int(a["epoch"]),
                         detail={**b["detail"], "nodes": int(a["nodeCount"]), "edges": int(a["edgeCount"])})
            elif kind == "decision":
                b.update(hash=_h(a["decisionHash"]), epoch=int(a["epoch"]), band=BANDS.get(a["band"]),
                         action=ACTIONS.get(a["action"]), approver=_h(a["approverHash"])[:18],
                         detail={**b["detail"], "decision_id": int(a["id"])})
                if a["action"] == 0:
                    b["kind"] = "auto"
            else:
                b.update(hash=_h(a["fp"]), fp=_h(a["fp"])[2:18], fpKind=KINDS.get(a["kind"]),
                         bank=BANKS.get(a["bankId"]))
            out.append(b)
    out.sort(key=lambda x: (x["id"], x["kind"]), reverse=True)
    return out[:limit]


def blocks(limit: int = 20) -> list[dict]:
    try:
        r = httpx.get(f"{config.EXPLORER_URL}/blocks", params={"limit": limit}, timeout=4)
        r.raise_for_status()
        data = r.json()
        if isinstance(data, list) and data and "kind" in data[0]:
            return data
    except Exception:
        pass
    return web3_blocks(limit)
