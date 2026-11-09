"""Pakistani name parser.

Input: a raw name in Roman script, Urdu (Nastaliq/Naskh) or Shahmukhi.
Output: ParsedName with script, titles, given, family, patronymic,
tokens_canonical and the list of transformations applied.

Everything here is deterministic and table-driven: reason codes downstream are
derived from these transformations, never invented by a model.
"""
from __future__ import annotations

import json
import os
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

ARABIC_RE = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")
# Letters used in Shahmukhi (Punjabi) but not in standard Urdu.
SHAHMUKHI_MARKERS = set("ݨݙڄٻ")  # ݨ ݙ ڄ ٻ

# ------------------------------------------------------------------ tables
TITLES = {
    "raja": "raja", "ch": "chaudhry", "chaudhry": "chaudhry", "chaudhary": "chaudhry",
    "choudhry": "chaudhry", "chaudri": "chaudhry", "chohdry": "chaudhry",
    "chaudhri": "chaudhry", "choudhary": "chaudhry",
    "syed": "syed", "sayed": "syed", "sayyid": "syed", "sd": "syed",
    "mian": "mian", "malik": "malik", "sheikh": "sheikh", "shaikh": "sheikh",
    "sh": "sheikh", "rana": "rana", "hafiz": "hafiz", "dr": "dr", "engr": "engr",
    "mr": "mr", "mrs": "mrs", "ms": "ms", "haji": "haji", "mufti": "mufti",
}

RELATIONS = {
    "s/o": "s/o", "so": None, "d/o": "d/o", "w/o": "w/o",
    "son of": "s/o", "daughter of": "d/o", "wife of": "w/o",
    "bin": "s/o", "bint": "d/o", "binte": "d/o", "binti": "d/o",
    "ولد": "s/o", "بنت": "d/o", "زوجہ": "w/o", "دختر": "d/o",
}
_REL_RE = re.compile(
    r"\b(s\s*/\s*o|d\s*/\s*o|w\s*/\s*o|son\s+of|daughter\s+of|wife\s+of|bint[ei]?|bin)\b"
    r"|(ولد|بنت|زوجہ|دختر)",
    re.IGNORECASE,
)

# Variant -> canonical (section 4.4 of the spec, plus common extras).
VARIANTS = {
    "muhammad": ["mohammad", "muhammed", "mohd", "muhd", "mohammed", "mohamad",
                 "muhamad", "mohamed", "mhd", "md"],
    "ahmad": ["ahmed", "ahmd"],
    "hussain": ["hussein", "husain", "hussan", "husein", "hosain"],
    "abdulrehman": ["abdurrahman", "abdurrehman", "abdulrahman", "abdurahman",
                    "abdulrehman"],
    "zulfiqar": ["zulfikar", "zulfiquar", "zulfeqar", "zulfiqaar"],
    "chaudhry": ["chaudhary", "choudhry", "chaudri", "chaudhri", "choudhary"],
    "qureshi": ["quraishi", "qureishi", "quraishy", "qurashi"],
    "ayesha": ["aisha", "aysha", "ayisha", "ayesha", "aaisha"],
    "fatima": ["fatma", "fatimah", "fatema"],
    "mehmood": ["mahmood", "mehmud", "mahmud"],
    "yousaf": ["yousuf", "yusuf", "yusaf", "yousef"],
    "imran": ["imraan", "emran"],
    "usman": ["osman", "usmaan", "othman"],
    "rehmat": ["rahmat", "rehmet"],
    "rehman": ["rahman", "rehmaan"],
    "siddiqui": ["siddiqi", "siddique", "sidiqui"],
    "zainab": ["zaynab", "zenab"],
    "hamza": ["hamzah"],
    "bilal": ["bilaal"],
}
VARIANT_TO_CANON = {}
for _canon, _vs in VARIANTS.items():
    VARIANT_TO_CANON[_canon] = _canon
    for _v in _vs:
        VARIANT_TO_CANON[_v] = _canon
