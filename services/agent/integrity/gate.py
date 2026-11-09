"""Verified-context gate: only graph facts proven unedited since the last commit reach the model.

Usage inside run_cypher (P8/P9):

    rows = execute_locally(query, params)
    g = verified_context(rows)            # uses the global IntegrityService
    model_sees = g.rows                   # rows whose every element verified
    if g.note: tell_model(g.note)         # "N facts excluded: changed after epoch E."
    emit(g.step)                          # {"step": "integrity", "status": ..., "data": {...}}
    case.evidence_leaves |= g.leaves      # leaf hashes of verified elements, for the decision hash

Elements in a row are found by (a) explicit stable ids ("Record:R-MRGL-S5-1") and
(b) business-key values (rid, iban, rmid, tid, fp, pid ...) looked up in the
leaf table, so a query only has to RETURN ids as TEXT_TO_CYPHER already requires.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class GateResult:
    rows: list
    excluded_rows: int
    excluded_elements: list
    note: str
    epoch: int | None
    root: str | None
    leaves: dict = field(default_factory=dict)       # element_id -> leaf hash (verified only)
    elements_by_row: list = field(default_factory=list)
    step: dict = field(default_factory=dict)


def _strings(obj, out: set):
    if isinstance(obj, str):
        if len(obj) >= 3:
            out.add(obj)
    elif isinstance(obj, (int,)) and not isinstance(obj, bool):
        pass
    elif isinstance(obj, dict):
        for v in obj.values():
            _strings(v, out)
    elif isinstance(obj, (list, tuple, set)):
        for v in obj:
            _strings(v, out)


def verified_context(rows: list, service=None) -> GateResult:
    if service is None:
        from .routes import get_integrity
        service = get_integrity()
    store = service.store

    per_row_vals = []
    all_vals: set = set()
    for r in rows:
        vals: set = set()
        _strings(r, vals)
        per_row_vals.append(vals)
        all_vals |= vals

    vals = list(all_vals)
    by_key = store.ids_for_keys(vals)
    direct = set(store.get([v for v in vals if ":" in v]).keys())
    def ids_of(vs):
        out = set()
        for v in vs:
            out.update(by_key.get(v, []))
            if v in direct:
                out.add(v)
        return out

    row_ids = [ids_of(vs) for vs in per_row_vals]
    universe = sorted(set().union(*row_ids)) if row_ids else []
    proof = service.prove(universe) if universe else {"items": [], "epoch": None, "root": None,
                                                       "verified": 0, "total": 0}
    status = {i["element_id"]: i for i in proof["items"]}
    bad = {eid for eid, i in status.items() if i["status"] != "verified"}

    kept, kept_ids, excluded = [], [], 0
    for r, ids in zip(rows, row_ids):
        if ids & bad:
            excluded += 1
        else:
            kept.append(r)
            kept_ids.append(sorted(ids))
    epoch = proof.get("epoch")
    note = f"{excluded} facts excluded: changed after epoch {epoch}." if excluded else ""
    leaves = {eid: status[eid]["leaf_epoch"] for ids in kept_ids for eid in ids if eid in status}
    step = {"step": "integrity", "status": "ok" if not bad else "warn",
            "data": {"verified": proof.get("verified", 0), "total": proof.get("total", 0),
                     "excluded_rows": excluded, "excluded_elements": sorted(bad), "epoch": epoch,
                     "root": proof.get("root"), "note": note}}
    return GateResult(rows=kept, excluded_rows=excluded, excluded_elements=sorted(bad), note=note,
                      epoch=epoch, root=proof.get("root"), leaves=leaves, elements_by_row=kept_ids, step=step)
