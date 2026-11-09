"""SSE helpers. Events are `data: {"step","status","data","ms"}` lines; the last has step="final".
With DEMO_OFFLINE=1 a stream is replayed from demo/cache/<name>.json; live runs are recorded there."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Callable, Iterator

from fastapi.responses import StreamingResponse

import config

CACHE_DIR = config.ROOT_DIR / "demo" / "cache"
HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def fmt(ev: dict) -> str:
    return "data: " + json.dumps(ev, ensure_ascii=False, default=str) + "\n\n"


class Steps:
    """Timing helper: `yield from`-free; call s.ev(...) to build an event with ms since the last event."""

    def __init__(self):
        self.t = time.perf_counter()
        self.events: list[dict] = []

    def ev(self, step: str, status: str = "ok", data=None) -> dict:
        now = time.perf_counter()
        e = {"step": step, "status": status, "data": data if data is not None else {},
             "ms": int((now - self.t) * 1000)}
        self.t = now
        self.events.append(e)
        return e


def cache_path(name: str) -> Path:
    return CACHE_DIR / f"{name}.json"


def load_cache(name: str):
    p = cache_path(name)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def save_cache(name: str, events: list[dict], extra: dict | None = None):
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_path(name).write_text(json.dumps({"recorded_from": "live", "events": events, **(extra or {})},
                                               ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    except Exception:
        pass


def stream(gen_fn: Callable[[], Iterator[dict]], cache_name: str | None = None,
           on_replay: Callable[[list[dict]], None] | None = None) -> StreamingResponse:
    def body():
        if config.DEMO_OFFLINE and cache_name:
            cached = load_cache(cache_name)
            if cached:
                if on_replay:
                    on_replay(cached["events"])
                for e in cached["events"]:
                    yield fmt({**e, "replayed": True})
                    time.sleep(min(e.get("ms", 0), 600) / 1000)
                return
        events = []
        try:
            for e in gen_fn():
                events.append(e)
                yield fmt(e)
        except Exception as ex:  # surface genuine failures; never invent one
            err = {"step": "final", "status": "error", "data": {"error": f"{type(ex).__name__}: {ex}"}, "ms": 0}
            yield fmt(err)
            return
        if cache_name and config.DEMO_RECORD and events and events[-1].get("step") == "final" \
                and events[-1].get("status") == "ok":
            save_cache(cache_name, events)
    return StreamingResponse(body(), media_type="text/event-stream", headers=HEADERS)
