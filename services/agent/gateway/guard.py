"""Outbound check: block any model payload that still carries a raw identifier."""
from __future__ import annotations

import re

from . import names as nm
from .patterns import STRUCTURED, URDU_WORD


def scan(payload: str, raw_values: list[str] | None = None) -> list[dict]:
    """Return hits as [{kind, span}] — never the value itself (hits are logged)."""
    hits = []
    for kind, pat in STRUCTURED:
        for m in pat.finditer(payload):
            hits.append({"kind": kind, "span": [m.start(), m.end()]})
    for m in URDU_WORD.finditer(payload):
        if m.group(0) in nm.URDU_MAP:
            hits.append({"kind": "urdu_name", "span": [m.start(), m.end()]})
    for raw in raw_values or []:
        if len(raw) < 3:
            continue
        for m in re.finditer(r"(?<![\w])" + re.escape(raw) + r"(?![\w])", payload, re.I):
            hits.append({"kind": "vault_value", "span": [m.start(), m.end()]})
    return hits
