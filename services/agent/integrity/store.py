"""Leaf side table (SQLite) + root stores (on-chain or local fallback)."""
from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path
from typing import Protocol


class LeafStore:
    """Keeps the leaves of the latest committed epoch, keyed by element id."""

    def __init__(self, path: Path | str):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS epochs(epoch INTEGER PRIMARY KEY, root TEXT, node_count INTEGER,
                edge_count INTEGER, ts REAL, tx TEXT, block INTEGER);
            CREATE TABLE IF NOT EXISTS leaves(element_id TEXT PRIMARY KEY, idx INTEGER, leaf TEXT,
                key_value TEXT, kind TEXT, label TEXT);
            CREATE INDEX IF NOT EXISTS leaves_key ON leaves(key_value);
        """)
        self._db.commit()

    def save_epoch(self, epoch: int, root: str, rows: list[tuple], node_count: int, edge_count: int,
                   tx: str | None, block: int | None):
        """rows: (element_id, idx, leaf, key_value, kind, label)"""
        with self._lock:
            self._db.execute("DELETE FROM leaves")
            self._db.executemany("INSERT INTO leaves VALUES(?,?,?,?,?,?)", rows)
            self._db.execute("INSERT OR REPLACE INTO epochs VALUES(?,?,?,?,?,?,?)",
                             (epoch, root, node_count, edge_count, time.time(), tx, block))
            self._db.commit()

    def latest_epoch(self) -> dict | None:
        with self._lock:
            r = self._db.execute("SELECT epoch, root, node_count, edge_count, ts, tx, block FROM epochs "
                                 "ORDER BY epoch DESC LIMIT 1").fetchone()
        if not r:
            return None
        return dict(zip(["epoch", "root", "node_count", "edge_count", "ts", "tx", "block"], r))

    def all_leaves(self) -> list[tuple[str, str]]:
        """[(element_id, leaf)] ordered by tree index."""
        with self._lock:
            return self._db.execute("SELECT element_id, leaf FROM leaves ORDER BY idx").fetchall()

    def get(self, element_ids: list[str]) -> dict[str, tuple[int, str]]:
        out = {}
        with self._lock:
            for i in range(0, len(element_ids), 500):
                chunk = element_ids[i:i + 500]
                q = f"SELECT element_id, idx, leaf FROM leaves WHERE element_id IN ({','.join('?' * len(chunk))})"
                for eid, idx, leaf in self._db.execute(q, chunk):
                    out[eid] = (idx, leaf)
        return out

    def ids_for_keys(self, values: list[str]) -> dict[str, list[str]]:
        """business key value -> element ids (used by the verified-context gate)."""
        out: dict[str, list[str]] = {}
        with self._lock:
            for i in range(0, len(values), 500):
                chunk = values[i:i + 500]
                q = f"SELECT key_value, element_id FROM leaves WHERE key_value IN ({','.join('?' * len(chunk))})"
                for kv, eid in self._db.execute(q, chunk):
                    out.setdefault(kv, []).append(eid)
        return out

    def clear(self):
        with self._lock:
            self._db.execute("DELETE FROM leaves")
            self._db.execute("DELETE FROM epochs")
            self._db.commit()


class RootStore(Protocol):
    name: str
    def commit(self, epoch: int, root: str, node_count: int, edge_count: int) -> dict: ...
    def latest(self) -> tuple[int, str]: ...
    def root_of(self, epoch: int) -> str: ...


class LocalRootStore:
    """Fallback when no chain is running (unit tests, chain down). Clearly labelled in /integrity/status."""
    name = "local"

    def __init__(self):
        self._roots: dict[int, str] = {}

    def commit(self, epoch, root, node_count, edge_count):
        if self._roots and epoch <= max(self._roots):
            raise ValueError("epochs must strictly increase")
        self._roots[epoch] = root
        return {"tx": None, "block": None}

    def latest(self):
        if not self._roots:
            return 0, "0x" + "00" * 32
        e = max(self._roots)
        return e, self._roots[e]

    def root_of(self, epoch):
        return self._roots.get(epoch, "0x" + "00" * 32)


class ChainRootStore:
    name = "chain"

    def __init__(self, chain):
        self.chain = chain

    def commit(self, epoch, root, node_count, edge_count):
        return self.chain.commit_root(epoch, root, node_count, edge_count)

    def latest(self):
        return self.chain.latest_root()

    def root_of(self, epoch):
        return self.chain.root_of(epoch)
