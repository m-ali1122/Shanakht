"""Epoch commits, proofs, tamper — the evidence-integrity service (P6b)."""
from __future__ import annotations

import threading
import time

from . import merkle
from .graph_source import GraphSource
from .leaves import leaf_hash
from .store import LeafStore, LocalRootStore


class IntegrityService:
    def __init__(self, graph: GraphSource, store: LeafStore, roots=None, chain=None):
        """`roots` forces a root store (tests). Otherwise: on-chain GraphRootLog when the
        chain is reachable, else a local root store seeded from the leaf table."""
        self.graph = graph
        self.store = store
        self._forced_roots = roots
        self.chain = chain
        self._local = LocalRootStore()
        last = store.latest_epoch()
        if last:
            self._local._roots[last["epoch"]] = last["root"]
        self._tree: tuple[int, merkle.MerkleTree, dict] | None = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------ roots
    def roots(self):
        if self._forced_roots is not None:
            return self._forced_roots
        if self.chain is not None and self.chain.available():
            from .store import ChainRootStore
            return ChainRootStore(self.chain)
        return self._local

    # ------------------------------------------------------------ commit
    def commit(self) -> dict:
        t0 = time.perf_counter()
        with self._lock:
            elements = sorted(self.graph.snapshot(), key=lambda e: e.id)
            # De-duplicate ids defensively (first wins) so the tree is well-defined.
            seen, uniq = set(), []
            for e in elements:
                if e.id not in seen:
                    seen.add(e.id)
                    uniq.append(e)
            leaves = [leaf_hash(e) for e in uniq]
            tree = merkle.MerkleTree(leaves)
            roots = self.roots()
            last = self.store.latest_epoch()
            epoch = max(roots.latest()[0], last["epoch"] if last else 0) + 1
            nodes = sum(1 for e in uniq if e.kind == "node")
            edges = len(uniq) - nodes
            tx = roots.commit(epoch, tree.root, nodes, edges)
            if roots is not self._local:
                self._local._roots[epoch] = tree.root
            rows = [(e.id, i, l, e.key_value, e.kind, e.label) for i, (e, l) in enumerate(zip(uniq, leaves))]
            self.store.save_epoch(epoch, tree.root, rows, nodes, edges, tx.get("tx"), tx.get("block"))
            self._tree = (epoch, tree, {e.id: i for i, e in enumerate(uniq)})
        return {"epoch": epoch, "root": tree.root, "node_count": nodes, "edge_count": edges,
                "leaves": len(leaves), "tx": tx.get("tx"), "block": tx.get("block"),
                "root_source": roots.name, "ms": int((time.perf_counter() - t0) * 1000)}

    def _cached_tree(self):
        last = self.store.latest_epoch()
        if not last:
            return None
        if self._tree is None or self._tree[0] != last["epoch"]:
            rows = self.store.all_leaves()
            tree = merkle.MerkleTree([l for _, l in rows])
            self._tree = (last["epoch"], tree, {eid: i for i, (eid, _) in enumerate(rows)})
        return self._tree

    # ------------------------------------------------------------ prove
    def prove(self, element_ids: list[str]) -> dict:
        t0 = time.perf_counter()
        ids = list(dict.fromkeys(element_ids))
        cached = self._cached_tree()
        roots = self.roots()
        chain_epoch, chain_root = roots.latest()
        stored = self.store.get(ids)
        current = self.graph.fetch(ids)
        items = []
        for eid in ids:
            item = {"element_id": eid, "status": "missing", "leaf_current": None, "leaf_epoch": None, "proof": []}
            cur = current.get(eid)
            if cur is not None:
                item["leaf_current"] = leaf_hash(cur)
            if eid in stored and cached:
                idx, leaf = stored[eid]
                item["leaf_epoch"] = leaf
                item["proof"] = cached[1].proof(idx)
                if cur is None:
                    item["status"] = "missing"
                elif item["leaf_current"] != leaf:
                    item["status"] = "changed"
                elif merkle.verify(item["proof"], chain_root, leaf):
                    item["status"] = "verified"
                else:
                    item["status"] = "changed"
                    item["reason"] = "proof does not match committed root"
            items.append(item)
        n_ok = sum(1 for i in items if i["status"] == "verified")
        return {"epoch": chain_epoch, "root": chain_root, "root_source": roots.name,
                "verified": n_ok, "total": len(items), "items": items,
                "ms": int((time.perf_counter() - t0) * 1000)}

    # ------------------------------------------------------------ tamper (demo)
    def tamper(self, element_id: str) -> dict:
        # The leaf table is deliberately untouched: this simulates an insider edit.
        return self.graph.tamper(element_id)

    def status(self) -> dict:
        last = self.store.latest_epoch()
        roots = self.roots()
        try:
            e, r = roots.latest()
        except Exception as ex:  # chain hiccup
            e, r = None, f"error: {ex}"
        return {"root_source": roots.name, "chain_epoch": e, "chain_root": r, "local": last}
