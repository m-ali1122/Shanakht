"""Model adapter: one interface over any OpenAI-compatible endpoint.

Cloud, onshore host or self-hosted open-weights server is purely a config
change (LLM_BASE_URL / LLM_MODEL / LLM_API_KEY). Never call this directly —
go through gateway.Gateway, which pseudonymizes and logs every payload.
"""
from __future__ import annotations

import json
import os

import config


class ModelAdapter:
    def __init__(self, base_url: str | None = None, model: str | None = None,
                 api_key: str | None = None, provider: str | None = None):
        self.base_url = base_url or config.LLM_BASE_URL
        self.model = model or config.LLM_MODEL
        self.api_key = api_key or config.LLM_API_KEY or "none"
        self.provider = provider or config.LLM_PROVIDER
        self._client = None

    def _c(self):
        if self._client is None:
            from openai import OpenAI
            self._client = OpenAI(base_url=self.base_url, api_key=self.api_key, timeout=30)
        return self._client

    def build_request(self, messages, tools=None, json_schema=None) -> dict:
        req = {"model": self.model, "messages": messages, "temperature": 0}
        if tools:
            req["tools"] = tools
        if json_schema:
            if os.getenv("LLM_JSON_MODE", "object") == "schema":
                req["response_format"] = {"type": "json_schema",
                                          "json_schema": {"name": "out", "schema": json_schema}}
            else:
                req["response_format"] = {"type": "json_object"}
        return req

    def complete(self, messages, tools=None, json_schema=None, request: dict | None = None) -> dict:
        req = request or self.build_request(messages, tools, json_schema)
        resp = self._c().chat.completions.create(**req)
        msg = resp.choices[0].message
        calls = []
        for tc in msg.tool_calls or []:
            calls.append({"id": tc.id, "name": tc.function.name, "arguments": tc.function.arguments or "{}"})
        usage = getattr(resp, "usage", None)
        return {
            "content": msg.content or "",
            "tool_calls": calls,
            "usage": {"prompt_tokens": getattr(usage, "prompt_tokens", None),
                      "completion_tokens": getattr(usage, "completion_tokens", None)},
            "model": getattr(resp, "model", self.model),
        }


def parse_json(text: str):
    """Lenient JSON extraction for models that wrap output in prose or fences."""
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("\n") + 1:] if "\n" in text else text
    try:
        return json.loads(text)
    except Exception:
        s, e = text.find("{"), text.rfind("}")
        if s >= 0 and e > s:
            return json.loads(text[s:e + 1])
        raise
