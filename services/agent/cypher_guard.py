"""Read-only guard for model-written Cypher: reject writes, force a LIMIT, one statement only."""
from __future__ import annotations

import re

MAX_LIMIT = 200

_FORBIDDEN = re.compile(r"\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|LOAD|FOREACH|GRANT|DENY|REVOKE)\b", re.I)
_CALL = re.compile(r"\bCALL\b\s*(\{|[\w.]+)", re.I)
_CALL_OK = re.compile(r"^(\{|apoc\.(coll|text|math|date|convert|map|agg)\.\w+|db\.(labels|relationshipTypes|schema\.\w+))$", re.I)
_STRINGS = re.compile(r"""'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`[^`]*`""")
_COMMENTS = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)
_TRAIL_LIMIT = re.compile(r"\bLIMIT\s+(\d+)\s*$", re.I)


class UnsafeCypher(ValueError):
    pass


def _skeleton(q: str) -> str:
    return _STRINGS.sub("''", _COMMENTS.sub(" ", q))


def clean(q: str) -> str:
    q = (q or "").strip()
    if q.startswith("```"):
        q = re.sub(r"^```(?:cypher)?\s*|\s*```$", "", q, flags=re.I).strip()
    return q


def guard(query: str) -> str:
    """Return the query with LIMIT enforced, or raise UnsafeCypher."""
    q = clean(query).rstrip(";").strip()
    if not q:
        raise UnsafeCypher("empty query")
    sk = _skeleton(q)
    if ";" in sk:
        raise UnsafeCypher("multiple statements are not allowed")
    m = _FORBIDDEN.search(sk)
    if m:
        raise UnsafeCypher(f"write keyword not allowed: {m.group(1).upper()}")
    for c in _CALL.finditer(sk):
        if not _CALL_OK.match(c.group(1)):
            raise UnsafeCypher(f"CALL {c.group(1)} is not allowed")
    if not re.search(r"\bRETURN\b", sk, re.I):
        raise UnsafeCypher("query must RETURN something")
    return enforce_limit(q)


def enforce_limit(q: str) -> str:
    m = _TRAIL_LIMIT.search(q)
    if m:
        if int(m.group(1)) > MAX_LIMIT:
            return q[:m.start()] + f"LIMIT {MAX_LIMIT}"
        return q
    return f"{q}\nLIMIT {MAX_LIMIT}"
