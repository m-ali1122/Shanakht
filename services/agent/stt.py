"""Local faster-whisper (adapted from hackathon_cust/backend/asr/local_whisper.py).

The dev box has a 2 GB MX450, so default is CPU int8 with the `small` model (STT_MODEL / STT_DEVICE / STT_COMPUTE).
Asking for large-v3 (or CUDA) that fails to load falls back to small on CPU instead of crashing."""
from __future__ import annotations

import io
import os
import re
import time
from threading import Lock

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import config

_model = None
_info = {}
_lock = Lock()

# A Roman-Urdu hint steers whisper toward Latin script for transliterated speech.
PROMPT = "Faisal Nawaz ne pichle mahine kitne logon ko paise bheje? Usman Ghani, Bilal Ahmed, Hamza Khan, Roman Urdu."


def _load():
    global _model
    from faster_whisper import WhisperModel
    tries = [(config.STT_MODEL, config.STT_DEVICE, config.STT_COMPUTE)]
    if config.STT_MODEL != "small" or config.STT_DEVICE != "cpu":
        tries.append(("small", "cpu", "int8"))
    last = None
    for name, dev, comp in tries:
        try:
            t0 = time.perf_counter()
            _model = WhisperModel(name, device=dev, compute_type=comp)
            _info.update(model=name, device=dev, compute=comp, load_s=round(time.perf_counter() - t0, 1))
            return
        except Exception as e:
            last = e
    raise RuntimeError(f"could not load whisper: {last}")


def transcribe(audio: bytes, language: str | None = None) -> dict:
    with _lock:
        if _model is None:
            _load()
    t0 = time.perf_counter()
    segs, info = _model.transcribe(io.BytesIO(audio), language=language, beam_size=5, vad_filter=True,
                                   initial_prompt=PROMPT)
    text = " ".join(s.text.strip() for s in segs).strip()
    return {"text": text, "language": getattr(info, "language", language), "stt": dict(_info),
            "stt_ms": int((time.perf_counter() - t0) * 1000)}


_URDU_CHARS = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")
ROMAN_URDU = {"ne", "kitne", "kitni", "kitna", "logon", "paise", "bheje", "bheja", "pichle", "mahine", "mahina", "kya",
              "hai", "hain", "ko", "se", "ka", "ki", "ke", "dikhao", "batao", "kaun", "kaunse", "kis", "sab", "saath",
              "mein", "main", "wale", "wala", "bhejay", "bhai", "aur", "kon", "kab", "kahan", "koi", "ap", "aap", "iska",
              "uska", "unhon", "jinhon", "tak", "liye", "par", "hua", "hui", "hue", "gaye", "gaya", "diye", "diya"}


def detect_language(text: str) -> dict:
    """Script check first, then the Roman-Urdu keyword list (>=2 distinct hits)."""
    if _URDU_CHARS.search(text or ""):
        return {"language": "ur", "script": "urdu", "method": "script"}
    words = set(re.findall(r"[a-z]+", (text or "").lower()))
    hits = sorted(words & ROMAN_URDU)
    if len(hits) >= 2:
        return {"language": "ur", "script": "roman", "method": "keywords", "hits": hits}
    return {"language": "en", "script": "latin", "method": "keywords", "hits": hits}
