"""Stages 2 and 3 (ported from TaxNet er/stage2_phonetic.py and
er/stage3_blocking.py): a union of phonetic codes (DoubleMetaphone primary and
secondary, Soundex, RefinedSoundex) per token, used as blocking keys, with
recall-safe sub-blocking of oversized blocks. TaxNet blocked on
code|city; there is no address here, so the key is the code alone and the
Urdu-name tokens contribute codes too."""
from __future__ import annotations

from collections import defaultdict
from itertools import combinations

from metaphone import doublemetaphone
from pyphonetics import RefinedSoundex, Soundex

BLOCK_PAIR_CAP = 2000
_soundex, _refined = Soundex(), RefinedSoundex()


def codes_for_token(token: str) -> set:
    out = set()
    try:
        out.update(c for c in doublemetaphone(token) if c)
    except Exception:
        pass
    for algo in (_soundex, _refined):
        try:
            c = algo.phonetics(token)
            if c:
                out.add(f"{algo.__class__.__name__[:2]}:{c}")
        except Exception:
            pass
    return out or {token}


def token_class(t: str) -> str:
    return doublemetaphone(t)[0] or t


def subblock_keys(tokens: list) -> list:
    toks = [t for t in tokens if t]
    keys = []
    if toks:
        surname = token_class(toks[-1])
        for g in (toks[:-1] if len(toks) >= 2 else toks):
            keys.append(("S", surname, g[0]))
    classes = sorted({token_class(t) for t in toks})
    for a, b in combinations(classes, 2):
        keys.append(("P", a, b))
    return keys


def candidate_pairs(recs: list[dict]) -> set:
    block_index = defaultdict(list)
    sub = {}
    for r in recs:
        toks = [t for t in r["tokens"] if len(t) >= 2] + r.get("urdu_tokens", [])
        codes = set()
        for t in toks:
            codes |= codes_for_token(t)
        for c in codes:
            block_index[c].append(r["rid"])
        sub[r["rid"]] = subblock_keys(r["tokens"])
    pairs = set()
    for members in block_index.values():
        members = sorted(set(members))
        n = len(members)
        if n < 2:
            continue
        if n * (n - 1) // 2 <= BLOCK_PAIR_CAP:
            pairs.update(combinations(members, 2))
        else:
            buckets = defaultdict(list)
            for rid in members:
                for k in sub[rid]:
                    buckets[k].append(rid)
            for b in buckets.values():
                if len(b) >= 2:
                    pairs.update(combinations(sorted(set(b)), 2))
    return pairs
