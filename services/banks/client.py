"""TitleFetchClient: the single adapter the agent uses to reach partner/host banks.
Copy or import. Only needs httpx."""
from __future__ import annotations

import os
from typing import Protocol

import httpx

BANKS_URL = os.getenv("BANKS_URL", "http://localhost:8101")


class TitleFetchClient(Protocol):
    def title_fetch(self, bank_code: str, iban: str) -> dict: ...
    def kyc_name(self, bank_code: str, iban: str) -> dict: ...
    def incoming(self, bank_code: str, payload: dict) -> dict: ...
    def status(self, bank_code: str) -> dict: ...


class HttpTitleFetchClient:
    def __init__(self, base_url: str | None = None, timeout: float = 5.0):
        self.base = (base_url or BANKS_URL).rstrip("/")
        self.c = httpx.Client(timeout=timeout)

    def title_fetch(self, bank_code, iban):
        return self.c.get(f"{self.base}/banks/{bank_code}/title-fetch", params={"iban": iban}).json()

    def kyc_name(self, bank_code, iban):
        return self.c.get(f"{self.base}/banks/{bank_code}/kyc-name", params={"iban": iban}).json()

    def incoming(self, bank_code, payload):
        return self.c.post(f"{self.base}/banks/{bank_code}/incoming", json=payload).json()

    def status(self, bank_code):
        return self.c.get(f"{self.base}/banks/{bank_code}/status").json()


def bank_code_from_iban(iban: str) -> str:
    return iban[4:8]
