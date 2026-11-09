"""Local Pakistani-name normalizer used by the pseudonymizer.

Goal: two spellings of one person get the same key ("Mohd Ali s/o Rehmat" and
"MUHAMMAD ALI" -> "ali muhammad"). Prefers the resolver's /parse (the real
parser) when reachable; this module is the offline fallback and also supplies
the name lexicon used to detect names inside free text (voice questions).
"""
from __future__ import annotations

import json
import re
import time
import unicodedata

import httpx

import config

VARIANTS = {
    "muhammad": ["mohammad", "muhammed", "mohd", "muhd", "mohammed", "mohamed", "mohamad"],
    "ahmad": ["ahmed"],
    "hussain": ["hussein", "husain", "hussan"],
    "abdulrehman": ["abdurrahman", "abdrehman", "abdulrahman", "abdur rahman", "abdul rehman", "abd-ul-rehman"],
    "zulfiqar": ["zulfikar", "zulfiquar"],
    "chaudhry": ["ch", "chaudhary", "choudhry", "chaudri"],
    "qureshi": ["quraishi", "qureishi"],
    "ayesha": ["aisha", "aysha", "ayisha"],
    "fatima": ["fatma", "fatimah"],
    "mehmood": ["mahmood", "mehmud"],
    "yousaf": ["yousuf", "yusuf"],
    "imran": ["imraan"],
    "usman": ["osman", "usmaan"],
    "rehman": ["rahman"],
}
CANON = {v: k for k, vs in VARIANTS.items() for v in vs}
for _k in VARIANTS:
    CANON[_k] = _k

TITLES = {"raja", "chaudhry", "syed", "mian", "malik", "sheikh", "rana", "hafiz", "dr", "engr", "mr", "mrs", "ms"}
RELATION_RE = re.compile(r"\b(s/o|d/o|w/o|son of|daughter of|wife of|bin|bint)\b|ولد|بنت", re.I)

GIVEN = ("muhammad ahmad ali imran usman bilal faisal tariq zulfiqar abdul rehman hamza hassan hussain "
         "shahid asif kamran naveed waqas adeel farhan ayesha fatima zainab maryam sana rabia hira nimra "
         "saima shazia amna iqra mehwish sadia rehmat nawaz akram aslam bashir ghulam rasool mehmood yousaf "
         "ghani bibi umar omar zahid khalid sajid majid arif").split()
FAMILY = "raja chaudhry malik sheikh syed mian khan butt qureshi awan siddiqui abbasi rajput bhatti mughal".split()

# Minimal built-in Urdu lexicon (extended by data/generator/script_map.json when present).
URDU_BUILTIN = {
    "محمد": "muhammad", "علی": "ali", "عمران": "imran", "اکرم": "akram", "راجہ": "raja",
    "احمد": "ahmad", "عثمان": "usman", "غنی": "ghani", "بلال": "bilal", "حمزہ": "hamza", "خان": "khan",
    "فیصل": "faisal", "نواز": "nawaz", "زینب": "zainab", "بی": "bibi", "بی‌بی": "bibi", "بیبی": "bibi",
    "طارق": "tariq", "محمود": "mehmood", "عائشہ": "ayesha", "صدیقی": "siddiqui", "رحمت": "rehmat",
    "کامران": "kamran", "بٹ": "butt", "فاطمہ": "fatima", "حسین": "hussain", "چوہدری": "chaudhry",
    "ملک": "malik", "شیخ": "sheikh", "سید": "syed", "قریشی": "qureshi", "یوسف": "yousaf",
    "غلام": "ghulam", "رسول": "rasool", "ذوالفقار": "zulfiqar", "عبدالرحمن": "abdulrehman",
}

URDU_CHAR_RE = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")


def _load_script_map() -> dict:
    out = dict(URDU_BUILTIN)
    try:
        data = json.loads(config.SCRIPT_MAP.read_text(encoding="utf-8"))
    except Exception:
        return out
    entries = data if isinstance(data, list) else data.get("names", data) if isinstance(data, dict) else []
    if isinstance(entries, dict):  # {urdu: roman} or {roman: {urdu:..}}
        for k, v in entries.items():
            if isinstance(v, str):
                if URDU_CHAR_RE.search(k):
                    out[k] = v.lower()
                elif URDU_CHAR_RE.search(v):
                    out[v] = k.lower()
            elif isinstance(v, dict):
                for field in ("urdu", "shahmukhi"):
                    if v.get(field):
                        out[v[field]] = k.lower()
        return out
    for e in entries:
        if not isinstance(e, dict):
            continue
        roman = (e.get("canonical") or e.get("roman") or e.get("canonical_roman") or "").lower()
        for field in ("urdu", "shahmukhi", "urdu_script"):
            if roman and e.get(field):
                out[e[field]] = roman
    return out


URDU_MAP = _load_script_map()
LEXICON = set(GIVEN) | set(FAMILY) | set(CANON) | {w for v in URDU_MAP.values() for w in v.split()}


def canon_token(tok: str) -> str:
    t = tok.lower().strip(".,-")
    if URDU_CHAR_RE.search(t):
        t = URDU_MAP.get(tok, t)
    return CANON.get(t, t)


def local_key(name: str) -> str:
    """Order-insensitive canonical key: titles and patronymic dropped, variants folded."""
    s = unicodedata.normalize("NFKC", name or "")
    m = RELATION_RE.search(s)
    if m:
        s = s[: m.start()]
    s = re.sub(r"[^\w\s؀-ۿ.]", " ", s)
    # Collapse multi-word canonical forms before tokenizing ("abdul rehman").
    low = s.lower()
    for multi in ("abdul rehman", "abdur rahman", "abd ul rehman"):
        low = low.replace(multi, "abdulrehman")
    toks = []
    for raw in low.split():
        if URDU_CHAR_RE.search(raw):
            # look the original-case token up (Urdu has no case)
            mapped = URDU_MAP.get(raw)
            if mapped:
                toks.extend(mapped.split())
            else:
                toks.append(raw)
            continue
        toks.append(canon_token(raw))
    toks = [t for t in toks if t and t not in TITLES]
    return " ".join(sorted(toks))


_resolver_down_until = 0.0


def name_key(name: str) -> str:
    """Use the resolver's parser when reachable (same canonicalization as matching)."""
    global _resolver_down_until
    if time.time() >= _resolver_down_until:
        try:
            r = httpx.post(f"{config.RESOLVER_URL}/parse", json={"name": name}, timeout=0.8)
            r.raise_for_status()
            p = r.json()
            toks = [t for t in p.get("tokens_canonical", []) if t]
            titles = {t.lower() for t in p.get("titles", [])}
            toks = [t for t in toks if t not in titles and t not in TITLES]
            if toks:
                return " ".join(sorted(toks))
        except Exception:
            _resolver_down_until = time.time() + 30
    return local_key(name)
