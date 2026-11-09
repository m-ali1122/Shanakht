import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

c = TestClient(main.app)


def title(bank, iban):
    return c.get(f"/banks/{bank}/title-fetch", params={"iban": iban}).json()["title"]


def test_s1():
    assert title("MRGL", "PK36MRGL0000000000010001") == "AYESHA SIDDIQUI"


def test_s2():
    assert title("RAVI", "PK36RAVI0000000000020001") == "MUHAMMAD ALI"


def test_s3():
    assert title("MRGL", "PK36MRGL0000000000030021") == "TARIQ MEHMOOD"


def test_s4():
    assert title("CHNB", "PK36CHNB0000000000040001") == "RAJA IMRAN AKRAM"
    r = c.get("/banks/CHNB/kyc-name", params={"iban": "PK36CHNB0000000000040001"}).json()
    assert r["urdu_name"] == "راجہ عمران اکرم"


def test_not_found_and_quirks():
    assert c.get("/banks/RAVI/title-fetch", params={"iban": "PK00RAVI1"}).json()["status"] == "NOT_FOUND"
    assert main.apply_quirk("RAVI", "Abd-ul O.Rehman") == "ABD UL OREHMAN"
    assert main.apply_quirk("INDS", "muhammad imran siddiqui khan x") == "Muhammad Imran Siddiqui"
    assert len(main.apply_quirk("MRGL", "A" * 50)) == 35


def test_incoming_and_status():
    r = c.post("/banks/INDS/incoming", json={"iban": "PK36INDS0000000000050006"}).json()
    assert r["registry_check"] in ("HIT", "CLEAR", "UNAVAILABLE") and len(r["fingerprint"]["phone"]) == 16
    assert c.get("/banks/RAVI/status").json()["online"] is True
    assert c.get("/health").json()["ok"]
