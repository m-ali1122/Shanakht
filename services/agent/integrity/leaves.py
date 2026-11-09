"""Canonical leaves for graph elements.

Element ids are stable business ids, not Neo4j internal ids, so they survive
reloads:   nodes  "Label:key"            e.g. "Record:R-MRGL-S5-1", "Account:PK36..."
           edges  "TYPE:startId>endId"   e.g. "HOLDS:Record:R-MRGL-S5-1>Account:PK36..."
PII properties are hashed inside the leaf, so the tree never holds them in clear.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field

# Business key per label (first present wins).
KEY_PROPS = {
    "Bank": "code", "Account": "iban", "Record": "rid", "Person": "pid", "Remitter": "rmid",
    "ExchangeHouse": "code", "Transfer": "tid", "Phone": "h", "Device": "h",
    "Fingerprint": "fp", "Decision": "did",
}
PII_PROPS = {"raw_name", "urdu_name", "cnic_syn", "phone", "device", "title_raw", "canonical_name",
             "name", "typed_name"}


@dataclass
class Element:
    kind: str                 # "node" | "rel"
    id: str                   # stable element id (see module doc)
    label: str                # node label or relationship type
    properties: dict = field(default_factory=dict)
    signer: str | None = None # bank code that signed this element's batch (fingerprints)
    key_value: str | None = None  # business key value, e.g. "R-MRGL-S5-1" (for row -> element lookup)


def node_id(label: str, props: dict) -> tuple[str, str | None]:
    # The same fingerprint can be contributed by several banks: id = Fingerprint:<bank>:<fp>.
    if label == "Fingerprint" and props.get("bank") and props.get("fp"):
        return f"Fingerprint:{props['bank']}:{props['fp']}", str(props["fp"])
    key = KEY_PROPS.get(label)
    val = props.get(key) if key else None
    if val is None:
        val = props.get("id") or props.get("uid")
    return f"{label}:{val}", (str(val) if val is not None else None)


def rel_id(rtype: str, start_id: str, end_id: str) -> str:
    return f"{rtype}:{start_id}>{end_id}"


def _scrub(props: dict) -> dict:
    out = {}
    for k in sorted(props):
        v = props[k]
        if k in PII_PROPS and v is not None:
            v = "sha256:" + hashlib.sha256(str(v).encode("utf-8")).hexdigest()
        out[k] = v
    return out


_enc = json.JSONEncoder(sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode


def leaf_hash(el: Element) -> str:
    """SHA-256 over canonical JSON {kind, id, label, properties (sorted, PII hashed), signer}."""
    props = el.properties or {}
    if not PII_PROPS.isdisjoint(props):
        props = _scrub(props)
    blob = _enc({"id": el.id, "kind": el.kind, "label": el.label, "properties": props, "signer": el.signer})
    return "0x" + hashlib.sha256(blob.encode("utf-8")).hexdigest()