# Abbreviated forms: expanding these is INITIAL_EXPANDED, not just a spelling.
ABBREVIATIONS = {"mohd": "muhammad", "muhd": "muhammad", "mhd": "muhammad",
                 "md": "muhammad"}

FAMILY_NAMES = {
    "raja", "chaudhry", "malik", "sheikh", "syed", "mian", "khan", "butt",
    "qureshi", "awan", "siddiqui", "abbasi", "rajput", "bhatti", "mughal",
    "bibi", "ghani", "gill", "cheema", "warraich", "jutt", "jatt", "niazi",
    "khattak", "afridi", "baloch", "memon", "ansari", "hashmi", "gilani",
    "bukhari", "kazmi", "naqvi", "rizvi", "zaidi", "javed", "iqbal",
}

# Compound given names written with or without spaces/hyphens.
_COMPOUNDS = [
    (re.compile(r"\b(?:abd|abdu|abdul|abdur|abd-ul|abd-ur|a)[\s\-.]*(?:ul|ur|al|r)?[\s\-.]*"
                r"r[ae]h?h?ma+n\b", re.I), "abdulrehman"),
    (re.compile(r"\bghulam[\s\-]*ras[oo]u?l\b", re.I), "ghulamrasool"),
]
_COMPOUND_ROMAN = {"abdulrehman": "Abdul Rehman", "ghulamrasool": "Ghulam Rasool"}

# Character-level Urdu -> Roman fallback (used only when the script map misses).
URDU_CHARS = {
    "ا": "a", "آ": "aa", "أ": "a", "ب": "b", "پ": "p", "ت": "t", "ٹ": "t", "ث": "s",
    "ج": "j", "چ": "ch", "ح": "h", "خ": "kh", "د": "d", "ڈ": "d", "ذ": "z", "ر": "r",
    "ڑ": "r", "ز": "z", "ژ": "zh", "س": "s", "ش": "sh", "ص": "s", "ض": "z", "ط": "t",
    "ظ": "z", "ع": "a", "غ": "gh", "ف": "f", "ق": "q", "ک": "k", "ك": "k", "گ": "g",
    "ل": "l", "م": "m", "ن": "n", "ں": "n", "ݨ": "n", "و": "o", "ہ": "h", "ھ": "h",
    "ة": "a", "ء": "", "ی": "i", "ي": "i", "ے": "e", "ئ": "i", "ۓ": "e", "ؤ": "o",
    "ٻ": "b", "ڄ": "j", "ݙ": "d", "ۃ": "a",
}


# ------------------------------------------------------------------ script map
def _script_map_path() -> Path:
    env = os.getenv("SCRIPT_MAP_PATH")
    for p in ([Path(env)] if env else []) + [
        REPO / "data" / "generator" / "script_map.json",
        HERE / "data" / "script_map_fallback.json",
    ]:
        if p.exists():
            return p
    raise FileNotFoundError("no script_map.json found")


def _norm_ar(s: str) -> str:
    s = unicodedata.normalize("NFC", s)
    s = s.replace("ي", "ی").replace("ك", "ک").replace("ۀ", "ہ").replace("ة", "ہ")
    s = re.sub(r"[ً-ٰٟ]", "", s)  # harakat
    return s.strip()


