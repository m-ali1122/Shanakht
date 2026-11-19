"""P7: POST /payee-check (SSE). title_fetch -> compare -> history -> decision -> phrase (+ ledger for auto-pass/hold)."""
from __future__ import annotations

import hashlib
import json
import sys
import uuid
from datetime import datetime
from pathlib import Path

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

import config
import graphdb
import offline
import sse
from gateway import GatewayBlocked, get_gateway, parse_json
from prompts import PAYEE_EXPLAIN

try:  # the banks worker's client interface, loaded by path so it cannot shadow our modules
    import importlib.util
    _spec = importlib.util.spec_from_file_location("banks_client", config.ROOT_DIR / "services" / "banks" / "client.py")
    _mod = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_mod)
    HttpTitleFetchClient = _mod.HttpTitleFetchClient
except Exception:  # pragma: no cover - minimal equivalent
    class HttpTitleFetchClient:  # type: ignore
        def __init__(self, base_url=None, timeout=5.0):
            self.base, self.c = (base_url or config.BANKS_URL).rstrip("/"), httpx.Client(timeout=timeout)

        def title_fetch(self, bank_code, iban):
            return self.c.get(f"{self.base}/banks/{bank_code}/title-fetch", params={"iban": iban}).json()

        def kyc_name(self, bank_code, iban):
            return self.c.get(f"{self.base}/banks/{bank_code}/kyc-name", params={"iban": iban}).json()

router = APIRouter(tags=["payee"])

BANNER_NO_MATCH = "Account exists. Name does not belong to it. This payment would have reached a stranger."

_EN = {
    "VARIANT_SPELLING": "a spelling variant", "INITIAL_EXPANDED": "an abbreviation expanded to the full name",
    "TITLE_DROPPED": "a title dropped", "TITLE_ADDED": "a title added",
    "PATRONYMIC_DROPPED": "the father's name left out", "SCRIPT_CONVERTED": "the name converted between scripts",
    "TOKEN_ORDER": "the name parts in a different order", "TYPO_1CHAR": "a one-character typo",
    "SURNAME_MISSING": "the surname missing", "DIFFERENT_PERSON": "a different person",
}
_UR = {
    "VARIANT_SPELLING": "ہجوں کا فرق", "INITIAL_EXPANDED": "مخفف کی مکمل شکل", "TITLE_DROPPED": "لقب کا حذف",
    "TITLE_ADDED": "لقب کا اضافہ", "PATRONYMIC_DROPPED": "والد کا نام شامل نہیں", "SCRIPT_CONVERTED": "رسم الخط کی تبدیلی",
    "TOKEN_ORDER": "ناموں کی ترتیب مختلف", "TYPO_1CHAR": "ایک حرف کی غلطی", "SURNAME_MISSING": "خاندانی نام موجود نہیں",
    "DIFFERENT_PERSON": "مختلف شخص",
}


class PayeeReq(BaseModel):
    exchange_house: str | None = None
    remitter_id: str
    typed_name: str
    iban: str
    amount: dict | float | int | None = None


def template_phrase(typed: str, title: str | None, band: str, reasons: list[str]) -> dict:
    if band == "MATCH":
        return {"en": f"{typed} matches the account title {title}.",
                "ur": f"{typed} اکاؤنٹ ٹائٹل {title} سے مطابقت رکھتا ہے۔"}
    if band == "NO_MATCH":
        return {"en": f"{typed} does not match the account title {title}; this is a different person.",
                "ur": f"{typed} اکاؤنٹ ٹائٹل {title} سے مطابقت نہیں رکھتا، یہ مختلف شخص ہے۔"}
    en_r = ", ".join(_EN.get(r, r) for r in reasons) or "minor differences"
    ur_r = "، ".join(_UR.get(r, r) for r in reasons) or "معمولی فرق"
    return {"en": f"{typed} is a close match to {title}: {en_r}.",
            "ur": f"{typed} اور {title} قریبی مطابقت رکھتے ہیں: {ur_r}۔"}


def _has_urdu(s: str) -> bool:
    return any("؀" <= c <= "ۿ" for c in (s or ""))


