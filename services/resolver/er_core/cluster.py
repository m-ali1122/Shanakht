"""Union-find + greedy clique-cover refinement (ported from TaxNet
er/run_pipeline.py). Union-find takes the transitive closure of matched pairs,
so one false bridge merges two people; the clique cover splits each component
into sub-clusters whose members all link to each other above LINK_THRESHOLD."""
from __future__ import annotations


class UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        self.parent[self.find(a)] = self.find(b)


def greedy_clique_cover(members, score_of, link_threshold):
    remaining = set(members)
    out = []
    while remaining:
        seed = max(sorted(remaining),
                   key=lambda m: sum(score_of(m, o) for o in remaining if o != m))
        clique = [seed]
        remaining.discard(seed)
        while True:
            best, best_min = None, -1.0
            for cand in sorted(remaining):
                mins = min(score_of(cand, c) for c in clique)
                if mins >= link_threshold and mins > best_min:
                    best, best_min = cand, mins
            if best is None:
                break
            clique.append(best)
            remaining.discard(best)
        out.append(sorted(clique))
    return out


def cluster(rids, scores: dict, match_t: float, link_t: float):
    """scores: {(a,b): p} with a<b. Returns (clusters, splits)."""
    uf = UnionFind()
    for r in rids:
        uf.find(r)
    for (a, b), s in scores.items():
        if s >= match_t:
            uf.union(a, b)
    comps: dict = {}
    for r in rids:
        comps.setdefault(uf.find(r), []).append(r)

    def score_of(a, b):
        return scores.get((a, b) if a < b else (b, a), 0.0)

    out, splits = [], 0
    for members in comps.values():
        if len(members) <= 2:
            out.append(sorted(members))
            continue
        subs = greedy_clique_cover(members, score_of, link_t)
        splits += len(subs) > 1
        out.extend(subs)
    return out, splits
