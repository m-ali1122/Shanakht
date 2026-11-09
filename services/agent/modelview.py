"""What the model is allowed to see of query results: tokenized, aggregated, capped.
Row values never go to the model raw: identifier-like columns become tokens via the gateway vault."""
from __future__ import annotations

import re

KIND_BY_KEY = {
    "iban": "acct", "phone": "phone", "device": "device", "cnic": "cnic", "cnic_syn": "cnic",
    "h": "fp", "fp": "fp",
    "name": "person", "raw_name": "person", "canonical_name": "person", "title_raw": "person",
    "typed_name": "person", "urdu_name": "person", "title": "person", "sender": "person",
}
_HEX64 = re.compile(r"^(?:0x)?[0-9a-f]{64}$", re.I)


def _val(gw, case_id, key, v):
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, int) and abs(v) >= 10**12:      # never let a 13-digit number reach the model
        return "<large number>"
    if isinstance(v, str):
        kind = KIND_BY_KEY.get((key or "").split(".")[-1].lower())
        if _HEX64.match(v):
            kind = "fp"
        if kind and v.strip():
            return gw.token(case_id, kind, v)
        return gw.tokenize(case_id, v)
    if isinstance(v, dict):
        return {k: _val(gw, case_id, k, x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_val(gw, case_id, key, x) for x in v]
    return v


def model_view(gw, case_id: str, rows: list[dict], note: str = "", max_rows: int = 25) -> dict:
    cols = list(rows[0].keys()) if rows else []
    return {"row_count": len(rows), "columns": cols,
            "rows": [{k: _val(gw, case_id, k, v) for k, v in r.items()} for r in rows[:max_rows]],
            "truncated": len(rows) > max_rows, "integrity_note": note or None}


def strings_in(obj, out: set | None = None) -> set:
    out = set() if out is None else out
    if isinstance(obj, str):
        out.add(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            strings_in(v, out)
    elif isinstance(obj, (list, tuple, set)):
        for v in obj:
            strings_in(v, out)
    return out
