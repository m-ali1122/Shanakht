"""P9: voice and typed questions -> text-to-Cypher (guarded, self-repairing) -> VOICE_ANSWER."""
from __future__ import annotations

import datetime
import json
import re
import uuid

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import config
import graphdb
import sse
import stt
from cypher_guard import clean
from cypher_session import CypherSession
from gateway import GatewayBlocked, get_gateway, parse_json
from gateway import names as nm
from prompts import CYPHER_EXAMPLES, SCHEMA, TEXT_TO_CYPHER, VOICE_ANSWER

router = APIRouter(tags=["voice"])
MAX_ATTEMPTS = 3          # first try + 2 repairs


class TextReq(BaseModel):
    text: str
    language: str | None = None
    qid: str | None = None


def _norm(t: str) -> str:
    return re.sub(r"[^a-z0-9؀-ۿ]+", " ", (t or "").lower()).strip()


def qid_for(text: str) -> str | None:
    try:
        sc = json.loads((config.ROOT_DIR / "demo" / "scenarios.json").read_text(encoding="utf-8"))["scenarios"]
        for s in sc:
            for q in s.get("voice_queries", []):
                if _norm(q["text"]) == _norm(text):
                    return q["qid"]
    except Exception:
        pass
    return None


def graph_names(text: str) -> list[str]:
    """Names in the question that exist in the graph (exact, case-insensitive), so the gateway can tokenize them
    even when they are not in the lexicon. Urdu-script words are mapped to Roman first."""
    words = [nm.URDU_MAP.get(w, w) if re.search(r"[؀-ۿ]", w) else w for w in re.findall(r"[^\W\d_]+", text)]
    cands = {" ".join(words[i:i + n]).lower() for n in (2, 3) for i in range(len(words) - n + 1)}
    cands |= {w.lower() for w in words if len(w) >= 4}
    if not cands:
        return []
    try:
        rows = graphdb.run_read(
            "MATCH (r:Remitter) WHERE toLower(r.name) IN $c RETURN r.name AS n "
            "UNION MATCH (r:Record) WHERE toLower(r.raw_name) IN $c RETURN r.raw_name AS n "
            "UNION MATCH (p:Person) WHERE toLower(p.canonical_name) IN $c RETURN p.canonical_name AS n",
            {"c": sorted(cands)})
        return sorted({r["n"] for r in rows if r["n"]}, key=len, reverse=True)
    except Exception:
        return []


def date_anchors(today: str) -> dict:
    """Calendar anchors (UTC datetime literals) computed from today's date for the Cypher prompt."""
    d = datetime.date.fromisoformat(today)
    this_m = d.replace(day=1)
    last_m = (this_m - datetime.timedelta(days=1)).replace(day=1)
    q = this_m.replace(month=3 * ((d.month - 1) // 3) + 1)
    f = lambda x: f"{x.isoformat()}T00:00:00Z"
    return {"this_month_start": f(this_m), "last_month_start": f(last_m), "quarter_start": f(q)}


def answer_text(text: str, language: str | None = None, runner=None, gate=None) -> dict:
    gw = get_gateway()
    case_id = "voice-" + uuid.uuid4().hex[:10]
    det = stt.detect_language(text)
    lang = language or det["language"]
    names = graph_names(text) if runner is None else []
    sess = CypherSession(gw, case_id, runner=runner, gate=gate)
    result = {"transcript": text, "language": lang, "language_detection": det, "case_id": case_id,
              "cypher_attempts": [], "rows": [], "answer": None, "highlight_ids": []}
    prompt = TEXT_TO_CYPHER.format(schema=SCHEMA, today=config.TODAY, question=text,
                                   examples=CYPHER_EXAMPLES, **date_anchors(config.TODAY))
    msgs = [{"role": "user", "content": prompt}]
    rec = None
    try:
        for n in range(MAX_ATTEMPTS):
            res = gw.complete(case_id, msgs, names=names, purpose="text_to_cypher")
            q = clean(res.content)                       # $PERSON_1 parameters stay as parameters
            rec = sess.execute(q)
            result["cypher_attempts"].append({"attempt": n + 1, "query": rec["query"], "ok": rec["ok"],
                                              "status": ("repaired" if n > 0 else "ok") if rec["ok"] else "error",
                                              "error": rec["error"], "repair": n > 0})
            if rec["ok"]:
                break
            msgs += [{"role": "assistant", "content": res.content_tokens},
                     {"role": "user", "content": f"The query failed with this error: {rec['error']}\n"
                                                 "Fix that specific error and output only the corrected query."}]
        if not (rec and rec["ok"]):
            result["error"] = "no valid query after 2 repairs"
            return result
        result["rows_data"] = rec["rows"]
        result["rows"] = len(rec["rows"])
        result["integrity"] = rec["gate"]
        ctx = {"question": text, "language": lang, "rows": rec["view"]}
        res = gw.complete(case_id, [{"role": "system", "content": VOICE_ANSWER},
                                    {"role": "user", "content": json.dumps(ctx, ensure_ascii=False)}],
                          json_schema={"type": "object"}, names=names, purpose="voice_answer")
        out = parse_json(res.content_tokens)
        result["answer"] = gw.reidentify(case_id, str(out.get("answer", "")))
        hl = [gw.reidentify(case_id, h) for h in out.get("highlight_ids", []) if isinstance(h, str)]
        result["highlight_ids"] = [h for h in dict.fromkeys(hl) if h in sess.seen]
        if not result["highlight_ids"]:                  # fall back to ids present in the verified rows
            result["highlight_ids"] = sorted(s for s in sess.seen if re.match(r"^(R-|RM-|PK\d\d|P\d)", s))[:30]
    except GatewayBlocked as e:
        result["error"] = str(e)
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {str(e)[:200]}"
    return result


def _cached(qid: str | None):
    if config.DEMO_OFFLINE and qid:
        c = sse.load_cache(f"voice-{qid}")
        if c:
            return c["result"]
    return None


def _record(qid: str | None, res: dict):
    if qid and config.DEMO_RECORD and not res.get("error") and res.get("answer"):
        sse.save_cache(f"voice-{qid}", [], {"result": res})


@router.post("/voice/text")
def voice_text(req: TextReq):
    qid = req.qid or qid_for(req.text)
    hit = _cached(qid)
    if hit:
        return {**hit, "replayed": True}
    res = answer_text(req.text, req.language)
    _record(qid, res)
    return res


@router.post("/voice")
def voice(audio: UploadFile = File(...), language: str | None = Form(None), qid: str | None = Form(None)):
    hit = _cached(qid)
    if hit:
        return {**hit, "replayed": True}
    data = audio.file.read()
    try:
        tr = stt.transcribe(data, language)
    except Exception as e:
        return JSONResponse(status_code=503, content={"error": f"speech-to-text failed: {e}", "fallback": "browser"})
    qid = qid or qid_for(tr["text"])
    res = answer_text(tr["text"], language)
    res["stt"] = {**tr["stt"], "stt_ms": tr["stt_ms"], "detected": tr["language"]}
    _record(qid, res)
    return res
