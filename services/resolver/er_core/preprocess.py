"""Stage 1 (ported from TaxNet er/stage1_preprocess.py, in-memory).

TaxNet's stage 1 tokenised raw names, built a corpus-level phonetic canonical
map (frequency-mode spelling per double-metaphone class) and expanded
abbreviations with Fellegi-Sunter co-occurrence probabilities. Here the
Pakistani-specific parsing is delegated to pk_names.parse (titles, s/o, Urdu,
variant table); the two corpus-level steps are kept, with one tightening: a
metaphone class only merges spellings that are also close in spelling
(skeleton-equal or edit distance 1). Plain metaphone would merge Hassan and
Hussain, which are different names.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict

from metaphone import doublemetaphone

from pk_names import parse, skeleton
from compare import lev1

ABBREV_EXPAND_THRESHOLD = 0.75  # TaxNet config.ABBREV_EXPAND_THRESHOLD


def build_canonical_map(token_lists: list[list[str]]) -> dict:
    freq = Counter(t for toks in token_lists for t in toks if len(t) >= 3)
    groups = defaultdict(list)
    for tok, n in freq.items():
        code = doublemetaphone(tok)[0]
        if code:
            groups[code].append((n, tok))
    canonical = {}
    for members in groups.values():
        members.sort(reverse=True)
        heads: list[str] = []
        for _, tok in members:          # most frequent spelling first
            for h in heads:
                if skeleton(h) == skeleton(tok) or lev1(h, tok):
                    canonical[tok] = h
                    break
            else:
                heads.append(tok)
                canonical[tok] = tok
    return canonical


def build_abbrev_expansion(token_lists: list[list[str]]):
    """P(full given name | initial, surname) from corpus co-occurrence."""
    cooc = defaultdict(Counter)
    global_counts = Counter()
    for toks in token_lists:
        full = [t for t in toks if len(t) >= 3]
        if len(full) >= 2:
            cooc[full[-1]][full[0]] += 1
            global_counts[full[0]] += 1

    def expand(abbrev: str, surname: str):
        for ctx, counter in ((surname, cooc.get(surname)), ("corpus", global_counts)):
            if not counter:
                continue
            cands = {f: n for f, n in counter.items() if f.startswith(abbrev)}
            total = sum(cands.values())
            if total:
                best = max(cands, key=cands.get)
                p = cands[best] / total
                if p > ABBREV_EXPAND_THRESHOLD:
                    return best, p, ctx
        return None

    return expand


def preprocess(records: list[dict]) -> list[dict]:
    """records: [{rid, raw_name, urdu_name?, ...}] -> enriched copies."""
    parsed = [parse(r.get("raw_name") or r.get("name") or "") for r in records]
    token_lists = [p.tokens_canonical for p in parsed]
    canonical = build_canonical_map(token_lists)
    expand = build_abbrev_expansion([[canonical.get(t, t) for t in tl] for tl in token_lists])
    out = []
    for r, p in zip(records, parsed):
        toks = [canonical.get(t, t) for t in p.tokens_canonical]
        surname = next((t for t in reversed(toks) if len(t) >= 3), "")
        log = []
        final = []
        for t in toks:
            if len(t) <= 2:
                res = expand(t, surname)
                if res:
                    final.append(res[0])
                    log.append(f"{t}. -> {res[0].title()} (p={res[1]:.3f}, context={res[2]})")
                    continue
            final.append(t)
        urdu_toks = []
        if r.get("urdu_name"):
            urdu_toks = [canonical.get(t, t) for t in parse(r["urdu_name"]).tokens_canonical]
        out.append({**r, "rid": r.get("rid") or r.get("record_id"),
                    "tokens": final, "canonical_name": " ".join(final),
                    "titles": p.titles, "family": p.family,
                    "patronymic": ((p.patronymic or {}).get("tokens")
                                   or ([canonical.get(t, t) for t in
                                        parse(r["father_name"]).tokens_canonical]
                                       if r.get("father_name") else [])),
                    "cnic_fp": r.get("cnic_fp") or (re.sub(r"\D", "", r["cnic_syn"])
                                                    if r.get("cnic_syn") else None),
                    "urdu_tokens": urdu_toks, "expansion_log": log})
    return out
