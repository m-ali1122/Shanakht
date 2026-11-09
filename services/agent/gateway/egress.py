"""Egress log: SHA-256 of every exact outbound payload, plus the counters for the top bar."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


class EgressLog:
    def __init__(self, path: Path | str):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.execute("""CREATE TABLE IF NOT EXISTS egress(
            id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT, ts REAL, provider TEXT, model TEXT,
            sha256 TEXT, payload TEXT, prompt_tokens INTEGER, completion_tokens INTEGER,
            substitutions INTEGER, blocked INTEGER, reason TEXT, purpose TEXT)""")
        self._db.execute("""CREATE TABLE IF NOT EXISTS counters(name TEXT PRIMARY KEY, value INTEGER)""")
        self._db.commit()

    def record(self, case_id, provider, model, payload_str, substitutions, blocked=False,
               reason=None, usage=None, purpose=None) -> dict:
        h = sha256_hex(payload_str)
        usage = usage or {}
        with self._lock:
            cur = self._db.execute(
                "INSERT INTO egress(case_id,ts,provider,model,sha256,payload,prompt_tokens,completion_tokens,"
                "substitutions,blocked,reason,purpose) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (case_id, time.time(), provider, model, h, payload_str, usage.get("prompt_tokens"),
                 usage.get("completion_tokens"), substitutions, int(blocked), reason, purpose))
            self._db.commit()
            return {"id": cur.lastrowid, "sha256": h}

    def update_usage(self, row_id: int, usage: dict):
        with self._lock:
            self._db.execute("UPDATE egress SET prompt_tokens=?, completion_tokens=? WHERE id=?",
                             (usage.get("prompt_tokens"), usage.get("completion_tokens"), row_id))
            self._db.commit()

    def bump(self, name: str, by: int = 1):
        with self._lock:
            self._db.execute("INSERT INTO counters VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=value+?",
                             (name, by, by))
            self._db.commit()

    def counters(self) -> dict:
        with self._lock:
            rows = dict(self._db.execute("SELECT name, value FROM counters").fetchall())
        return {"identifiers_sent_to_model": rows.get("identifiers_sent", 0),
                "tokens_substituted": rows.get("tokens_substituted", 0),
                "calls": rows.get("calls", 0),
                "blocked": rows.get("blocked", 0)}

    def list(self, case_id: str | None = None) -> list[dict]:
        q = ("SELECT id,case_id,ts,provider,model,sha256,payload,prompt_tokens,completion_tokens,"
             "substitutions,blocked,reason,purpose FROM egress")
        args = ()
        if case_id:
            q += " WHERE case_id=?"
            args = (case_id,)
        q += " ORDER BY id"
        with self._lock:
            rows = self._db.execute(q, args).fetchall()
        keys = ["id", "case_id", "ts", "provider", "model", "sha256", "payload", "prompt_tokens",
                "completion_tokens", "substitutions", "blocked", "reason", "purpose"]
        out = []
        for r in rows:
            d = dict(zip(keys, r))
            d["blocked"] = bool(d["blocked"])
            d["payload"] = json.loads(d["payload"])
            out.append(d)
        return out

    def hashes(self, case_id: str) -> list[str]:
        """Egress payload hashes for a case — goes into the decision hash (P6/P8)."""
        with self._lock:
            return [r[0] for r in self._db.execute(
                "SELECT sha256 FROM egress WHERE case_id=? AND blocked=0 ORDER BY id", (case_id,))]

    def clear(self):
        with self._lock:
            self._db.execute("DELETE FROM egress")
            self._db.execute("DELETE FROM counters")
            self._db.commit()
