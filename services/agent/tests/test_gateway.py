import hashlib
import json
import uuid

import pytest

import config
from gateway.egress import EgressLog
from gateway.gateway import Gateway, GatewayBlocked
from gateway.vault import Vault


class FakeAdapter:
    provider, model = "fake", "fake-1"

    def __init__(self, reply=""):
        self.reply = reply
        self.sent = []

    def build_request(self, messages, tools=None, json_schema=None):
        return {"model": self.model, "messages": messages}

    def complete(self, messages, tools=None, json_schema=None, request=None):
        self.sent.append(request)
        return {"content": self.reply, "tool_calls": [], "usage": {"prompt_tokens": 10}}


@pytest.fixture
def gw(tmp_path):
    return Gateway(Vault(tmp_path / "v.sqlite", "k"), EgressLog(tmp_path / "e.sqlite"), FakeAdapter())


def case():
    return "case-" + uuid.uuid4().hex[:8]


def test_planted_cnic_is_blocked(gw):
    """A raw CNIC that the tokenizer cannot see (inside a tool definition) must block the call."""
    c = case()
    gw.adapter.build_request = lambda m, t=None, j=None: {"model": "x", "messages": m,
                                                          "tools": [{"description": "lookup 91234-1234567-1"}]}
    with pytest.raises(GatewayBlocked) as ei:
        gw.complete(c, [{"role": "user", "content": "hello"}])
    assert "cnic" in ei.value.kinds
    assert gw.adapter.sent == []                      # nothing left the bank
    items = gw.egress.list(c)
    assert items and items[0]["blocked"] is True
    assert gw.egress.counters()["identifiers_sent_to_model"] == 0


def test_cnic_in_message_is_tokenized_not_sent(gw):
    c = case()
    gw.complete(c, [{"role": "user", "content": "CNIC 91234-1234567-1 holder"}])
    sent = json.dumps(gw.adapter.sent[-1])
    assert "91234-1234567-1" not in sent and "CNIC_1" in sent


def test_round_trip_tokenize_reidentify(gw):
    c = case()
    text = ("Faisal Nawaz sent PKR 50,000 to PK36MRGL0000000000050001 from 0300-5550505 "
            "on device 5e5e5e5e-0000-4000-8000-000000000005")
    tok = gw.tokenize(c, text)
    for raw in ("Faisal Nawaz", "PK36MRGL0000000000050001", "0300-5550505", "5e5e5e5e-0000-4000-8000-000000000005"):
        assert raw not in tok
    assert "PERSON_1" in tok and "ACCT_1" in tok and "PHONE_1" in tok and "DEV_1" in tok
    assert gw.reidentify(c, tok) == text


def test_two_spellings_same_token(gw):
    c = case()
    a = gw.token(c, "person", "Mohd Ali s/o Rehmat")
    b = gw.token(c, "person", "MUHAMMAD ALI")
    d = gw.token(c, "person", "Muhammad Ali")
    assert a == b == d
    assert gw.token(c, "person", "Tariq Mehmood") != a


def test_urdu_and_roman_same_token(gw):
    c = case()
    assert gw.token(c, "person", "Imran Akram") == gw.token(c, "person", "راجہ عمران اکرم")


def test_tokens_are_case_scoped(gw):
    c1, c2 = case(), case()
    gw.token(c1, "person", "Usman Ghani")
    gw.token(c1, "person", "Bilal Ahmed")
    assert gw.token(c2, "person", "Bilal Ahmed") == "PERSON_1"


def test_voice_question_names_detected(gw):
    c = case()
    q = "Faisal Nawaz ne pichle mahine kitne logon ko paise bheje?"
    tok = gw.tokenize(c, q)
    assert tok.startswith("PERSON_1 ne pichle mahine")
    tok2 = gw.tokenize(c, "Show every account that shares a phone with Usman Ghani.")
    assert "Usman Ghani" not in tok2 and "PERSON_2" in tok2


def test_egress_hash_matches_stored_payload(gw):
    c = case()
    gw.adapter.reply = "PERSON_1 is fine"
    res = gw.complete(c, [{"role": "user", "content": "Is Hamza Khan ok?"}])
    assert res.content == "Hamza Khan is fine"
    assert res.content_tokens == "PERSON_1 is fine"
    items = gw.egress.list(c)
    assert len(items) == 1
    stored = json.dumps(items[0]["payload"], sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    assert hashlib.sha256(stored.encode()).hexdigest() == items[0]["sha256"] == res.egress_sha256
    assert "Hamza Khan" not in stored
    assert gw.egress.hashes(c) == [res.egress_sha256]


def test_counter_stays_zero_and_counts_substitutions(gw):
    c = case()
    gw.complete(c, [{"role": "user", "content": "Usman Ghani and M. Usman share 0300-5550505"}])
    cnt = gw.egress.counters()
    assert cnt["identifiers_sent_to_model"] == 0
    assert cnt["tokens_substituted"] >= 3


def test_vault_is_encrypted_at_rest(tmp_path):
    v = Vault(tmp_path / "v.sqlite", "secret")
    v.token_for("c", "person", "faisal nawaz", "Faisal Nawaz")
    raw = (tmp_path / "v.sqlite").read_bytes()
    assert b"Faisal" not in raw
    assert Vault(tmp_path / "v.sqlite", "secret").mapping("c") == {"PERSON_1": "Faisal Nawaz"}
