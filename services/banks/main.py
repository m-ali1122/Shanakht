"""Simulated banks (P5). One FastAPI app, /banks/{code}/..."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import random
import re
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
CODES = ("MRGL", "RAVI", "CHNB", "INDS")


def _env(k, d=""):
    v = os.getenv(k)
    if v:
        return v
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.startswith(k + "="):
                return line.split("=", 1)[1].strip() or d
    return d


HMAC_KEY = _env("CONSORTIUM_HMAC_KEY", "demo-consortium-key")
CHAIN_RPC = _env("CHAIN_RPC", "http://localhost:8545")


def fingerprint(kind: str, value: str) -> str:
    v = (value or "").strip()
    v = re.sub(r"\D", "", v) if kind in ("phone", "cnic") else v.lower()
    return hmac.new(HMAC_KEY.encode(), v.encode(), hashlib.sha256).hexdigest()


# ---- title quirks -------------------------------------------------------
_TITLES = re.compile(r"^(mr|mrs|ms|miss|dr|prof)\.?\s+", re.I)


def apply_quirk(bank: str, name: str) -> str:
    n = " ".join((name or "").split())
    if bank == "MRGL":
        n = _TITLES.sub("", n).upper()
        return n[:35].rstrip()
    if bank == "RAVI":
        n = re.sub(r"[^A-Za-z ]", "", n.replace("-", " "))
        return " ".join(n.upper().split())
    if bank == "CHNB":
        return n.upper()
    if bank == "INDS":
        return n.title()[:24].rstrip()
    return n


def _jl(name):
    p = OUT / name
    if not p.exists():
        return []
    return [json.loads(l) for l in p.open(encoding="utf-8") if l.strip()]


ACCOUNTS: dict[str, dict] = {}
RECORDS: dict[str, dict] = {}  # by iban
LAST_SYNC = None


def load():
    global LAST_SYNC
    ACCOUNTS.clear()
    RECORDS.clear()
    for a in _jl("accounts.jsonl"):
        ACCOUNTS[a["iban"]] = a
    for r in _jl("records.jsonl"):
        RECORDS[r["iban"]] = r
    LAST_SYNC = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---- chain --------------------------------------------------------------
_reg = None


def registry():
    global _reg
    if _reg is not None:
        return _reg
    dep = ROOT / "chain" / "deployments" / "localhost.json"
    if not dep.exists():
        return None
    from web3 import Web3
    d = json.loads(dep.read_text())
    w3 = Web3(Web3.HTTPProvider(CHAIN_RPC, request_kwargs={"timeout": 3}))
    if not w3.is_connected():
        return None
    m = d["MuleRegistry"]
    _reg = w3.eth.contract(address=Web3.to_checksum_address(m["address"]), abi=m["abi"])
    return _reg


def is_flagged(fp_hex: str):
    """True/False, or None if chain unavailable."""
    global _reg
    try:
        reg = registry()
        if reg is None:
            return None
        return bool(reg.functions.isFlagged(bytes.fromhex(fp_hex)).call()[0])
    except Exception:
        _reg = None
        return None


app = FastAPI(title="Shanakht simulated banks")
load()


def _bank(code: str) -> str:
    code = code.upper()
    if code not in CODES:
        raise HTTPException(404, "unknown bank")
    return code


@app.get("/health")
def health():
    return {"ok": True, "accounts": len(ACCOUNTS)}


@app.get("/banks/{code}/title-fetch")
async def title_fetch(code: str, iban: str):
    code = _bank(code)
    await asyncio.sleep(random.uniform(0.12, 0.30))
    a = ACCOUNTS.get(iban)
    if not a or a["bank"] != code:
        return {"iban": iban, "title": None, "bank_code": code, "status": "NOT_FOUND"}
    return {"iban": iban, "title": apply_quirk(code, a["title_raw"]), "bank_code": code, "status": "FOUND"}


@app.get("/banks/{code}/kyc-name")
async def kyc_name(code: str, iban: str):
    code = _bank(code)
    await asyncio.sleep(random.uniform(0.12, 0.30))
    r = RECORDS.get(iban)
    if not r or r["bank"] != code:
        return {"iban": iban, "bank_code": code, "urdu_name": None, "status": "NOT_FOUND"}
    return {"iban": iban, "bank_code": code, "urdu_name": r.get("urdu_name"), "status": "FOUND"}


class Incoming(BaseModel):
    iban: str | None = None
    phone: str | None = None
    device: str | None = None
    cnic: str | None = None


@app.post("/banks/{code}/incoming")
def incoming(code: str, body: Incoming):
    code = _bank(code)
    r = RECORDS.get(body.iban) if body.iban else None
    vals = {"phone": body.phone or (r or {}).get("phone"),
            "device": body.device or (r or {}).get("device"),
            "cnic": body.cnic or (r or {}).get("cnic_syn")}
    fps = {k: fingerprint(k, v) for k, v in vals.items() if v}
    hit, unavailable = False, False
    for k in ("phone", "device", "cnic"):
        if k in fps:
            f = is_flagged(fps[k])
            if f is None:
                unavailable = True
            elif f:
                hit = True
    check = "HIT" if hit else ("UNAVAILABLE" if unavailable else "CLEAR")
    return {"registry_check": check, "fingerprint": {k: v[:16] for k, v in fps.items()},
            "fingerprint_full": fps, "bank_code": code}


@app.get("/banks/{code}/status")
def status(code: str):
    code = _bank(code)
    return {"bank_code": code, "online": True, "last_registry_sync": LAST_SYNC}
