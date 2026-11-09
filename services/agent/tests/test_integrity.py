import time

import pytest

from integrity import merkle
from integrity.gate import verified_context
from integrity.graph_source import InMemoryGraphSource
from integrity.keys import BatchRejected, sign_batch, verify_batch
from integrity.leaves import Element, leaf_hash, rel_id
from integrity.service import IntegrityService
from integrity.store import LeafStore, LocalRootStore


def sample_graph():
    els = [
        Element("node", "Remitter:RM-S5", "Remitter", {"rmid": "RM-S5", "name": "Faisal Nawaz"}, key_value="RM-S5"),
        Element("node", "Account:PK36MRGL0000000000050001", "Account",
                {"iban": "PK36MRGL0000000000050001", "title_raw": "USMAN GHANI"}, key_value="PK36MRGL0000000000050001"),
        Element("node", "Account:PK36RAVI0000000000050003", "Account",
                {"iban": "PK36RAVI0000000000050003", "bank": "RAVI"}, key_value="PK36RAVI0000000000050003"),
        Element("node", "Record:R-MRGL-S5-1", "Record", {"rid": "R-MRGL-S5-1", "raw_name": "Usman Ghani"},
                key_value="R-MRGL-S5-1"),
        Element("node", "Fingerprint:RAVI:ab12", "Fingerprint", {"fp": "ab12", "bank": "RAVI", "kind": "phone"},
                signer="RAVI", key_value="ab12"),
    ]
    els.append(Element("rel", rel_id("HOLDS", "Record:R-MRGL-S5-1", "Account:PK36MRGL0000000000050001"), "HOLDS", {}))
    return els


@pytest.fixture
def svc(tmp_path):
    return IntegrityService(InMemoryGraphSource(sample_graph()), LeafStore(tmp_path / "l.sqlite"),
                            roots=LocalRootStore())


def test_merkle_roundtrip_all_sizes():
    for n in (1, 2, 3, 4, 5, 7, 8, 13):
        leaves = [leaf_hash(Element("node", f"X:{i}", "X", {"i": i})) for i in range(n)]
        t = merkle.MerkleTree(leaves)
        for i, l in enumerate(leaves):
            assert merkle.verify(t.proof(i), t.root, l)
        assert not merkle.verify(t.proof(0), t.root, leaves[-1]) or n == 1


def test_commit_then_prove(svc):
    c = svc.commit()
    assert c["epoch"] == 1 and c["node_count"] == 5 and c["edge_count"] == 1
    ids = [e.id for e in sample_graph()]
    p = svc.prove(ids)
    assert p["verified"] == p["total"] == 6
    assert all(i["status"] == "verified" for i in p["items"])


def test_tampered_node_fails(svc):
    svc.commit()
    svc.tamper("Record:R-MRGL-S5-1")
    p = svc.prove(["Record:R-MRGL-S5-1", "Remitter:RM-S5"])
    st = {i["element_id"]: i["status"] for i in p["items"]}
    assert st == {"Record:R-MRGL-S5-1": "changed", "Remitter:RM-S5": "verified"}


def test_wrong_root_fails(svc):
    svc.commit()
    svc._forced_roots._roots[1] = "0x" + "11" * 32  # someone rewrote the committed root
    p = svc.prove(["Remitter:RM-S5"])
    assert p["items"][0]["status"] == "changed"


def test_epochs_increase(svc):
    assert svc.commit()["epoch"] == 1
    assert svc.commit()["epoch"] == 2


def test_missing_element(svc):
    svc.commit()
    del svc.graph.elements["Remitter:RM-S5"]
    assert svc.prove(["Remitter:RM-S5"])["items"][0]["status"] == "missing"
    assert svc.prove(["Nope:1"])["items"][0]["status"] == "missing"


def test_gate_excludes_changed_rows(svc):
    svc.commit()
    rows = [{"rid": "R-MRGL-S5-1", "iban": "PK36MRGL0000000000050001"},
            {"iban": "PK36RAVI0000000000050003", "fp": "ab12"},
            {"count": 5}]
    g = verified_context(rows, svc)
    assert g.excluded_rows == 0 and len(g.rows) == 3 and g.step["data"]["verified"] == 4
    svc.tamper("Record:R-MRGL-S5-1")
    g = verified_context(rows, svc)
    assert g.excluded_rows == 1 and len(g.rows) == 2
    assert g.note == "1 facts excluded: changed after epoch 1."
    assert "Record:R-MRGL-S5-1" in g.excluded_elements
    assert "Record:R-MRGL-S5-1" not in g.leaves


def test_signed_batch_ok():
    signed = sign_batch("RAVI", "b-1", [{"fp": "ab12", "kind": "phone"}], ts=1)
    assert verify_batch(signed)["batch_id"] == "b-1"


def test_unsigned_batch_rejected():
    with pytest.raises(BatchRejected):
        verify_batch({"payload": {"bank": "RAVI", "batch_id": "b", "fingerprints": []}})


def test_forged_and_unknown_signer_rejected():
    signed = sign_batch("RAVI", "b-1", [{"fp": "ab12"}], ts=1)
    signed["payload"]["fingerprints"].append({"fp": "evil"})
    with pytest.raises(BatchRejected):
        verify_batch(signed)
    other = sign_batch("CHNB", "b-2", [], ts=1)
    other["signer"] = "XXXX"
    with pytest.raises(BatchRejected):
        verify_batch(other)
    spoof = sign_batch("CHNB", "b-3", [], ts=1)
    spoof["signer"] = "RAVI"  # CHNB's signature claimed as RAVI
    with pytest.raises(BatchRejected):
        verify_batch(spoof)


def test_pii_not_in_leaf_preimage():
    el = Element("node", "Record:R1", "Record", {"rid": "R1", "raw_name": "Usman Ghani", "cnic_syn": "91234-1234567-1"})
    from integrity.leaves import _scrub
    s = _scrub(el.properties)
    assert "Usman" not in str(s) and "91234" not in str(s)


def test_commit_100k_under_budget(tmp_path):
    els = [Element("node", f"Transfer:T{i:06d}", "Transfer", {"tid": f"T{i:06d}", "amount_pkr": i},
                   key_value=f"T{i:06d}") for i in range(100_000)]
    svc = IntegrityService(InMemoryGraphSource(els), LeafStore(tmp_path / "l.sqlite"), roots=LocalRootStore())
    t0 = time.perf_counter()
    c = svc.commit()
    elapsed = time.perf_counter() - t0
    print(f"commit 100k leaves: {elapsed:.2f}s (node hash {merkle.NODE_HASH})")
    assert c["leaves"] == 100_000
    assert elapsed < 4  # target ~2 s (measured 2.1 s incl. SQLite write)
