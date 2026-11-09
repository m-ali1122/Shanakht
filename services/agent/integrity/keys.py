"""Ed25519 keys for the simulated banks and signed fingerprint batches.

Partner banks sign every fingerprint batch:
    signed = sign_batch("RAVI", batch_id, fingerprints, ts)
The loader calls verify_batch(signed) before writing; unsigned or unknown-signer
batches are rejected (and should be logged).

Keys come from env BANK_KEY_<CODE> (32-byte hex seed). If unset, a demo seed is
derived deterministically from SEED so every machine agrees — demo only.
"""
from __future__ import annotations

import hashlib
import json
import os
import time

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

import config

BANKS = ("MRGL", "RAVI", "CHNB", "INDS")


def canonical_json(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _seed(code: str) -> bytes:
    env = os.getenv(f"BANK_KEY_{code}", "").strip()
    if env:
        return bytes.fromhex(env)
    return hashlib.sha256(f"shanakht-demo-bank-key|{config.SEED}|{code}".encode()).digest()


def private_key(code: str) -> Ed25519PrivateKey:
    return Ed25519PrivateKey.from_private_bytes(_seed(code))


def public_key_hex(code: str) -> str:
    return private_key(code).public_key().public_bytes(Encoding.Raw, PublicFormat.Raw).hex()


def public_key_registry() -> dict[str, str]:
    """bank code -> raw public key hex. In production this is the consortium's member list."""
    return {c: public_key_hex(c) for c in BANKS}


def sign_batch(bank: str, batch_id: str, fingerprints: list, ts: int | None = None) -> dict:
    payload = {"bank": bank, "batch_id": batch_id, "fingerprints": fingerprints,
               "ts": int(ts if ts is not None else time.time())}
    sig = private_key(bank).sign(canonical_json(payload))
    return {"payload": payload, "signer": bank, "signature": sig.hex()}


class BatchRejected(ValueError):
    pass


def verify_batch(signed: dict, registry: dict[str, str] | None = None) -> dict:
    """Return the payload if the signature is valid; raise BatchRejected otherwise."""
    registry = registry or public_key_registry()
    if not isinstance(signed, dict) or not signed.get("signature") or not signed.get("signer"):
        raise BatchRejected("unsigned batch")
    signer = signed["signer"]
    payload = signed.get("payload") or {}
    if signer not in registry:
        raise BatchRejected(f"unknown signer {signer!r}")
    if payload.get("bank") != signer:
        raise BatchRejected("payload bank does not match signer")
    try:
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(registry[signer])).verify(
            bytes.fromhex(signed["signature"]), canonical_json(payload))
    except (InvalidSignature, ValueError) as e:
        raise BatchRejected(f"bad signature from {signer}") from e
    return payload
