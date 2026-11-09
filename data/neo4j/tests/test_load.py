import os
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import signing  # noqa: E402


def test_tampered_or_unsigned_batch_rejected():
    s = signing.sign_batch("RAVI", "B1", [{"fp": "a", "kind": "phone", "iban": "x"}])
    assert signing.verify_batch(s)["batch_id"] == "B1"
    s["payload"]["fingerprints"].append({"fp": "evil", "kind": "phone", "iban": "x"})
    with pytest.raises(signing.BatchRejected):
        signing.verify_batch(s)
    with pytest.raises(signing.BatchRejected):
        signing.verify_batch({"payload": {"bank": "RAVI"}})
    with pytest.raises(signing.BatchRejected):
        signing.verify_batch({"payload": {"bank": "ZZZZ"}, "signer": "ZZZZ", "signature": "00"})


@pytest.fixture(scope="module")
def sess():
    neo4j = pytest.importorskip("neo4j")
    try:
        d = neo4j.GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "shanakht2026"))
        d.verify_connectivity()
    except Exception:
        pytest.skip("neo4j not running")
    with d.session() as s:
        yield s


def one(s, q):
    return s.run(q).single()[0]


def test_counts(sess):
    assert one(sess, "MATCH (n:Account) RETURN count(n)") == 12112
    assert one(sess, "MATCH (n:Transfer) RETURN count(n)") == 20000
    assert one(sess, "MATCH (n:Remitter) RETURN count(n)") == 600


def test_privacy(sess):
    assert one(sess, "MATCH (r:Record) WHERE r.bank <> 'MRGL' RETURN count(r)") == 0
    assert one(sess, "MATCH (r:Record)-[:HOLDS]->(a:Account) WHERE a.bank <> 'MRGL' RETURN count(r)") == 0
    assert one(sess, "MATCH (a:Account) WHERE a.bank <> 'MRGL' AND a.title_raw IS NOT NULL RETURN count(a)") == 0
    # partner fingerprints carry only opaque fields + batch provenance
    assert one(sess, "MATCH (f:Fingerprint) WHERE f.bank <> 'MRGL' AND f.signer IS NOT NULL AND f.batch_id IS NOT NULL RETURN count(f)") == one(sess, "MATCH (f:Fingerprint) RETURN count(f)")
    assert one(sess, "MATCH (f:Fingerprint) WHERE f.fp =~ '^[0-9a-f]{64}$' RETURN count(f)") == one(sess, "MATCH (f:Fingerprint) RETURN count(f)")
    assert one(sess, "MATCH (f:Fingerprint) WHERE any(k IN keys(f) WHERE k IN ['phone','raw_name','device','cnic','name']) RETURN count(f)") == 0
    assert one(sess, "MATCH (n) WHERE n:Phone OR n:Device RETURN count(n) > 0 AND all(x IN collect(n.h) WHERE x =~ '^[0-9a-f]{64}$')") is True


def test_rings(sess):
    q = (HERE / "motifs.cypher").read_text(encoding="utf-8").rstrip().rstrip(";")
    rings = {r["remitter"]: r for r in sess.run(q)}
    assert {"RM-S5", "RM-RB", "RM-RC"} <= set(rings)
    assert rings["RM-S5"]["beneficiaries"] >= 5
