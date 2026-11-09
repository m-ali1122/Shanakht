"""run_cypher as the agents use it: guard -> bind $TOKEN params locally -> execute -> verified-context gate
-> tokenized aggregate view for the model. One session per case; remembers every id the model has been shown."""
from __future__ import annotations

import re

import graphdb
from cypher_guard import UnsafeCypher, guard
from integrity import verified_context
from modelview import model_view, strings_in

_PARAM = re.compile(r"\$((?:PERSON|ACCT|CNIC|PHONE|DEV|FP)_\d+)\b")
_BARE = re.compile(r"(?<![\w$])((?:PERSON|ACCT|CNIC|PHONE|DEV|FP)_\d+)\b", re.I)


class CypherSession:
    def __init__(self, gw, case_id: str, runner=None, gate=None):
        self.gw, self.case_id = gw, case_id
        self.runner = runner or graphdb.run_read
        self.gate = gate or verified_context
        self.seen: set[str] = set()          # every string the verified rows contained (citable ids live here)
        self.leaves: dict[str, str] = {}     # element_id -> leaf hash, verified elements only
        self.epoch = None
        self.root = None
        self.excluded: set[str] = set()
        self.attempts: list[dict] = []

    def bound_params(self, query: str) -> dict:
        mapping = self.gw.bind_params(self.case_id)
        return {t: mapping[t] for t in _PARAM.findall(query) if t in mapping}

    def execute(self, query: str, extra_params: dict | None = None) -> dict:
        n = len(self.attempts) + 1
        rec = {"attempt": n, "query": (query or "").strip(), "ok": False, "error": None, "rows": [], "view": None,
               "gate": None}
        self.attempts.append(rec)
        try:
            mapping = self.gw.bind_params(self.case_id)       # models sometimes write a token in lower case or bare
            query = _BARE.sub(lambda m: mapping.get(m.group(1).upper(), m.group(0)).replace("'", " ").replace('"', " "), query or "")
            safe = guard(query)
            rec["query"] = safe
            rows = self.runner(safe, {**self.bound_params(safe), **(extra_params or {})})
        except UnsafeCypher as e:
            rec["error"] = f"rejected by read-only guard: {e}"
            return rec
        except Exception as e:  # genuine driver/syntax/timeout errors go back to the model verbatim
            rec["error"] = f"{type(e).__name__}: {e}"
            return rec
        g = self.gate(rows)
        strings_in(g.rows, self.seen)
        self.leaves.update(g.leaves)
        self.excluded.update(g.excluded_elements)
        self.epoch, self.root = g.epoch, g.root
        rec.update(ok=True, rows=g.rows, gate=g.step, note=g.note,
                   view=model_view(self.gw, self.case_id, g.rows, g.note))
        return rec
