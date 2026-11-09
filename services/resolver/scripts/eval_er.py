"""Evaluate the ER core against data/out ground truth.

Honest protocol: people are split 50/50 by a hash of person_id. Fusion weights
are fitted on candidate pairs whose records belong to TRAIN people only, then
the full pipeline (blocking -> features -> fusion -> clique cover) is run on
TEST people's records and scored pairwise against ground truth. Numbers printed
here are the ones to quote; nothing is invented.

Usage (from repo root):
  .venv/Scripts/python.exe services/resolver/scripts/eval_er.py [--scope mrgl|all] [--save]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from itertools import combinations
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
REPO = HERE.parents[1]
OUT = REPO / "data" / "out"

from er_core import fusion                    # noqa: E402
from er_core.blocking import candidate_pairs   # noqa: E402
from er_core.pipeline import resolve_batch, score_pairs  # noqa: E402
from er_core.preprocess import preprocess      # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def _jsonl(p: Path) -> list[dict]:
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def load():
    recs = _jsonl(OUT / "records.jsonl")
    truth = {}
    gt_path = OUT / "ground_truth.jsonl"
    if gt_path.exists():
        for g in _jsonl(gt_path):
            rid = g.get("rid") or g.get("record_id")
            pid = g.get("person_id") or g.get("pid")
            if rid and pid:
                truth[rid] = pid
    for r in recs:
        rid = r.get("rid") or r.get("record_id")
        r["rid"] = rid
        if rid not in truth and r.get("person_id"):
            truth[rid] = r["person_id"]
        r.setdefault("raw_name", r.get("name") or r.get("full_name") or "")
    return recs, truth


def true_pairs(rids, truth):
    groups = {}
    for r in rids:
        groups.setdefault(truth.get(r, r), []).append(r)
    return {tuple(sorted(p)) for g in groups.values() for p in combinations(g, 2)}


def is_train(pid: str) -> bool:
    return int(hashlib.sha256(pid.encode()).hexdigest(), 16) % 2 == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scope", choices=["mrgl", "all"], default="all")
    ap.add_argument("--save", action="store_true", help="save fitted weights for the service")
    ap.add_argument("--no-cnic", action="store_true",
                    help="name-only: hide CNIC so only names/father/gender/Urdu are used")
    args = ap.parse_args()

    recs, truth = load()
    # Strip ground truth from what the pipeline sees.
    hide = {"person_id", "pid"} | ({"cnic_syn", "cnic_fp"} if args.no_cnic else set())
    clean = [{k: v for k, v in r.items() if k not in hide} for r in recs]
    if args.scope == "mrgl":
        clean = [r for r in clean if (r.get("bank") or r.get("bank_code")) == "MRGL"]
    print(f"scope={args.scope} records={len(clean)} people={len({truth.get(r['rid']) for r in clean})}")

    train = [r for r in clean if is_train(truth.get(r["rid"], r["rid"]))]
    test = [r for r in clean if not is_train(truth.get(r["rid"], r["rid"]))]

    # --- fit fusion on TRAIN candidate pairs
    pre = preprocess(train)
    pairs = sorted(candidate_pairs(pre))
    feats, _ = score_pairs(pre, pairs, fusion.DEFAULT_WEIGHTS)
    X = np.array([feats[p] for p in pairs], dtype=float)
    y = np.array([1 if truth.get(a) == truth.get(b) else 0 for a, b in pairs])
    print(f"train: records={len(train)} candidate_pairs={len(pairs)} positives={int(y.sum())}")
    if y.sum() == 0 or y.sum() == len(y):
        print("not enough positive/negative pairs to fit; using default weights")
        w = fusion.DEFAULT_WEIGHTS
    else:
        w = fusion.fit(X, y, save=args.save)

    # --- evaluate full pipeline on TEST
    res = resolve_batch(test, weights=w)
    pred = set()
    for c in res["clusters"]:
        pred |= {tuple(sorted(p)) for p in combinations(c["rids"], 2)}
    gold = true_pairs([r["rid"] for r in test], truth)
    tp = len(pred & gold)
    prec = tp / len(pred) if pred else 1.0
    rec = tp / len(gold) if gold else 1.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    gold_blocked = len(gold & set(candidate_pairs(preprocess(test))))
    print(f"test: records={len(test)} true_pairs={len(gold)} predicted_pairs={len(pred)}")
    print(f"blocking recall (true pairs surviving blocking) = "
          f"{gold_blocked / len(gold) if gold else 1.0:.3f}")
    print(f"PAIRWISE precision={prec:.3f} recall={rec:.3f} F1={f1:.3f}")
    print(f"stats={res['stats']}")
    report = {"scope": args.scope, "cnic": not args.no_cnic, "precision": round(prec, 4), "recall": round(rec, 4),
              "f1": round(f1, 4), "test_records": len(test), "true_pairs": len(gold),
              "predicted_pairs": len(pred), "weights": w}
    (HERE / "data" / f"eval_{args.scope}{'_namesonly' if args.no_cnic else ''}.json").write_text(json.dumps(report, indent=1),
                                                          encoding="utf-8")


if __name__ == "__main__":
    main()
