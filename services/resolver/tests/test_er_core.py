from er_core.blocking import candidate_pairs
from er_core.cluster import cluster
from er_core.fusion import DEFAULT_WEIGHTS
from er_core.pipeline import resolve_batch
from er_core.preprocess import preprocess

RECS = [
    {"rid": "a1", "raw_name": "Muhammad Ali s/o Rehmat"},
    {"rid": "a2", "raw_name": "MOHD ALI"},
    {"rid": "a3", "raw_name": "Mohammad Ali"},
    {"rid": "b1", "raw_name": "Ayesha Siddiqui"},
    {"rid": "b2", "raw_name": "AISHA SIDDIQUI"},
    {"rid": "c1", "raw_name": "Tariq Mehmood"},
    {"rid": "d1", "raw_name": "Hassan Qureshi"},
    {"rid": "d2", "raw_name": "Hussain Qureshi"},
]


def test_blocking_keeps_variants():
    pre = preprocess(RECS)
    pairs = candidate_pairs(pre)
    assert ("a1", "a2") in pairs and ("b1", "b2") in pairs


def test_clique_cover_splits_false_bridge():
    scores = {("a", "b"): 0.99, ("b", "c"): 0.99, ("a", "c"): 0.05}
    clusters, splits = cluster(["a", "b", "c"], scores, 0.9, 0.8)
    assert splits == 1 and len(clusters) == 2


def test_resolve_batch_groups_people():
    res = resolve_batch(RECS, weights=DEFAULT_WEIGHTS)
    groups = {frozenset(c["rids"]) for c in res["clusters"]}
    assert frozenset({"b1", "b2"}) in groups
    assert any({"a1", "a2"} <= g for g in groups)
    assert frozenset({"c1"}) in groups
    # Hassan and Hussain are different names and must not merge
    assert not any({"d1", "d2"} <= g for g in groups)


def test_cnic_channel_merges_and_separates():
    recs = [{"rid": "x1", "raw_name": "Usman Ghani", "cnic_syn": "91234-1234567-1"},
            {"rid": "x2", "raw_name": "USMAN GHANI", "cnic_syn": "91234-1234567-1"},
            {"rid": "x3", "raw_name": "Usman Ghani", "cnic_syn": "99999-0000000-9"}]
    res = resolve_batch(recs)  # learned weights
    groups = {frozenset(c["rids"]) for c in res["clusters"]}
    assert frozenset({"x1", "x2"}) in groups and frozenset({"x3"}) in groups