@lru_cache(maxsize=1)
def script_map() -> dict:
    """urdu/shahmukhi string -> canonical roman (lowercase, compounds joined)."""
    blob = json.loads(_script_map_path().read_text(encoding="utf-8"))
    entries = blob
    if isinstance(blob, dict):
        for key in ("names", "entries", "map", "items"):
            if key in blob and isinstance(blob[key], list):
                entries = blob[key]
                break
        else:
            # plain {roman: urdu} or {urdu: roman}
            entries = []
            for k, v in blob.items():
                if isinstance(v, str):
                    if ARABIC_RE.search(k):
                        entries.append({"canonical": v, "urdu": k})
                    else:
                        entries.append({"canonical": k, "urdu": v})
                elif isinstance(v, dict):
                    entries.append({"canonical": k, **v})
    out = {}
    for e in entries:
        if not isinstance(e, dict):
            continue
        roman = (e.get("canonical") or e.get("roman_canonical") or e.get("roman")
                 or e.get("latin") or e.get("english") or "")
        roman = re.sub(r"[\s\-]+", "", roman.lower())
        roman = VARIANT_TO_CANON.get(roman, roman)
        if not roman:
            continue
        for k in ("urdu", "urdu_script", "ur", "shahmukhi", "pnb"):
            v = e.get(k)
            if isinstance(v, list):
                vals = v
            else:
                vals = [v] if v else []
            for val in vals:
                out[_norm_ar(val)] = roman
                out[_norm_ar(val).replace(" ", "")] = roman
    return out


def transliterate_token(tok: str) -> tuple[str, bool]:
    """Urdu/Shahmukhi token -> (canonical roman, from_map)."""
    smap = script_map()
    t = _norm_ar(tok)
    if t in smap:
        return smap[t], True
    out = "".join(URDU_CHARS.get(ch, "") for ch in t)
    out = re.sub(r"(.)\1+", r"\1", out)
    return VARIANT_TO_CANON.get(out, out), False


# ------------------------------------------------------------------ helpers
def detect_script(text: str) -> str:
    if not ARABIC_RE.search(text or ""):
        return "roman"
    if any(ch in SHAHMUKHI_MARKERS for ch in text):
        return "shahmukhi"
    return "urdu"


def skeleton(tok: str) -> str:
    """Spelling-by-ear key: collapse doubled letters and common vowel digraphs."""
    t = tok.lower()
    t = t.replace("ee", "i").replace("oo", "u").replace("ou", "u").replace("aa", "a")
    t = re.sub(r"(.)\1+", r"\1", t)
    t = re.sub(r"(?<=[bcdfgjklmnpqrstvwxz])h", "", t)  # aspiration: dh->d, rh->r
    return t


def canonical_token(tok: str) -> str:
    tok = tok.lower()
    if tok in VARIANT_TO_CANON:
        return VARIANT_TO_CANON[tok]
    if tok in ABBREVIATIONS:
        return ABBREVIATIONS[tok]
    return tok


@dataclass
class Token:
    raw: str            # as written (display form)
    canon: str          # canonical roman
    is_initial: bool = False
    transliterated: bool = False
    abbrev: bool = False


@dataclass
class ParsedName:
    raw: str
    script: str
    titles: list = field(default_factory=list)
    given: list = field(default_factory=list)
    family: list = field(default_factory=list)
    patronymic: dict | None = None
    tokens_canonical: list = field(default_factory=list)
    transformations: list = field(default_factory=list)
    # rich token info for alignment (not serialised in the public API)
    title_tokens: list = field(default_factory=list, repr=False)
    core_tokens: list = field(default_factory=list, repr=False)

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("title_tokens", None)
        d.pop("core_tokens", None)
        return d


