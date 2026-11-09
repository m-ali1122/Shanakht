"""Consortium fingerprints: HMAC-SHA256(CONSORTIUM_HMAC_KEY, normalized value)."""
import hashlib
import hmac
import re

import config


def normalize(kind: str, value: str) -> str:
    value = (value or "").strip()
    if kind in ("phone", "cnic"):
        return re.sub(r"\D", "", value)
    if kind == "device":
        return value.lower()
    return value


def fingerprint(kind: str, value: str, key: str | None = None) -> str:
    """Full 64-char hex digest. UI shows the first 16; chain uses 0x+hex as bytes32."""
    k = (key or config.CONSORTIUM_HMAC_KEY).encode()
    return hmac.new(k, normalize(kind, value).encode(), hashlib.sha256).hexdigest()


def as_bytes32(fp_hex: str) -> str:
    return fp_hex if fp_hex.startswith("0x") else "0x" + fp_hex
