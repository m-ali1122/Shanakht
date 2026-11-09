"""Pairwise payee name comparison: band, score, deterministic reason codes and
a token alignment for the UI.

Reason codes come ONLY from features computed here. A language model may
phrase them later; it never adds or removes one.
"""
from __future__ import annotations

import os

import embed
from pk_names import FAMILY_NAMES, ParsedName, Token, parse, skeleton

MATCH_T = float(os.getenv("RESOLVER_MATCH_T", "0.95"))
CLOSE_T = float(os.getenv("RESOLVER_CLOSE_T", "0.75"))

REASON_CODES = ["VARIANT_SPELLING", "INITIAL_EXPANDED", "TITLE_DROPPED", "TITLE_ADDED",
                "PATRONYMIC_DROPPED", "SCRIPT_CONVERTED", "TOKEN_ORDER", "TYPO_1CHAR",
                "SURNAME_MISSING", "DIFFERENT_PERSON"]

# Credit a matched token pair earns, by how it matched.
REL_WEIGHT = {"exact": 1.0, "variant": 0.95, "transliterated": 0.84,
              "initial": 0.86, "typo": 0.86}
UNMATCHED_SURNAME_CREDIT = 0.6
PENALTY = {"PATRONYMIC_DROPPED": 0.02, "TITLE_DROPPED": 0.02, "TITLE_ADDED": 0.02,
           "TOKEN_ORDER": 0.03, "PATRONYMIC_CONFLICT": 0.25}
# Applied once per distinct reason; they compound with the penalties above so
# that any non-exact alignment stays below the MATCH threshold.
REASON_PENALTY = {"VARIANT_SPELLING": 0.02, "SCRIPT_CONVERTED": 0.02}
NON_EXACT_CAP = 0.94
W_TOKENS, W_EMBED = 0.85, 0.15