def _split_tokens(text: str, script: str, transformations: list) -> list[Token]:
    """Tokenise a name fragment into Token objects (no title/relation logic)."""
    toks: list[Token] = []
    if script != "roman":
        smap = script_map()
        words = [w for w in re.split(r"\s+", _norm_ar(text)) if w]
        i = 0
        while i < len(words):
            # greedy two-word lookup for compounds ("غلام رسول", "بی بی")
            if i + 1 < len(words) and f"{words[i]} {words[i+1]}" in smap:
                canon = smap[f"{words[i]} {words[i+1]}"]
                toks.append(Token(raw=f"{words[i]} {words[i+1]}", canon=canon,
                                  transliterated=True))
                transformations.append(f"script_converted:{words[i]} {words[i+1]}->{canon}")
                i += 2
                continue
            if ARABIC_RE.search(words[i]):
                canon, _ = transliterate_token(words[i])
                toks.append(Token(raw=words[i], canon=canon, transliterated=True))
                transformations.append(f"script_converted:{words[i]}->{canon}")
            else:
                c = canonical_token(re.sub(r"[^a-z]", "", words[i].lower()))
                if c:
                    toks.append(Token(raw=words[i], canon=c))
            i += 1
        return toks

    s = text
    originals: dict = {}
    for k, (rx, repl) in enumerate(_COMPOUNDS):
        m = rx.search(s)
        if m:
            transformations.append(f"compound_joined:{m.group(0).strip()}->{repl}")
            originals[f"cmpd{k}x"] = (m.group(0).strip(), repl)
            s = rx.sub(f" cmpd{k}x ", s)
    for raw in s.split():
        if raw in originals:
            orig, repl = originals[raw]
            toks.append(Token(raw=orig, canon=repl))
            continue
        bare = raw.strip(",;:()[]")
        if not bare:
            continue
        is_init = bare.endswith(".") and len(bare.rstrip(".")) <= 3
        letters = re.sub(r"[^a-zA-Z]", "", bare).lower()
        if not letters:
            continue
        if len(letters) == 1:
            is_init = True
        if letters in ABBREVIATIONS:
            canon = ABBREVIATIONS[letters]
            transformations.append(f"initial_expanded:{letters}->{canon}")
            toks.append(Token(raw=bare.rstrip("."), canon=canon, abbrev=True))
            continue
        canon = canonical_token(letters)
        if canon != letters:
            transformations.append(f"variant:{letters}->{canon}")
        toks.append(Token(raw=bare.rstrip(".") if is_init else bare, canon=canon,
                          is_initial=is_init))
    return toks


def parse(raw: str) -> ParsedName:
    raw = raw or ""
    text = unicodedata.normalize("NFKC", raw).strip()
    script = detect_script(text)
    trans: list = []
    pn = ParsedName(raw=raw, script=script)

    # relation marker -> patronymic
    m = _REL_RE.search(text)
    head, tail, rel = text, "", None
    if m:
        marker = (m.group(1) or m.group(2) or "").lower()
        marker = re.sub(r"\s+", " ", marker.replace(" /", "/").replace("/ ", "/"))
        rel = RELATIONS.get(marker) or RELATIONS.get(marker.replace(" ", "")) or "s/o"
        head, tail = text[:m.start()], text[m.end():]
        trans.append(f"patronymic_split:{rel}")

    toks = _split_tokens(head, script, trans)
    # leading titles (and Urdu-script titles) -> titles[]
    title_toks: list[Token] = []
    core: list[Token] = []
    for i, t in enumerate(toks):
        key = t.canon
        is_title = key in TITLES and (len(toks) - len(title_toks) > 1)
        # a title is only a title while it precedes the core name
        if is_title and not core:
            t.canon = TITLES[key]
            title_toks.append(t)
            trans.append(f"title_stripped:{t.canon}")
        else:
            core.append(t)

    if tail.strip():
        ptoks = _split_tokens(tail, detect_script(tail), trans)
        ptoks = [p for p in ptoks if p.canon not in TITLES]
        pn.patronymic = {"relation": rel, "name": " ".join(p.canon for p in ptoks),
                         "tokens": [p.canon for p in ptoks]}

    pn.titles = [t.canon for t in title_toks]
    if len(core) >= 2 and core[-1].canon in FAMILY_NAMES:
        pn.family = [core[-1].canon]
        pn.given = [t.canon for t in core[:-1]]
    else:
        pn.given = [t.canon for t in core]
    pn.tokens_canonical = [t.canon for t in core]
    pn.transformations = trans
    pn.title_tokens = title_toks
    pn.core_tokens = core
    return pn


def display_roman(canon: str) -> str:
    return _COMPOUND_ROMAN.get(canon, canon.title())


if __name__ == "__main__":  # quick manual check
    import sys
    for arg in sys.argv[1:] or ["Mohd Ali s/o Rehmat", "راجہ عمران اکرم"]:
        print(json.dumps(parse(arg).to_dict(), ensure_ascii=False))
