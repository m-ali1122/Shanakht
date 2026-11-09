"""Replace identifiers with stable per-case tokens; re-identify model output locally.

Order: structured identifiers (fingerprints, devices, IBANs, CNICs, phones) ->
values already in the case vault -> caller-supplied names -> lexicon name runs
in free text (Roman and Urdu). Banks and exchange-house codes are left alone.
"""
from __future__ import annotations

import re

from fingerprint import normalize
from . import names as nm
from .patterns import STRUCTURED, TOKEN, URDU_WORD
from .vault import Vault

_WORD = re.compile(r"[A-Za-z][A-Za-z'.-]*|[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿‌]+")


def _key_for(kind: str, value: str) -> str:
    if kind == "person":
        return nm.name_key(value)
    if kind == "acct":
        return value.upper().replace(" ", "")
    if kind == "fp":
        return value.lower().removeprefix("0x")
    return normalize(kind, value)


class Pseudonymizer:
    def __init__(self, vault: Vault):
        self.vault = vault

    # ------------------------------------------------------------ single values
    def token(self, case_id: str, kind: str, value: str) -> str:
        tok, _ = self.vault.token_for(case_id, kind, _key_for(kind, value), value)
        return tok

    # ------------------------------------------------------------ free text
    def tokenize(self, case_id: str, text: str, names: list[str] | None = None) -> tuple[str, int]:
        """Return (tokenized text, substitutions made)."""
        if not text:
            return text, 0
        count = 0

        def sub_kind(kind, pattern, s):
            nonlocal count

            def repl(m):
                nonlocal count
                count += 1
                return self.token(case_id, kind, m.group(0))
            return pattern.sub(repl, s)

        for kind, pat in STRUCTURED:
            text = sub_kind(kind, pat, text)

        # Values already known to the vault for this case, plus caller names. Longest first.
        known = {}
        for tok, raw in self.vault.mapping(case_id).items():
            if len(raw) >= 3:
                known[raw] = tok
        for n in names or []:
            if n and len(n.strip()) >= 2:
                known.setdefault(n.strip(), self.token(case_id, "person", n.strip()))
        for raw in sorted(known, key=len, reverse=True):
            pat = re.compile(r"(?<![\w])" + re.escape(raw) + r"(?![\w])", re.I)
            text, n = pat.subn(known[raw], text)
            count += n

        text, n = self._lexicon_runs(case_id, text)
        return text, count + n

    def _lexicon_runs(self, case_id: str, text: str) -> tuple[str, int]:
        """Detect runs of name-lexicon words (incl. initials like 'M.' and relation markers)."""
        out, last, count = [], 0, 0
        words = list(_WORD.finditer(text))
        i = 0
        while i < len(words):
            j = i
            while j < len(words) and self._is_name_word(words[j].group(0), j > i):
                # words must be adjacent (only spaces / relation markers between them)
                if j > i and text[words[j - 1].end():words[j].start()].strip() not in ("", "/"):
                    break
                j += 1
            # require at least one real lexicon word (not just an initial)
            if j > i and any(self._is_lex(w.group(0)) for w in words[i:j]):
                # trim trailing relation markers
                while j > i and words[j - 1].group(0).lower() in ("s", "o", "d", "w", "bin", "bint"):
                    j -= 1
                start, end = words[i].start(), words[j - 1].end()
                surface = text[start:end]
                out.append(text[last:start])
                out.append(self.token(case_id, "person", surface))
                last = end
                count += 1
                i = j
            else:
                i += 1
        out.append(text[last:])
        return "".join(out), count

    @staticmethod
    def _is_lex(w: str) -> bool:
        if URDU_WORD.fullmatch(w):
            return w in nm.URDU_MAP
        return w.lower().strip(".'-") in nm.LEXICON

    def _is_name_word(self, w: str, inside: bool) -> bool:
        if self._is_lex(w):
            return True
        if re.fullmatch(r"[A-Z]\.", w):           # initial
            return True
        if inside and w.lower() in ("s", "o", "d", "w"):  # pieces of s/o
            return True
        return False

    # ------------------------------------------------------------ structures
    def tokenize_obj(self, case_id: str, obj, names: list[str] | None = None):
        """Recursively tokenize every string in a JSON-like object. Returns (obj, count)."""
        if isinstance(obj, str):
            return self.tokenize(case_id, obj, names)
        if isinstance(obj, list):
            total, out = 0, []
            for v in obj:
                v2, n = self.tokenize_obj(case_id, v, names)
                out.append(v2)
                total += n
            return out, total
        if isinstance(obj, dict):
            total, out = 0, {}
            for k, v in obj.items():
                v2, n = self.tokenize_obj(case_id, v, names)
                out[k] = v2
                total += n
            return out, total
        return obj, 0

    # ------------------------------------------------------------ re-identification
    def reidentify(self, case_id: str, text: str, keep_params: bool = True) -> str:
        """Replace bare tokens with real values. `$PERSON_1` (Cypher params) is left as-is."""
        if not text:
            return text
        mapping = self.vault.mapping(case_id)

        def repl(m):
            return mapping.get(m.group(0), m.group(0))
        out = TOKEN.sub(repl, text)
        if not keep_params:
            out = re.sub(r"\$((?:PERSON|ACCT|CNIC|PHONE|DEV|FP)_\d+)\b",
                         lambda m: mapping.get(m.group(1), m.group(0)), out)
        return out

    def reidentify_obj(self, case_id: str, obj):
        if isinstance(obj, str):
            return self.reidentify(case_id, obj)
        if isinstance(obj, list):
            return [self.reidentify_obj(case_id, v) for v in obj]
        if isinstance(obj, dict):
            return {k: self.reidentify_obj(case_id, v) for k, v in obj.items()}
        return obj

    def bind_params(self, case_id: str) -> dict[str, str]:
        """Cypher parameter map {PERSON_1: 'Faisal Nawaz', ...}, filled locally by the bank."""
        return self.vault.mapping(case_id)