def lev1(a: str, b: str) -> bool:
    """True when edit distance (with adjacent transposition) is exactly 1."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        diff = [i for i in range(len(a)) if a[i] != b[i]]
        if len(diff) == 1:
            return True
        return (len(diff) == 2 and diff[1] == diff[0] + 1
                and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]])
    if len(a) > len(b):
        a, b = b, a
    for i in range(len(b)):
        if b[:i] + b[i + 1:] == a:
            return True
    return False


def _match_rel(t: Token, u: Token) -> tuple[str, str | None] | None:
    """How typed token t matches title token u -> (relation, reason) or None."""
    if t.canon == u.canon:
        if t.raw.lower().rstrip(".") == u.raw.lower().rstrip("."):
            return "exact", None
        if t.transliterated or u.transliterated:
            return "transliterated", "SCRIPT_CONVERTED"
        if t.abbrev or u.abbrev:
            return "initial", "INITIAL_EXPANDED"
        return "variant", "VARIANT_SPELLING"
    if (t.is_initial and len(t.canon) <= 2 and u.canon.startswith(t.canon)) or \
       (u.is_initial and len(u.canon) <= 2 and t.canon.startswith(u.canon)):
        return "initial", "INITIAL_EXPANDED"
    if skeleton(t.canon) == skeleton(u.canon) and len(t.canon) >= 3:
        return "variant", "VARIANT_SPELLING"
    if len(t.canon) >= 4 and len(u.canon) >= 4 and lev1(t.canon, u.canon):
        return "typo", "TYPO_1CHAR"
    return None


def _align(tt: list[Token], ut: list[Token]):
    """Greedy best-first alignment; initials are only expanded when the
    expansion is unambiguous within the pair."""
    order = ["exact", "variant", "transliterated", "typo", "initial"]
    cands = []
    for i, t in enumerate(tt):
        for j, u in enumerate(ut):
            r = _match_rel(t, u)
            if r:
                cands.append((order.index(r[0]), i, j, r))
    # ambiguity guard for initials: an initial with >1 possible expansion is skipped
    init_counts: dict = {}
    for _, i, j, r in cands:
        if r[0] == "initial" and tt[i].is_initial:
            init_counts[i] = init_counts.get(i, 0) + 1
    cands.sort()
    used_t, used_u, pairs = set(), set(), []
    for _, i, j, r in cands:
        if i in used_t or j in used_u:
            continue
        if r[0] == "initial" and tt[i].is_initial and init_counts.get(i, 0) > 1:
            # resolve only if exactly one *unused* expansion remains
            remaining = [jj for _, ii, jj, rr in cands
                         if ii == i and rr[0] == "initial" and jj not in used_u]
            if len(remaining) != 1:
                continue
        used_t.add(i)
        used_u.add(j)
        pairs.append((i, j, r[0], r[1]))
    pairs.sort()
    return pairs, used_t, used_u


def compare(typed_name: str, title_raw: str, urdu_name: str | None = None) -> dict:
    typed: ParsedName = parse(typed_name)
    title: ParsedName = parse(title_raw)
    urdu: ParsedName | None = parse(urdu_name) if urdu_name else None

    tt, ut = typed.core_tokens, title.core_tokens
    pairs, used_t, used_u = _align(tt, ut)
    reasons: list[str] = []
    alignment: list[dict] = []

    # Urdu anchor: a non-exact pair is confirmed when the KYC Urdu name, once
    # transliterated, contains the title's token. That is SCRIPT_CONVERTED.
    urdu_canon = {t.canon: t.raw for t in (urdu.core_tokens if urdu else [])}
    credit = 0.0
    for i, j, rel, reason in pairs:
        t, u = tt[i], ut[j]
        entry = {"typed_token": t.raw, "title_token": u.raw, "relation": rel,
                 "reason": reason}
        if urdu and rel in ("variant", "typo") and (u.canon in urdu_canon or
                                        skeleton(t.canon) in {skeleton(c) for c in urdu_canon}):
            entry["urdu_token"] = urdu_canon.get(u.canon)
            if reason and reason != "SCRIPT_CONVERTED":
                reasons.append(reason)
            reason = "SCRIPT_CONVERTED"
            rel = "transliterated"
            entry["relation"] = rel
        if reason:
            reasons.append(reason)
        credit += REL_WEIGHT[rel]
        alignment.append(entry)
    if title.script != "roman" and typed.script == "roman" or \
       typed.script != "roman" and title.script == "roman":
        reasons.append("SCRIPT_CONVERTED")

    # unmatched core tokens
    slots = len(pairs)
    surname_missing = False
    for i, t in enumerate(tt):
        if i in used_t:
            continue
        slots += 1
        is_surname = t.canon in FAMILY_NAMES and len(tt) > 1
        if is_surname and len(pairs) > 0:
            credit += UNMATCHED_SURNAME_CREDIT
            surname_missing = True
        alignment.append({"typed_token": t.raw, "title_token": None,
                          "relation": "extra", "reason": "SURNAME_MISSING" if is_surname else None})
    for j, u in enumerate(ut):
        if j in used_u:
            continue
        slots += 1
        is_surname = u.canon in FAMILY_NAMES and len(ut) > 1
        if is_surname and len(pairs) > 0:
            credit += UNMATCHED_SURNAME_CREDIT
            surname_missing = True
        alignment.append({"typed_token": None, "title_token": u.raw,
                          "relation": "extra", "reason": "SURNAME_MISSING" if is_surname else None})
    if surname_missing:
        reasons.append("SURNAME_MISSING")
    token_score = credit / slots if slots else 0.0

    # titles
    penalty = 0.0
    t_titles, u_titles = set(typed.titles), set(title.titles)
    for tk in typed.title_tokens:
        if tk.canon not in u_titles:
            alignment.append({"typed_token": tk.raw, "title_token": None,
                              "relation": "dropped", "reason": "TITLE_ADDED"})
            if "TITLE_ADDED" not in reasons:
                reasons.append("TITLE_ADDED")
                penalty += PENALTY["TITLE_ADDED"]
        else:
            u = next(x for x in title.title_tokens if x.canon == tk.canon)
            same = tk.raw.lower().rstrip(".") == u.raw.lower().rstrip(".")
            alignment.append({"typed_token": tk.raw, "title_token": u.raw,
                              "relation": "exact" if same else "variant",
                              "reason": None if same else "VARIANT_SPELLING"})
            if not same:
                reasons.append("VARIANT_SPELLING")
    for uk in title.title_tokens:
        if uk.canon not in t_titles:
            alignment.append({"typed_token": None, "title_token": uk.raw,
                              "relation": "dropped", "reason": "TITLE_DROPPED"})
            if "TITLE_DROPPED" not in reasons:
                reasons.append("TITLE_DROPPED")
                penalty += PENALTY["TITLE_DROPPED"]

    # patronymic
    if typed.patronymic and not title.patronymic:
        reasons.append("PATRONYMIC_DROPPED")
        penalty += PENALTY["PATRONYMIC_DROPPED"]
        for p in (typed.patronymic.get("tokens") or []):
            alignment.append({"typed_token": p.title(), "title_token": None,
                              "relation": "dropped", "reason": "PATRONYMIC_DROPPED",
                              "patronymic": typed.patronymic["relation"]})
    elif title.patronymic and not typed.patronymic:
        reasons.append("PATRONYMIC_DROPPED")
        penalty += PENALTY["PATRONYMIC_DROPPED"]
    elif typed.patronymic and title.patronymic:
        a = {skeleton(x) for x in typed.patronymic["tokens"]}
        b = {skeleton(x) for x in title.patronymic["tokens"]}
        if a and b and not (a & b):
            penalty += PENALTY["PATRONYMIC_CONFLICT"]

    # token order
    js = [j for _, j, _, _ in pairs]
    if any(js[k] > js[k + 1] for k in range(len(js) - 1)):
        reasons.append("TOKEN_ORDER")
        penalty += PENALTY["TOKEN_ORDER"]

    # stable de-dup in canonical code order
    seen = []
    for r in reasons:
        if r not in seen:
            seen.append(r)
    reasons = sorted(seen, key=REASON_CODES.index)
    penalty += sum(REASON_PENALTY.get(r, 0.0) for r in reasons)

    core_a = " ".join(t.raw.lower() for t in tt)
    core_b = " ".join(u.canon if u.transliterated else u.raw.lower() for u in ut)
    emb = embed.similarity(core_a, core_b) if pairs else 0.0
    score = W_TOKENS * max(0.0, token_score - penalty) + W_EMBED * emb
    if reasons:  # any non-exact alignment can never reach MATCH
        score = min(score, NON_EXACT_CAP)
    score = round(min(1.0, max(0.0, score)), 4)

    if score >= MATCH_T:
        band = "MATCH"
    elif score >= CLOSE_T:
        band = "CLOSE"
    else:
        band = "NO_MATCH"
    if band == "NO_MATCH" and (not pairs or token_score < 0.5):
        reasons.append("DIFFERENT_PERSON")

    return {
        "band": band, "score": score, "reasons": reasons, "alignment": alignment,
        "features": {"token_score": round(token_score, 4), "penalty": round(penalty, 4),
                     "embedding": round(emb, 4), "embedding_model": embed.available(),
                     "matched": len(pairs), "slots": slots},
        "typed_parsed": typed.to_dict(), "title_parsed": title.to_dict(),
        "urdu_parsed": urdu.to_dict() if urdu else None,
        "thresholds": {"match": MATCH_T, "close": CLOSE_T},
    }
