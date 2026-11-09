from fastapi import APIRouter

from .gateway import get_gateway

router = APIRouter(prefix="/gateway", tags=["gateway"])


@router.get("/egress")
def egress(case_id: str | None = None):
    """Tokenized payloads exactly as sent, with their SHA-256 ("What the model saw")."""
    gw = get_gateway()
    return {"case_id": case_id, "items": gw.egress.list(case_id)}


@router.get("/counter")
def counter():
    gw = get_gateway()
    return {**gw.egress.counters(), "provider": gw.adapter.provider, "model": gw.adapter.model}
