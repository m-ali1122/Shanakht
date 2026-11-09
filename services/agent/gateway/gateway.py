"""The only path to the model.

    gw = get_gateway()
    res = gw.complete(case_id, messages, tools=..., json_schema=..., names=[...])
    res.content          # re-identified text for the UI
    res.content_tokens   # what the model actually wrote (tokens)
    res.tool_calls       # [{id, name, arguments (dict, re-identified), arguments_tokens (dict)}]
    res.egress_sha256    # hash of the exact outbound payload (goes into the decision hash)

Raises GatewayBlocked when the outbound check finds a raw identifier after
tokenization; nothing is sent in that case.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field

import config
from . import guard
from .adapter import ModelAdapter
from .egress import EgressLog, canonical
from .pseudonymizer import Pseudonymizer
from .vault import Vault


class GatewayBlocked(RuntimeError):
    def __init__(self, hits: list[dict], egress_id: int, sha256: str):
        kinds = sorted({h["kind"] for h in hits})
        super().__init__(f"blocked: identifier detected ({', '.join(kinds)})")
        self.hits, self.kinds, self.egress_id, self.sha256 = hits, kinds, egress_id, sha256


@dataclass
class GatewayResult:
    content: str
    content_tokens: str
    tool_calls: list = field(default_factory=list)
    egress_sha256: str = ""
    egress_id: int = 0
    usage: dict = field(default_factory=dict)
    ms: int = 0


class Gateway:
    def __init__(self, vault: Vault, egress: EgressLog, adapter: ModelAdapter | None = None):
        self.vault = vault
        self.pseudo = Pseudonymizer(vault)
        self.egress = egress
        self.adapter = adapter or ModelAdapter()

    # convenience passthroughs for the agent code
    def token(self, case_id, kind, value):
        return self.pseudo.token(case_id, kind, value)

    def tokenize(self, case_id, text, names=None) -> str:
        out, n = self.pseudo.tokenize(case_id, text, names)
        if n:
            self.egress.bump("tokens_substituted", n)
        return out

    def tokenize_obj(self, case_id, obj, names=None):
        out, n = self.pseudo.tokenize_obj(case_id, obj, names)
        if n:
            self.egress.bump("tokens_substituted", n)
        return out

    def reidentify(self, case_id, text):
        return self.pseudo.reidentify(case_id, text)

    def reidentify_obj(self, case_id, obj):
        return self.pseudo.reidentify_obj(case_id, obj)

    def bind_params(self, case_id):
        return self.pseudo.bind_params(case_id)

    # ------------------------------------------------------------ the call
    def prepare(self, case_id, messages, tools=None, json_schema=None, names=None):
        """Tokenize + check without sending. Returns (request, payload_str, substitutions, hits)."""
        tok_msgs, subs = [], 0
        for m in messages:
            m2 = dict(m)
            if isinstance(m2.get("content"), str):
                m2["content"], n = self.pseudo.tokenize(case_id, m2["content"], names)
                subs += n
            if m2.get("tool_calls"):
                tcs, n = self.pseudo.tokenize_obj(case_id, m2["tool_calls"], names)
                m2["tool_calls"], subs = tcs, subs + n
            tok_msgs.append(m2)
        request = self.adapter.build_request(tok_msgs, tools, json_schema)
        payload = canonical({"provider": self.adapter.provider, "request": request})
        hits = guard.scan(payload, self.vault.raw_values(case_id))
        return request, payload, subs, hits

    def complete(self, case_id: str, messages: list[dict], tools=None, json_schema=None,
                 names: list[str] | None = None, purpose: str | None = None,
                 offline_response: dict | None = None) -> GatewayResult:
        t0 = time.perf_counter()
        request, payload, subs, hits = self.prepare(case_id, messages, tools, json_schema, names)
        if subs:
            self.egress.bump("tokens_substituted", subs)
        if hits:
            rec = self.egress.record(case_id, self.adapter.provider, self.adapter.model, payload, subs,
                                     blocked=True, reason=",".join(sorted({h["kind"] for h in hits})),
                                     purpose=purpose)
            self.egress.bump("blocked")
            raise GatewayBlocked(hits, rec["id"], rec["sha256"])

        rec = self.egress.record(case_id, self.adapter.provider, self.adapter.model, payload, subs,
                                 purpose=purpose)
        self.egress.bump("calls")
        # Payload passed the check, so it carried zero raw identifiers; the counter
        # only moves if a hit slips through (it never should).
        if guard.scan(payload, self.vault.raw_values(case_id)):
            self.egress.bump("identifiers_sent")

        resp = offline_response if offline_response is not None else \
            self.adapter.complete(None, request=request)
        if resp.get("usage"):
            self.egress.update_usage(rec["id"], resp["usage"])

        content_tokens = resp.get("content") or ""
        calls = []
        for tc in resp.get("tool_calls") or []:
            try:
                args_tok = json.loads(tc.get("arguments") or "{}")
            except Exception:
                args_tok = {"_raw": tc.get("arguments")}
            calls.append({"id": tc.get("id"), "name": tc.get("name"),
                          "arguments_tokens": args_tok,
                          "arguments": self.pseudo.reidentify_obj(case_id, args_tok)})
        return GatewayResult(content=self.pseudo.reidentify(case_id, content_tokens),
                             content_tokens=content_tokens, tool_calls=calls,
                             egress_sha256=rec["sha256"], egress_id=rec["id"],
                             usage=resp.get("usage") or {},
                             ms=int((time.perf_counter() - t0) * 1000))


_gw: Gateway | None = None


def get_gateway() -> Gateway:
    global _gw
    if _gw is None:
        _gw = Gateway(Vault(config.STATE_DIR / "vault.sqlite", config.PSEUDO_VAULT_KEY),
                      EgressLog(config.STATE_DIR / "egress.sqlite"))
    return _gw
