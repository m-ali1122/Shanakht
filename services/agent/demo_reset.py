"""POST /demo/reset: undo what a demo run changed (Decision nodes, tampered properties, chain state)."""
from __future__ import annotations

import threading

from fastapi import APIRouter, HTTPException

import config
import graphdb
from integrity.graph_source import TAMPER_PROPS

router = APIRouter(tags=["demo"])
STATE = {"snapshot": None}


def take_snapshot():
    """Called at startup in a thread; never blocks or breaks the service if the chain is down."""
    try:
        from chain_client import get_chain
        c = get_chain()
        if c.available():
            STATE["snapshot"] = c.snapshot()
    except Exception:
        pass


def start_snapshot_thread():
    threading.Thread(target=take_snapshot, daemon=True).start()


def restore_tampered() -> int:
    """Undo POST /integrity/tamper edits: strip ' (edited)' / subtract 1 and drop the marker. The leaf table holds
    only hashes, so the original value is recovered by reversing the (deterministic) tamper."""
    rows = graphdb.run_write("MATCH (n) WHERE n.tampered = true RETURN elementId(n) AS i, properties(n) AS p")
    n = 0
    for r in rows:
        props, sets = r["p"], {}
        key = next((k for k in TAMPER_PROPS if k in props), None)
        if key:
            v = props[key]
            if isinstance(v, str) and v.endswith(" (edited)"):
                sets[key] = v[:-len(" (edited)")]
            elif isinstance(v, (int, float)) and not isinstance(v, bool):
                sets[key] = v - 1
            elif v == "edited":
                sets[key] = None
        graphdb.run_write("MATCH (n) WHERE elementId(n)=$i SET n += $s REMOVE n.tampered", {"i": r["i"], "s": sets})
        n += 1
    return n


@router.post("/demo/reset")
def reset():
    if not config.DEMO_MODE:
        raise HTTPException(403, "reset is only available with DEMO_MODE=1")
    out = {}
    try:
        out["decisions_deleted"] = _delete_decisions()
        out["tampered_restored"] = restore_tampered()
    except Exception as e:
        out["graph_error"] = f"{type(e).__name__}: {e}"
    from case_agent import CASES
    CASES.clear()
    from chain_client import get_chain
    chain = get_chain()
    out["chain"] = {"reverted": False}
    try:
        if chain.available() and STATE["snapshot"]:
            ok = chain.revert(STATE["snapshot"])
            STATE["snapshot"] = chain.snapshot()        # a revert consumes the snapshot id
            out["chain"] = {"reverted": ok}
        elif chain.available():
            out["chain"] = {"reverted": False, "note": "no startup snapshot (chain was down at startup)"}
        else:
            out["chain"] = {"reverted": False, "note": "chain unavailable"}
    except Exception as e:
        out["chain"] = {"reverted": False, "error": str(e)}
    try:                                                # re-commit so leaf table and on-chain root agree again
        from integrity.routes import get_integrity
        c = get_integrity().commit()
        out["recommit"] = {"epoch": c["epoch"], "root": c["root"], "root_source": c["root_source"]}
    except Exception as e:
        out["recommit"] = {"error": f"{type(e).__name__}: {e}"}
    return out


def _delete_decisions() -> int:
    n = graphdb.run_write("MATCH (d:Decision) RETURN count(d) AS c")[0]["c"]
    graphdb.run_write("MATCH (d:Decision) DETACH DELETE d")
    return n
