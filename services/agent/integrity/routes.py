from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import config
from .keys import BatchRejected, public_key_registry, verify_batch
from .service import IntegrityService
from .store import LeafStore

router = APIRouter(prefix="/integrity", tags=["integrity"])
_svc: IntegrityService | None = None


def get_integrity() -> IntegrityService:
    global _svc
    if _svc is None:
        from chain_client import get_chain
        from .graph_source import neo4j_source
        _svc = IntegrityService(neo4j_source(), LeafStore(config.STATE_DIR / "leaves.sqlite"), chain=get_chain())
    return _svc


class ProveReq(BaseModel):
    element_ids: list[str]


class TamperReq(BaseModel):
    element_id: str


@router.post("/commit")
def commit():
    try:
        return get_integrity().commit()
    except Exception as e:
        raise HTTPException(503, f"commit failed: {e}")


@router.post("/prove")
def prove(req: ProveReq):
    return get_integrity().prove(req.element_ids)


@router.post("/tamper")
def tamper(req: TamperReq):
    if not config.DEMO_MODE:
        raise HTTPException(403, "tamper is only available with DEMO_MODE=1")
    eid = req.element_id
    if ":" not in eid or eid[:3] in ("ph:", "fp:", "dv:"):
        key = eid.split(":", 1)[1] if eid[:3] in ("ph:", "fp:", "dv:") else eid
        found = get_integrity().store.ids_for_keys([key]).get(key, [])
        eid = ([f for f in found if ">" not in f] or found or [eid])[0]
    req.element_id = eid
    try:
        res = get_integrity().tamper(req.element_id)
    except KeyError:
        raise HTTPException(404, f"no element {req.element_id}")
    return {**res, "reverify": get_integrity().prove([req.element_id])}


@router.get("/status")
def status():
    return get_integrity().status()


@router.get("/keys")
def keys():
    return public_key_registry()


@router.post("/verify-batch")
def verify(signed: dict):
    try:
        payload = verify_batch(signed)
    except BatchRejected as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "bank": payload["bank"], "batch_id": payload["batch_id"],
            "count": len(payload.get("fingerprints", []))}
