"""Stage 4 (ported from TaxNet er/stage4_similarity.py): decoupled
multi-channel similarity features. TaxNet used the transformer, char n-grams,
address Jaccard and phone. Here the address channels are replaced with
name-structure channels from ParsedName: IDF-weighted token Jaccard, given and
family agreement, patronymic agreement Urdu-name agreement and gender. The patronymic comes from an s/o marker in the
name or, failing that, the KYC father's name (the CNIC carries it).
cnic_agree compares the CNIC (or its keyed fingerprint, cnic_fp); 0.5 when
either side lacks one, so the same weights work name-only.
Phone and device are deliberately NOT features: mule rings share phones across
different people, so identity must not be inferred from a shared phone."""
from __future__ import annotations

import math
from collections import Counter

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize

import embed
from pk_names import skeleton

FEATURE_ORDER = ["name_trans", "name_ngram", "idf_jaccard", "given_agree",
                 "family_agree", "patronymic_agree", "urdu_agree", "gender_agree", "cnic_agree"]


class FeatureBuilder:
    def __init__(self, recs: list[dict]):
        self.recs = recs
        self.idx = {r["rid"]: i for i, r in enumerate(recs)}
        names = [r["canonical_name"] or "_" for r in recs]
        df = Counter(t for r in recs for t in set(r["tokens"]))
        n = max(1, len(recs))
        self.idf = {t: math.log((n + 1) / (c + 1)) + 1.0 for t, c in df.items()}
        self.emb = embed.encode(names)
        tf = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 4))
        self.tf = normalize(tf.fit_transform(names))

    def _idf_jaccard(self, a: list, b: list) -> float:
        sa, sb = set(a), set(b)
        inter = sum(self.idf.get(t, 1.0) for t in sa & sb)
        union = sum(self.idf.get(t, 1.0) for t in sa | sb)
        return inter / union if union else 0.0

    def features(self, a: str, b: str) -> list[float]:
        ra, rb = self.recs[self.idx[a]], self.recs[self.idx[b]]
        ia, ib = self.idx[a], self.idx[b]
        trans = float(np.dot(self.emb[ia], self.emb[ib])) if self.emb is not None \
            else embed.ngram_cosine(ra["canonical_name"], rb["canonical_name"])
        ngram = float(self.tf[ia].multiply(self.tf[ib]).sum())
        ta, tb = ra["tokens"], rb["tokens"]
        given_agree = 1.0 if ta and tb and skeleton(ta[0]) == skeleton(tb[0]) else 0.0
        fa, fb = ra.get("family") or [], rb.get("family") or []
        family_agree = 0.5 if not fa or not fb else (1.0 if set(fa) & set(fb) else 0.0)
        pa, pb = ra.get("patronymic") or [], rb.get("patronymic") or []
        pat = 0.5 if not pa or not pb else self._idf_jaccard(
            [skeleton(x) for x in pa], [skeleton(x) for x in pb])
        ga, gb = ra.get("gender"), rb.get("gender")
        gender = 0.5 if not ga or not gb else (1.0 if ga == gb else 0.0)
        ca, cb = ra.get("cnic_fp"), rb.get("cnic_fp")
        cnic = 0.5 if not ca or not cb else (1.0 if ca == cb else 0.0)
        ua, ub = ra.get("urdu_tokens") or [], rb.get("urdu_tokens") or []
        urdu = 0.5 if not ua or not ub else self._idf_jaccard(ua, ub)
        return [round(trans, 4), round(ngram, 4), round(self._idf_jaccard(ta, tb), 4),
                given_agree, family_agree, round(pat, 4), round(urdu, 4), gender, cnic]
