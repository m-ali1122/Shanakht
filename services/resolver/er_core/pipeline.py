"""In-memory ER pipeline: preprocess -> block -> features -> fuse -> cluster."""
from __future__ import annotations

import hashlib
import time
from collections import Counter

from .blocking import candidate_pairs
from .cluster import cluster
from .features import FeatureBuilder
from .fusion import fuse, load_weights
from .preprocess import preprocess


def score_pairs(recs, pairs, weights):
    fb = FeatureBuilder(recs)
    feats, scores = {}, {}
    for a, b in pairs:
        fv = fb.features(a, b)
        feats[(a, b)] = fv
        scores[(a, b)] = fuse(fv, weights)
    return feats, scores


def person_id(members: list[str]) -> str:
    return "P-" + hashlib.sha256("|".join(sorted(members)).encode()).hexdigest()[:10]


def resolve_batch(records: list[dict], weights: dict | None = None,
                  return_edges: bool = False) -> dict:
    t0 = time.perf_counter()
    weights = weights or load_weights()
    recs = preprocess(records)
    by_id = {r["rid"]: r for r in recs}
    pairs = sorted(candidate_pairs(recs))
    feats, scores = score_pairs(recs, pairs, weights)
    clusters, splits = cluster([r["rid"] for r in recs], scores,
                               weights["auto_match"], weights.get("link_threshold", 0.8))
    out = []
    for members in clusters:
        toks = Counter(by_id[m]["canonical_name"] for m in members)
        canonical = toks.most_common(1)[0][0].title()
        internal = [scores[(a, b)] for i, a in enumerate(members)
                    for b in members[i + 1:] if (a, b) in scores]
        out.append({"person_id": person_id(members), "rids": members,
                    "canonical_name": canonical,
                    "confidence": round(sum(internal) / len(internal), 4) if internal else 1.0,
                    "member_scores": {m: (round(max([scores.get((min(m, o), max(m, o)), 0.0)
                                                     for o in members if o != m] or [1.0]), 4))
                                      for m in members},
                    "evidence": sorted({e for m in members for e in by_id[m]["expansion_log"]})})
    res = {"clusters": out,
           "stats": {"records": len(recs), "candidate_pairs": len(pairs),
                     "clusters": len(out), "multi_record": sum(len(c["rids"]) > 1 for c in out),
                     "clique_splits": splits, "seconds": round(time.perf_counter() - t0, 2),
                     "threshold": weights["auto_match"]}}
    if return_edges:
        res["_scores"] = scores
        res["_features"] = feats
    return res
