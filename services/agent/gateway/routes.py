from fastapi import APIRouter

from .gateway import get_gateway

router = APIRouter(prefix="/gateway", tags=["gateway"])


@router.get("/egress")
def egress(case_id: str | None = None):
    """Tokenized payloads exactly as sent, with their SHA-256 ("What the model saw")."""
    import offline
    if offline.enabled():
        name = offline.STATE["egress"].get(case_id)
        hit = offline.replay(name) if name else None
        if hit:
            return {**hit, "case_id": case_id}
        return {"case_id": case_id, "items": [], "replayed": True}
    gw = get_gateway()
    return {"case_id": case_id, "items": gw.egress.list(case_id)}


@router.get("/counter")
def counter():
    import offline
    if offline.enabled():
        st = offline.STATE["counter"]
        hit = offline.replay(f"counter-{st}") or (offline.replay("counter-S5") if st == "V" else None)             or offline.replay("counter-base")
        if hit:
            return hit
    gw = get_gateway()
    return {**gw.egress.counters(), "provider": gw.adapter.provider, "model": gw.adapter.model}
