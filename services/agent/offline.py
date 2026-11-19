"""DEMO_OFFLINE replay state and helpers (P11). With DEMO_OFFLINE=1 every endpoint the UI calls is answered from
demo/cache/*.json written by scripts/record_cache.py, with the recorded timing, and never touches Neo4j, the chain or
the model. Non-streaming recordings are {"recorded_from","ms","result"}; streams are {"events":[...]}."""
from __future__ import annotations

import time

import config
import sse

STATE: dict = {"counter": "base", "ledger": "base", "tampered": False, "cases": {}, "egress": {}}
MAX_SLEEP_S = 1.5


def reset_state():
    STATE.update(counter="base", ledger="base", tampered=False, cases={}, egress={})


def enabled() -> bool:
    return config.DEMO_OFFLINE


def replay(name: str):
    """Recorded non-streaming result (with its recorded latency, capped), or None when nothing was recorded."""
    c = sse.load_cache(name)
    if not c or "result" not in c:
        return None
    time.sleep(min(c.get("ms", 0), MAX_SLEEP_S * 1000) / 1000)
    r = c["result"]
    return {**r, "replayed": True} if isinstance(r, dict) else r


def note_case(case_id: str, sid: str):
    STATE["cases"][case_id] = sid
    STATE["egress"][case_id] = f"egress-case-{sid}"
    if sid in ("S2", "S5"):
        STATE["counter"] = sid


def note_egress(case_id: str, name: str):
    if case_id:
        STATE["egress"][case_id] = name
