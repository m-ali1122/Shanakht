"""Logistic-regression fusion (ported from TaxNet er/train_fusion.py).

fit() learns field weights from labelled candidate pairs (class-balanced LR)
and picks the F1-optimal threshold subject to a precision floor. Weights are
saved to er_core/fusion_weights.json and used by the service at runtime.
Before any fit, DEFAULT_WEIGHTS (name-led, hand-set) are used."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .features import FEATURE_ORDER

WEIGHTS_PATH = Path(__file__).resolve().parent / "fusion_weights.json"
PRECISION_FLOOR = 0.80
DEFAULT_WEIGHTS = {"feature_order": FEATURE_ORDER,
                   "coef": [4.0, 2.0, 3.0, 1.0, 1.0, 4.0, 1.0, 1.0, 8.0],
                   "intercept": -12.0, "auto_match": 0.9, "link_threshold": 0.8}


def load_weights() -> dict:
    if WEIGHTS_PATH.exists():
        return json.loads(WEIGHTS_PATH.read_text(encoding="utf-8"))
    return DEFAULT_WEIGHTS


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def fuse(fv: list[float], w: dict) -> float:
    order = w["feature_order"]
    z = w["intercept"] + sum(c * fv[FEATURE_ORDER.index(f)] for c, f in zip(w["coef"], order))
    return _sigmoid(z)


def fit(X: np.ndarray, y: np.ndarray, save: bool = True, verbose: bool = True) -> dict:
    from sklearn.linear_model import LogisticRegression
    clf = LogisticRegression(class_weight="balanced", max_iter=2000, C=1.0)
    clf.fit(X, y)
    prob = clf.predict_proba(X)[:, 1]
    pos = int(y.sum())

    def pr_at(t):
        pred = prob >= t
        tp = int((pred & (y == 1)).sum())
        fp = int((pred & (y == 0)).sum())
        return (tp / (tp + fp) if tp + fp else 1.0), (tp / pos if pos else 0.0)

    best_t, best_f1, any_t, any_f1 = None, -1.0, 0.9, -1.0
    for t in np.linspace(0.5, 0.999, 500):
        p, r = pr_at(t)
        f1 = 2 * p * r / (p + r) if p + r else 0.0
        if f1 > any_f1:
            any_f1, any_t = f1, float(t)
        if p >= PRECISION_FLOOR and f1 > best_f1:
            best_f1, best_t = f1, float(t)
    # Floor unreachable, or only met by a degenerate threshold that keeps almost
    # no recall (the names-only F1=0 bug): take the unconstrained F1 optimum.
    if best_t is None or best_f1 < 0.8 * any_f1:
        best_t, best_f1 = any_t, any_f1
        if verbose:
            print(f"  precision floor {PRECISION_FLOOR} unreachable/degenerate; using F1-optimal T")
    w = {"feature_order": FEATURE_ORDER, "coef": clf.coef_[0].tolist(),
         "intercept": float(clf.intercept_[0]), "auto_match": round(best_t, 3),
         "link_threshold": round(max(0.5, best_t - 0.1), 3)}
    if verbose:
        print("learned fusion weights (class-balanced LR):")
        for f, c in zip(FEATURE_ORDER, w["coef"]):
            print(f"  {f:<17} {c:+.3f}")
        print(f"  intercept {w['intercept']:+.3f}  threshold={w['auto_match']} "
              f"(train pairwise F1={best_f1:.3f})")
    if save:
        WEIGHTS_PATH.write_text(json.dumps(w, indent=1), encoding="utf-8")
    return w
