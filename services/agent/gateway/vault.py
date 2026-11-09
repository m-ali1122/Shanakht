"""Encrypted, case-scoped token vault (SQLite + Fernet).

Rows: (case_id, token, kind, lookup, enc). `lookup` is an HMAC of the
normalized value so we can find an existing token without storing plaintext;
`enc` is the Fernet-encrypted surface value used for re-identification.
The vault never leaves the bank.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import sqlite3
import threading
from pathlib import Path

from cryptography.fernet import Fernet

PREFIX = {"person": "PERSON", "acct": "ACCT", "cnic": "CNIC", "phone": "PHONE", "device": "DEV", "fp": "FP"}


class Vault:
    def __init__(self, path: Path | str, secret: str):
        self.path = str(path)
        self._secret = secret.encode()
        self._fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(b"vault-enc|" + self._secret).digest()))
        self._lock = threading.Lock()
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.execute("""CREATE TABLE IF NOT EXISTS vault(
            case_id TEXT, token TEXT, kind TEXT, lookup TEXT, enc BLOB,
            PRIMARY KEY(case_id, token))""")
        self._db.execute("CREATE INDEX IF NOT EXISTS vault_lookup ON vault(case_id, kind, lookup)")
        self._db.commit()
        self._cache: dict[str, dict[str, str]] = {}  # case -> token -> plaintext (process memory only)

    def _lookup(self, kind: str, key: str) -> str:
        return hmac.new(self._secret, f"{kind}|{key}".encode(), hashlib.sha256).hexdigest()

    def token_for(self, case_id: str, kind: str, key: str, surface: str) -> tuple[str, bool]:
        """Return (token, created). `key` is the normalized identity; `surface` the text shown on re-id."""
        lk = self._lookup(kind, key)
        with self._lock:
            row = self._db.execute("SELECT token FROM vault WHERE case_id=? AND kind=? AND lookup=?",
                                   (case_id, kind, lk)).fetchone()
            if row:
                return row[0], False
            n = self._db.execute("SELECT COUNT(*) FROM vault WHERE case_id=? AND kind=?",
                                 (case_id, kind)).fetchone()[0] + 1
            token = f"{PREFIX[kind]}_{n}"
            self._db.execute("INSERT INTO vault VALUES(?,?,?,?,?)",
                             (case_id, token, kind, lk, self._fernet.encrypt(surface.encode())))
            self._db.commit()
            self._cache.setdefault(case_id, {})[token] = surface
            return token, True

    def mapping(self, case_id: str) -> dict[str, str]:
        """token -> plaintext for one case (decrypted locally)."""
        if case_id in self._cache:
            cached = self._cache[case_id]
        else:
            cached = {}
        with self._lock:
            rows = self._db.execute("SELECT token, enc FROM vault WHERE case_id=?", (case_id,)).fetchall()
        if len(rows) != len(cached):
            cached = {t: self._fernet.decrypt(e).decode() for t, e in rows}
            self._cache[case_id] = cached
        return dict(cached)

    def raw_values(self, case_id: str) -> list[str]:
        return list(self.mapping(case_id).values())

    def clear(self, case_id: str | None = None):
        with self._lock:
            if case_id is None:
                self._db.execute("DELETE FROM vault")
                self._cache.clear()
            else:
                self._db.execute("DELETE FROM vault WHERE case_id=?", (case_id,))
                self._cache.pop(case_id, None)
            self._db.commit()