def phrase(case_id: str, typed: str, title: str | None, band: str, score, reasons: list[str], alignment: list) -> dict:
    """PAYEE_EXPLAIN through the gateway; template fallback on any failure or malformed output."""
    tmpl = template_phrase(typed, title, band, reasons)
    if band == "MATCH" or config.DEMO_OFFLINE:
        return {**tmpl, "source": "template"}
    gw = get_gateway()
    payload = {"typed_name": typed, "title_raw": title, "band": band, "score": score, "reasons": reasons,
               "alignment": [{"relation": a.get("relation"), "reason": a.get("reason")} for a in alignment or []]}
    try:
        res = gw.complete(case_id, [{"role": "system", "content": PAYEE_EXPLAIN},
                                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                          json_schema={"type": "object"}, names=[typed, title or ""], purpose="payee_explain")
        out = parse_json(res.content)
        en, ur = str(out.get("en", "")).strip(), str(out.get("ur", "")).strip()
        if not en:
            raise ValueError("empty en")
        used_ur = ur if _has_urdu(ur) else tmpl["ur"]
        return {"en": en, "ur": used_ur, "source": "llm" if ur == used_ur else "llm+template_ur",
                "egress_sha256": res.egress_sha256}
    except GatewayBlocked as e:
        return {**tmpl, "source": "template", "note": str(e)}
    except Exception as e:
        return {**tmpl, "source": "template", "note": f"LLM unavailable: {type(e).__name__}"}


def history(rmid: str, iban: str) -> dict:
    rows = graphdb.run_read(
        "MATCH (rm:Remitter {rmid:$rmid})-[:SENT]->(t:Transfer)-[:TO]->(a:Account {iban:$iban}) "
        "RETURN count(t) AS n, min(t.ts) AS first_ts, max(t.ts) AS last_ts", {"rmid": rmid, "iban": iban})
    r = rows[0] if rows else {"n": 0, "first_ts": None, "last_ts": None}
    months = None
    if r["n"] and r["first_ts"] and r["last_ts"]:
        a, b = datetime.fromisoformat(r["first_ts"][:19]), datetime.fromisoformat(r["last_ts"][:19])
        months = round((b - a).days / 30.4)
    return {"prior_transfers": r["n"], "first": (r["first_ts"] or "")[:10] or None,
            "last": (r["last_ts"] or "")[:10] or None, "months": months}


def decide(band: str, title_found: bool, hist: dict, remitter: str, iban: str) -> dict:
    if not title_found:
        return {"action": "hold", "banner": "Account not found at the receiving bank. Payment held before sending.",
                "open_case": False}
    if band == "MATCH":
        return {"action": "auto_pass", "banner": None, "open_case": False}
    if band == "CLOSE":
        return {"action": "review", "open_case": True, "banner": None,
                "case_trigger": {"type": "close_match", "ref_ids": [remitter, iban]},
                "note": f"{hist.get('prior_transfers', 0)} prior transfers" if hist else None}
    return {"action": "hold", "banner": BANNER_NO_MATCH, "open_case": False}


def anchor_decision(req: PayeeReq, band: str, action: str, score) -> dict:
    """Ledger step for decisions that do not need an analyst (auto-pass, hold)."""
    from chain_client import get_chain
    from integrity.routes import get_integrity
    chain = get_chain()
    if not chain.available():
        return {"anchored": False, "reason": "chain unavailable"}
    epoch, root = chain.latest_root()
    h = hashlib.sha256(json.dumps({"remitter": req.remitter_id, "iban": req.iban, "band": band, "action": action,
                                   "score": score, "typed": req.typed_name}, sort_keys=True,
                                  ensure_ascii=False).encode()).hexdigest()
    mv = hashlib.sha256(f"{config.LLM_PROVIDER}:{config.LLM_MODEL}".encode()).hexdigest()
    out = chain.anchor(h, mv, root, epoch, config.BANDS[band], config.ACTIONS[action],
                       hashlib.sha256(b"system:payee-check").hexdigest())
    return {"anchored": True, "decision_hash": h, "tx": out["tx"], "block": out["block"], "id": out["id"],
            "epoch": epoch}


def scenario_for(iban: str) -> str | None:
    try:
        sc = json.loads((config.ROOT_DIR / "demo" / "scenarios.json").read_text(encoding="utf-8"))["scenarios"]
        for s in sc:
            if s.get("iban") == iban:
                return s["id"]
    except Exception:
        pass
    return None


def run_payee(req: PayeeReq):
    s = sse.Steps()
    case_id = "pc-" + uuid.uuid4().hex[:10]
    bank = req.iban[4:8].upper()
    banks = HttpTitleFetchClient(config.BANKS_URL)

    # 1. title fetch (+ Urdu KYC name when the bank has one)
    try:
        tf = banks.title_fetch(bank, req.iban)
    except Exception as e:
        yield s.ev("title_fetch", "error", {"bank": bank, "error": f"banks service unreachable: {e}"})
        yield s.ev("final", "error", {"error": "title fetch failed", "band": None})
        return
    title = tf.get("title")
    urdu = None
    if title:
        try:
            urdu = banks.kyc_name(bank, req.iban).get("urdu_name")
        except Exception:
            urdu = None
    yield s.ev("title_fetch", "ok" if title else "not_found",
               {"bank": bank, "title": title, "urdu_name": urdu, "status": tf.get("status")})

    # 2. compare
    if not title:
        band, score, reasons, alignment, cmp_res = "NO_MATCH", 0.0, [], [], {}
        yield s.ev("compare", "skipped", {"band": band, "reason": "no account title"})
    else:
        try:
            body = {"typed_name": req.typed_name, "title_raw": title}
            if urdu:
                body["urdu_name"] = urdu
            cmp_res = httpx.post(f"{config.RESOLVER_URL}/compare", json=body, timeout=10).json()
        except Exception as e:
            yield s.ev("compare", "error", {"error": f"resolver unreachable: {e}"})
            yield s.ev("final", "error", {"error": "compare failed"})
            return
        band, score = cmp_res["band"], cmp_res["score"]
        reasons, alignment = cmp_res.get("reasons", []), cmp_res.get("alignment", [])
        yield s.ev("compare", "ok", {"band": band, "score": score, "reasons": reasons, "alignment": alignment,
                                     "typed_parsed": cmp_res.get("typed_parsed"), "title_parsed": cmp_res.get("title_parsed"),
                                     "urdu_parsed": cmp_res.get("urdu_parsed")})

    # 3. history
    try:
        hist = history(req.remitter_id, req.iban)
        yield s.ev("history", "ok", hist)
    except Exception as e:
        hist = {"prior_transfers": None, "first": None, "last": None, "months": None}
        yield s.ev("history", "unavailable", {**hist, "error": f"graph unavailable: {type(e).__name__}"})

    # 4. decision
    dec = decide(band, bool(title), hist if hist.get("prior_transfers") is not None else {}, req.remitter_id, req.iban)
    yield s.ev("decision", "ok", {"band": band, **dec})

    # 5. phrase
    ph = phrase(case_id, req.typed_name, title, band, score, reasons, alignment)
    yield s.ev("phrase", "ok" if ph["source"] != "template" else "fallback", ph)

    # 6. ledger (auto-pass and holds need no analyst; close matches wait for the case agent)
    ledger = None
    if dec["action"] in ("auto_pass", "hold") and not config.DEMO_OFFLINE:
        try:
            ledger = anchor_decision(req, band, dec["action"], score)
        except Exception as e:
            ledger = {"anchored": False, "reason": f"{type(e).__name__}: {e}"}
        yield s.ev("ledger", "ok" if ledger.get("anchored") else "skipped", ledger)

    yield s.ev("final", "ok", {
        "scenario": scenario_for(req.iban), "case_id": ("case-" + case_id[3:]) if dec.get("open_case") else None,
        "payee_check_id": case_id, "bank": bank, "title": title, "urdu_name": urdu,
        "typed_name": req.typed_name, "band": band, "score": score, "reasons": reasons, "alignment": alignment,
        "history": hist, "decision": dec, "phrase": ph, "explain": {"en": ph["en"], "ur": ph["ur"]}, "ledger": ledger, "banner": dec.get("banner"),
        "case_trigger": dec.get("case_trigger")})


@router.post("/payee-check")
def payee_check(req: PayeeReq):
    sc = scenario_for(req.iban)
    def on_replay(events):
        fin = events[-1]["data"] if events else {}
        offline.note_egress(fin.get("payee_check_id"), f"egress-payee-{sc}")
    return sse.stream(lambda: run_payee(req), f"payee-{sc}" if sc else None, on_replay=on_replay)
