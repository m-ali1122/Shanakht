"""Local Ed25519 signed fingerprint batches. Key derivation matches services/agent/integrity/keys.py
(env BANK_KEY_<CODE> hex seed, else sha256("shanakht-demo-bank-key|SEED|CODE"))."""
from __future__ import annotations

import hashlib
import json
import os
import time

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

BANKS = ("MRGL", "RAVI", "CHNB", "INDS")


class BatchRejected(ValueError):
    pass


def canonical_json(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _priv(code: str) -> Ed25519PrivateKey:
    env = os.getenv(f"BANK_KEY_{code}", "").strip()
    seed = bytes.fromhex(env) if env else hashlib.sha256(
        f"shanakht-demo-bank-key|{os.getenv('SEED', '20261111')}|{code}".encode()).digest()
    return Ed25519PrivateKey.from_private_bytes(seed)


def registry() -> dict[str, str]:
    return {c: _priv(c).public_key().public_bytes(Encoding.Raw, PublicFormat.Raw).hex() for c in BANKS}


def sign_batch(bank: str, batch_id: str, fingerprints: list, ts: int | None = None) -> dict:
    payload = {"bank": bank, "batch_id": batch_id, "fingerprints": fingerprints,
               "ts": int(ts if ts is not None else time.time())}
    return {"payload": payload, "signer": bank, "signature": _priv(bank).sign(canonical_json(payload)).hex()}


def verify_batch(signed: dict, reg: dict[str, str] | None = None) -> dict:
    reg = reg or registry()
    if not isinstance(signed, dict) or not signed.get("signature") or not signed.get("signer"):
        raise BatchRejected("unsigned batch")
    signer, payload = signed["signer"], signed.get("payload") or {}
    if signer not in reg:
        raise BatchRejected(f"unknown signer {signer!r}")
    if payload.get("bank") != signer:
        raise BatchRejected("payload bank does not match signer")
    try:
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(reg[signer])).verify(
            bytes.fromhex(signed["signature"]), canonical_json(payload))
    except (InvalidSignature, ValueError) as e:
        raise BatchRejected(f"bad signature from {signer}") from e
    return payload
