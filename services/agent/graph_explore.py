"""Grand knowledge-graph exploration API (console v2, see docs/CONSOLE_V2.md "Backend API").

All endpoints are read-only, deterministic and make no LLM calls. They return GData-shaped `{nodes, links}`:
node ids are the UI ids (rmid / iban / rid / pid / ph:<h> / dv:<h> / fp:<fp> / did), Transfer nodes are collapsed
into Remitter-[SENT {count}]->Account links, and Bank/ExchangeHouse hubs are never drawn or traversed.

Privacy: partner-bank (bank != HOST_BANK) Account/Record nodes never carry raw names, titles or Urdu names; only
bank, an opaque id and fingerprints. Search never matches partner names.

Offline (DEMO_OFFLINE=1): answers come from demo/cache/explore-*.json (written by scripts/record_cache.py), with
fallbacks computed from the cached grand graph. Neo4j is never touched offline (`_read` refuses).
"""
from __future__ import annotations

import hashlib
import json
import random
import re
import threading
import time
from collections import Counter, deque

import httpx
from fastapi import APIRouter, HTTPException

import config
import sse
from integrity.leaves import Element, KEY_PROPS, leaf_hash, node_id, rel_id

router = APIRouter(tags=["graph-explore"])

CAP = 40                   # neighbours pulled per node per hop
EXPAND_BUDGET = 400        # node cap for /graph/expand
PATTERN_NODE_CAP = 400     # node cap for a drawn pattern
PATTERN_MATCH_LIMIT = 80   # seeds fetched per pattern before the node cap applies
GRAND_DEFAULT = 2500
GRAND_MAX = 4000
PERSON_BATCH = 60
FP_ACCOUNTS_PER_FP = 4     # partner accounts drawn per fingerprint in the grand sample
SENT_PER_ACCOUNT = 6       # remitters drawn per account in the grand sample
SEARCH_MAX = 50

KIND = {"Remitter": "remitter", "Account": "account", "Record": "record", "Person": "person", "Phone": "phone",
        "Device": "device", "Fingerprint": "fingerprint", "Decision": "decision"}
KIND_LABEL = {v: k for k, v in KIND.items()}

# Plain-language resolver reasons (mirrors apps/web/lib/guide.ts REASON_TEXT).
REASON_TEXT = {
    "INITIAL_EXPANDED": "Short form expanded", "PATRONYMIC_DROPPED": "Father's name (s/o) not on the account",
    "VARIANT_SPELLING": "Spelling variant", "TITLE_DROPPED": "Honorific removed",
    "TITLE_ADDED": "Honorific on the account only", "SURNAME_MISSING": "Surname missing",
    "SCRIPT_CONVERTED": "Matched through the Urdu name", "DIFFERENT_PERSON": "Different person",
    "TOKEN_ORDER": "Names in a different order", "TYPO_1CHAR": "One-character typo",
}

# Privacy-safe property whitelists. Partner Account/Record get only the PARTNER set.
SAFE_PROPS = {
    "Remitter": ("rmid", "name", "country"),
    "Account": ("iban", "bank", "title_raw", "title_script"),
    "Record": ("rid", "bank", "raw_name", "urdu_name", "script"),
    "Person": ("pid", "canonical_name"),
    "Phone": ("h",), "Device": ("h",),
    "Fingerprint": ("fp", "kind", "bank", "signer", "batch_id"),
    "Decision": ("did", "band", "action", "approver", "hash", "case_id", "ts", "risk"),
}
PARTNER_PROPS = {"Account": ("iban", "bank"), "Record": ("rid", "bank")}


# ------------------------------------------------------------------ pure helpers
def is_partner(label: str, p: dict) -> bool:
    return label in ("Account", "Record") and bool(p.get("bank")) and p.get("bank") != config.HOST_BANK


def safe_props(label: str, p: dict) -> dict:
    keys = PARTNER_PROPS[label] if is_partner(label, p) else SAFE_PROPS.get(label, ())
    return {k: p[k] for k in keys if p.get(k) is not None}


def ui_id(label: str, p: dict) -> str:
    if label == "Phone":
        return "ph:" + str(p.get("h"))
    if label == "Device":
        return "dv:" + str(p.get("h"))
    if label == "Fingerprint":
        return "fp:" + str(p.get("fp"))
    key = KEY_PROPS.get(label)
    v = p.get(key) if key else None
    return str(v) if v is not None else node_id(label, p)[0]


def node_label(label: str, p: dict) -> str:
    partner = is_partner(label, p)
    if label == "Remitter":
        return p.get("name") or p.get("rmid") or "remitter"
    if label == "Record":
        rid = str(p.get("rid", ""))
        return f"{p.get('bank')} record ··{rid[-4:]}" if partner else (p.get("raw_name") or rid)
    if label == "Person":
        return p.get("canonical_name") or p.get("pid") or "person"
    if label == "Account":
        return f"{p.get('bank', '')} ··{str(p.get('iban', ''))[-4:]}"
    if label in ("Phone", "Device"):
        return str(p.get("h", ""))[:6]
    if label == "Fingerprint":
        return str(p.get("fp", ""))[:6]
    if label == "Decision":
        return f"decision {p.get('did')}"
    return str(p.get("name") or p.get("code") or label)


def gnode(uid: str, label: str, p: dict) -> dict:
    bank = p.get("bank")
    d = {"id": uid, "label": node_label(label, p), "kind": KIND.get(label, label.lower()), "bank": bank,
         "hollow": bool(label == "Fingerprint" or is_partner(label, p)), "tampered": bool(p.get("tampered"))}
    if label == "Fingerprint":
        d["fpKind"] = p.get("kind")
    return d


def link_id(rel: str, a: str, b: str) -> str:
    return f"{rel}:{a}>{b}"


def humanise(rel: str) -> str:
    return rel.replace("_", " ").lower().capitalize()


def cache_key(kind: str, *parts) -> str:
    """Cache file name for an explore answer. Short ids stay readable; long/compound keys are hashed."""
    raw = "|".join(str(x) for x in parts)
    if kind in ("node", "pattern") and re.fullmatch(r"[A-Za-z0-9_.:-]{1,48}", raw):
        return f"explore-{kind}-" + raw.replace(":", "_")
    if not parts:
        return f"explore-{kind}"
    return f"explore-{kind}-" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def sample_order(items: list, seed: int) -> list:
    """Deterministic seeded shuffle (independent of input order)."""
    out = sorted(items)
    random.Random(seed).shuffle(out)
    return out


def _uniq_banks(*lists) -> list[str]:
    return sorted({b for lst in lists for b in (lst or []) if b})


def provenance(rel: str, f: dict) -> dict:
    """Plain-language 'why this link exists' from DB facts. `f` keys are optional; missing facts are left out."""
    bank = f.get("bank") or "the bank"
    ev: list[dict] = []

    def add(k, v):
        if v is not None and v != "" and v != []:
            ev.append({"k": k, "v": ", ".join(map(str, v)) if isinstance(v, (list, tuple)) else v})

    if rel == "HOLDS":
        title, cause, origin = "Record holds account", f"KYC record at {bank} lists this account.", f"{bank} KYC file"
        add("Record", f.get("rid")); add("Account", f.get("iban")); add("Bank", f.get("bank"))
        add("Name on record", f.get("name")); add("Account title", f.get("title"))
    elif rel in ("USES_PHONE", "USES_DEVICE"):
        thing = "phone" if rel == "USES_PHONE" else "device"
        title = f"Shared {thing}"
        cause = f"KYC record at {bank} registered this {thing} (keyed hash)."
        n, banks = f.get("records"), f.get("banks") or []
        others = [b for b in banks if b != f.get("bank")]
        if n and n > 1:
            cause += f" {n} records at {bank} use it."
        if others:
            cause += f" The same {thing} is on file at {', '.join(others)}."
        origin = f"{bank} KYC file"
        add("Hash", (f.get("hash") or "")[:12] or None); add("Records using it", n)
        add("Partner accounts with it", f.get("partner_accounts")); add("Banks sharing it", banks)
    elif rel == "RESOLVES_TO":
        title = "Same person"
        sc = f.get("score")
        cause = "Resolver matched the record name to this person" + (f" with score {sc:.2f}." if sc is not None else ".")
        origin = "Shanakht resolver (entity resolution over host KYC records)"
        add("Score", round(sc, 4) if sc is not None else None); add("Record name", f.get("name"))
        add("Canonical name", f.get("canonical")); add("Band", f.get("band"))
    elif rel == "HAS_FP":
        kind = f.get("kind") or "identifier"
        title = "Partner fingerprint"
        cause = f"{bank} contributed a signed HMAC fingerprint ({kind}) for this account."
        if (f.get("accounts") or 0) > 1:
            cause += f" {f['accounts']} accounts carry the same fingerprint."
        origin = f"{bank} (partner bank), signed fingerprint batch" + (f" {f['batch']}" if f.get("batch") else "")
        add("Kind", kind); add("Signer", f.get("signer")); add("Batch", f.get("batch"))
        add("Accounts with it", f.get("accounts")); add("Banks", f.get("banks"))
    elif rel == "SAME_AS":
        kind = f.get("kind") or "identifier"
        banks = [b for b in (f.get("banks") or []) if b != config.HOST_BANK]
        title = "Fingerprint match"
        cause = (f"Host-bank {kind} hash equals a partner fingerprint, so the same {kind} is on file at "
                 f"{config.HOST_BANK}" + (f" and {', '.join(banks)}." if banks else " and a partner bank."))
        origin = f"Keyed-hash match: {config.HOST_BANK} KYC file vs partner signed fingerprint"
        add("Kind", kind); add("Host records", f.get("records")); add("Partner accounts", f.get("partner_accounts"))
        add("Banks", f.get("banks"))
    elif rel == "SENT":
        n = f.get("count") or len(f.get("transfers") or []) or None
        title = "Transfers"
        cause = (f"{n} transfer{'s' if n != 1 else ''} from this remitter to this account" if n
                 else "Transfers from this remitter to this account")
        if f.get("first") and f.get("last"):
            cause += f", {f['first'][:10]} to {f['last'][:10]}" if f["first"][:10] != f["last"][:10] else f", on {f['first'][:10]}"
        cause += "."
        origin = "Transfer history (exchange-house remittance feed)"
        add("Transfers", n); add("Total PKR", f.get("total_pkr")); add("Exchange houses", f.get("houses"))
        add("Account bank", f.get("bank"))
    else:
        title, cause, origin = humanise(rel), f"Graph relationship {rel}.", "Shanakht graph"
    return {"title": title, "cause": cause, "origin": origin, "evidence": ev}


def degree_of(links: list[dict]) -> Counter:
    d: Counter = Counter()
    for l in links:
        d[l["source"]] += 1
        d[l["target"]] += 1
    return d


def stats_of(nodes: list[dict], links: list[dict], total_nodes=None, total_edges=None) -> dict:
    return {"total_nodes": total_nodes, "total_edges": total_edges, "shown_nodes": len(nodes),
            "shown_edges": len(links), "by_kind": dict(Counter(n["kind"] for n in nodes)),
            "by_rel": dict(Counter(l["rel"] for l in links)),
            "by_bank": dict(Counter(n["bank"] for n in nodes if n.get("bank")))}


# ------------------------------------------------------------------ Neo4j access
def _read(q: str, params: dict | None = None, timeout: float = 15.0) -> list[dict]:
    """Fixed internal read queries (no LIMIT clamp, unlike graphdb.run_read for model text). Never offline."""
    if config.DEMO_OFFLINE:
        raise RuntimeError("DEMO_OFFLINE: Neo4j is not used")
    import graphdb
    from neo4j import READ_ACCESS, Query
    try:
        with graphdb.driver().session(default_access_mode=READ_ACCESS) as s:
            return [{k: graphdb.to_json(v) for k, v in r.items()} for r in s.run(Query(q, timeout=timeout), params or {})]
    except Exception as e:
        from neo4j.exceptions import ServiceUnavailable
        if isinstance(e, (ServiceUnavailable, OSError)):
            raise graphdb.GraphUnavailable(str(e)) from e
        raise


EDGE_COLS = ("elementId(startNode(x)) AS si, labels(startNode(x))[0] AS sl, properties(startNode(x)) AS sp, "
             "type(x) AS t, properties(x) AS rp, elementId(endNode(x)) AS ei, labels(endNode(x))[0] AS el, "
             "properties(endNode(x)) AS ep")


class G:
    """Graph under construction. nodes: uid -> (label, props); links: (rel, a, b) -> extra."""

    def __init__(self):
        self.nodes: dict[str, tuple[str, dict]] = {}
        self.links: dict[tuple, dict] = {}
        self.uid: dict[str, str] = {}      # Neo4j elementId -> uid

    def add(self, eid: str, label: str, p: dict) -> str:
        u = ui_id(label, p)
        self.uid[eid] = u
        self.nodes.setdefault(u, (label, p))
        return u

    def link(self, rel, a, b, **extra):
        cur = self.links.setdefault((rel, a, b), {})
        cur.update({k: v for k, v in extra.items() if v is not None})

    def add_rows(self, rows, budget: int | None = None) -> list[str]:
        """Generic edge rows (EDGE_COLS). Rows that would add nodes past `budget` are skipped. Returns new uids."""
        new = []
        for r in rows:
            if r["sl"] in ("Bank", "ExchangeHouse", "Transfer") or r["el"] in ("Bank", "ExchangeHouse", "Transfer"):
                continue
            fresh = [i for i in (r["si"], r["ei"]) if i not in self.uid]
            if budget is not None and fresh and len(self.nodes) + len(fresh) > budget:
                continue
            for i, l, p in ((r["si"], r["sl"], r["sp"]), (r["ei"], r["el"], r["ep"])):
                if i not in self.uid:
                    new.append(self.add(i, l, p))
            rp = r.get("rp") or {}
            self.link(r["t"], self.uid[r["si"]], self.uid[r["ei"]], score=rp.get("score"), count=r.get("c"))
        return new

    def gdata(self, focus: set | None = None, scenarios: dict | None = None) -> dict:
        nodes = []
        for u, (l, p) in self.nodes.items():
            n = gnode(u, l, p)
            if focus is not None:
                n["focus"] = u in focus
            if scenarios is not None:
                n["scenarios"] = sorted(scenarios.get(u, ()))
            nodes.append(n)
        links = []
        for (rel, a, b), x in self.links.items():
            if a in self.nodes and b in self.nodes:
                d = {"id": link_id(rel, a, b), "source": a, "target": b, "rel": rel, "label": None}
                if x.get("score") is not None:
                    d["score"] = round(float(x["score"]), 4)
                if x.get("count") is not None:
                    d["count"] = int(x["count"])
                    d["label"] = str(int(x["count"]))
                links.append(d)
        deg = degree_of(links)
        for n in nodes:
            n["degree"] = deg.get(n["id"], 0)
        return {"nodes": nodes, "links": links}


def _split_ids(ids):
    ks, ph, dv, fp = [], [], [], []
    for i in ids:
        i = str(i).strip()
        if not i:
            continue
        pre, rest = i[:3], i[3:]
        {"ph:": ph, "dv:": dv, "fp:": fp}.get(pre, ks).append(rest if pre in ("ph:", "dv:", "fp:") else i)
    return ks, ph, dv, fp


def lookup(ids) -> list[dict]:
    """Nodes by UI id (index seeks only)."""
    ks, ph, dv, fp = _split_ids(ids)
    if not (ks or ph or dv or fp):
        return []
    return _read(
        "CALL () { MATCH (n:Remitter) WHERE n.rmid IN $ks RETURN n UNION MATCH (n:Account) WHERE n.iban IN $ks RETURN n "
        "UNION MATCH (n:Record) WHERE n.rid IN $ks RETURN n UNION MATCH (n:Person) WHERE n.pid IN $ks RETURN n "
        "UNION MATCH (n:Decision) WHERE n.did IN $ks RETURN n UNION MATCH (n:Phone) WHERE n.h IN $ph RETURN n "
        "UNION MATCH (n:Device) WHERE n.h IN $dv RETURN n UNION MATCH (n:Fingerprint) WHERE n.fp IN $fp RETURN n } "
        "RETURN elementId(n) AS i, labels(n)[0] AS l, properties(n) AS p LIMIT 500",
        {"ks": ks, "ph": ph, "dv": dv, "fp": fp})


def _hop(frontier: list[str], cap: int = CAP) -> tuple[list, list]:
    rows = _read(
        "UNWIND $f AS f MATCH (n) WHERE elementId(n) = f AND NOT n:Transfer "
        "CALL (n) { MATCH (n)-[x]-(m) WHERE NOT m:Bank AND NOT m:ExchangeHouse AND NOT m:Transfer "
        f"RETURN x LIMIT {int(cap)} }} RETURN {EDGE_COLS}", {"f": frontier})
    sent = _read(
        "UNWIND $f AS f MATCH (n) WHERE elementId(n) = f AND (n:Remitter OR n:Account) "
        "CALL (n) { MATCH (n)-[:SENT|TO]-(t:Transfer) MATCH (r:Remitter)-[:SENT]->(t)-[:TO]->(a:Account) "
        f"RETURN r, a, count(t) AS c LIMIT {int(cap)} }} "
        "RETURN elementId(r) AS si, 'Remitter' AS sl, properties(r) AS sp, 'SENT' AS t, {} AS rp, "
        "elementId(a) AS ei, 'Account' AS el, properties(a) AS ep, c", {"f": frontier})
    return rows, sent


def bfs(g: G, start: list[dict], depth: int, budget: int, cap: int = CAP) -> set[str]:
    """Breadth-first from `start` rows (lookup output) into g. Returns uids reached by this walk."""
    seen = set()
    reached = set()
    for r in start:
        reached.add(g.add(r["i"], r["l"], r["p"]))
        seen.add(r["i"])
    frontier = [r["i"] for r in start]
    for _ in range(depth):
        if not frontier:
            break
        rows, sent = _hop(frontier, cap)
        nxt = []
        for r in rows + sent:
            if r["sl"] in ("Bank", "ExchangeHouse", "Transfer") or r["el"] in ("Bank", "ExchangeHouse", "Transfer"):
                continue
            fresh = [i for i in (r["si"], r["ei"]) if i not in g.uid]
            if fresh and len(g.nodes) + len(fresh) > budget:
                continue
            for i, l, p in ((r["si"], r["sl"], r["sp"]), (r["ei"], r["el"], r["ep"])):
                u = g.add(i, l, p) if i not in g.uid else g.uid[i]
                reached.add(u)
                if i not in seen:
                    seen.add(i)
                    nxt.append(i)
            g.link(r["t"], g.uid[r["si"]], g.uid[r["ei"]], score=(r.get("rp") or {}).get("score"), count=r.get("c"))
        frontier = nxt
    return reached


# ------------------------------------------------------------------ scenarios
def scenario_seeds() -> dict[str, list[str]]:
    data = json.loads((config.ROOT_DIR / "demo" / "scenarios.json").read_text(encoding="utf-8"))["scenarios"]
    out = {}
    for s in data:
        ids = list(s.get("focus_ids") or [])
        if not ids:   # S6 (voice): the entities its questions are about
            for q in s.get("voice_queries", []):
                for v in (q.get("expected") or {}).values():
                    if isinstance(v, list):
                        ids += [x for x in v if isinstance(x, str) and re.match(r"^(RM-|R-|PK\d\d)", x)]
            if any(x.startswith(("R-MRGL-S5", "PK36")) for x in ids):
                ids.insert(0, "RM-S5")
        out[s["id"]] = list(dict.fromkeys(ids))
    return out


_LOCK = threading.Lock()
_GRAND: dict = {}          # {"limit": int, "data": {...}}  -- only the latest build is kept
_SCEN: dict = {}           # {"membership": {uid: [sid]}, "focus": set}


def _scenario_graphs(g: G, budget: int = 450) -> tuple[dict, set]:
    membership: dict[str, set] = {}
    focus: set = set()
    for sid, ids in scenario_seeds().items():
        start = lookup(ids)
        focus |= {ui_id(r["l"], r["p"]) for r in start}
        sub_budget = len(g.nodes) + budget
        for u in bfs(g, start, depth=2, budget=sub_budget):
            membership.setdefault(u, set()).add(sid)
    return membership, focus


def scenario_membership() -> dict[str, list[str]]:
    if _GRAND.get("data"):
        return {n["id"]: n["scenarios"] for n in _GRAND["data"]["nodes"] if n.get("scenarios")}
    with _LOCK:
        if "membership" not in _SCEN:
            m, f = _scenario_graphs(G())
            _SCEN.update(membership={u: sorted(s) for u, s in m.items()}, focus=f)
    return _SCEN["membership"]


def _person_clusters(g: G, pids: list[str], limit: int):
    rows = _read(
        "UNWIND $pids AS pid MATCH (p:Person {pid: pid})<-[:RESOLVES_TO]-(r:Record) "
        "CALL (p, r) { MATCH (r)-[x:RESOLVES_TO]->(p) RETURN x "
        "UNION MATCH (r)-[x:HOLDS|USES_PHONE|USES_DEVICE]->() RETURN x "
        "UNION MATCH (r)-[:USES_PHONE|USES_DEVICE]->()-[x:SAME_AS]->() RETURN x } "
        f"RETURN pid, {EDGE_COLS}", {"pids": pids})
    by_pid: dict[str, list] = {}
    for r in rows:
        by_pid.setdefault(r["pid"], []).append(r)
    for pid in pids:                      # whole clusters, in sample order
        if len(g.nodes) >= limit:
            break
        g.add_rows(by_pid.get(pid, []))
    if len(g.nodes) >= limit:
        return
    fps = [i for i, u in g.uid.items() if u.startswith("fp:")]
    if fps:
        g.add_rows(_read(
            "UNWIND $f AS f MATCH (n:Fingerprint) WHERE elementId(n) = f "
            f"CALL (n) {{ MATCH (:Account)-[x:HAS_FP]->(n) RETURN x LIMIT {FP_ACCOUNTS_PER_FP} }} RETURN {EDGE_COLS}",
            {"f": fps}), budget=limit)
    accts = [i for i, u in g.uid.items() if g.nodes[u][0] == "Account"]
    if accts and len(g.nodes) < limit:
        g.add_rows(_read(
            "UNWIND $f AS f MATCH (a:Account) WHERE elementId(a) = f "
            "CALL (a) { MATCH (r:Remitter)-[:SENT]->(t:Transfer)-[:TO]->(a) "
            f"RETURN r, count(t) AS c ORDER BY c DESC, r.rmid LIMIT {SENT_PER_ACCOUNT} }} "
            "RETURN elementId(r) AS si, 'Remitter' AS sl, properties(r) AS sp, 'SENT' AS t, {} AS rp, "
            "elementId(a) AS ei, 'Account' AS el, properties(a) AS ep, c", {"f": accts}), budget=limit)


def build_grand(limit: int = GRAND_DEFAULT) -> dict:
    t0 = time.perf_counter()
    g = G()
    membership, focus = _scenario_graphs(g)
    # Remitters already in the scenario graphs: their SENT links to sampled accounts are picked up below.
    pids = [r["pid"] for r in _read("MATCH (p:Person) RETURN p.pid AS pid")]
    order = sample_order(pids, config.SEED)
    for i in range(0, len(order), PERSON_BATCH):
        if len(g.nodes) >= limit:
            break
        _person_clusters(g, order[i:i + PERSON_BATCH], limit)
    data = g.gdata(focus=focus, scenarios={u: s for u, s in membership.items()})
    tot = _read("MATCH (n) WITH count(n) AS n MATCH ()-[r]->() RETURN n, count(r) AS e")[0]
    data["stats"] = stats_of(data["nodes"], data["links"], tot["n"], tot["e"])
    data["stats"]["build_ms"] = int((time.perf_counter() - t0) * 1000)
    data["stats"]["seed"] = config.SEED
    return data


def _tampered_uids() -> set[str]:
    rows = _read("MATCH (n) WHERE n.tampered = true RETURN labels(n)[0] AS l, properties(n) AS p LIMIT 100", timeout=5)
    return {ui_id(r["l"], r["p"]) for r in rows}


def grand(limit: int = GRAND_DEFAULT) -> dict:
    limit = max(200, min(int(limit), GRAND_MAX))
    with _LOCK:
        if _GRAND.get("limit") != limit:
            _GRAND.clear()
            _GRAND.update(limit=limit, data=build_grand(limit))
        data = _GRAND["data"]
    try:
        bad = _tampered_uids()
    except Exception:
        bad = set()
    nodes = [n if n["tampered"] == (n["id"] in bad) else {**n, "tampered": n["id"] in bad} for n in data["nodes"]]
    return {**data, "nodes": nodes}


# ------------------------------------------------------------------ integrity
def _leaf_store():
    from integrity.routes import get_integrity
    return get_integrity().store


def node_integrity(label: str, p: dict) -> dict:
    eid = node_id(label, p)[0]
    try:
        stored = _leaf_store().get([eid])
    except Exception:
        stored = {}
    committed = eid in stored
    tampered = bool(p.get("tampered"))
    if committed and not tampered:
        el = Element("node", eid, label, dict(p), signer=p.get("signer"), key_value=node_id(label, p)[1])
        tampered = leaf_hash(el) != stored[eid][1]
    return {"eid": eid, "committed": committed, "tampered": tampered}


def rels_committed(ids: list[str]) -> bool:
    if not ids:
        return False
    try:
        return len(_leaf_store().get(ids)) == len(set(ids))
    except Exception:
        return False


# ------------------------------------------------------------------ node / edge details
def node_detail(uid: str) -> dict | None:
    rows = lookup([uid])
    if not rows:
        return None
    r = rows[0]
    label, p = r["l"], r["p"]
    deg = _read("MATCH (n) WHERE elementId(n) = $i MATCH (n)-[x]-() RETURN type(x) AS t, count(*) AS c", {"i": r["i"]})
    d = gnode(ui_id(label, p), label, p)
    return {"id": d["id"], "kind": d["kind"], "label": d["label"], "bank": d["bank"], "hollow": d["hollow"],
            "props": safe_props(label, p), "degree": {x["t"]: x["c"] for x in deg},
            "scenarios": scenario_membership().get(d["id"], []), "integrity": node_integrity(label, p)}


def resolver_reasons(name: str, canonical: str, urdu: str | None = None) -> dict | None:
    try:
        r = httpx.post(f"{config.RESOLVER_URL}/compare",
                       json={"typed_name": name, "title_raw": canonical, "urdu_name": urdu}, timeout=4).json()
    except Exception:
        return None
    return {"band": r.get("band"), "score": r.get("score"),
            "reasons": [{"code": c, "text": REASON_TEXT.get(c, humanise(c))} for c in r.get("reasons") or []]}


def _facts(rel: str, a: dict, b: dict, rp: dict) -> dict:
    """Gather DB facts for an edge. a/b: lookup rows (start/end node)."""
    pa, pb = a["p"], b["p"]
    f: dict = {}
    if rel == "HOLDS":
        f.update(bank=pa.get("bank"), rid=pa.get("rid"), iban=pb.get("iban"))
        if not is_partner("Record", pa):
            f["name"] = pa.get("raw_name")
        if not is_partner("Account", pb):
            f["title"] = pb.get("title_raw")
    elif rel in ("USES_PHONE", "USES_DEVICE"):
        x = _read(f"MATCH (h) WHERE elementId(h) = $h OPTIONAL MATCH (h)<-[:{rel}]-(r:Record) WITH h, count(r) AS n, "
                  "collect(DISTINCT r.bank) AS rb OPTIONAL MATCH (h)-[:SAME_AS]->(:Fingerprint)<-[:HAS_FP]-(a:Account) "
                  "RETURN n, rb, count(DISTINCT a) AS na, collect(DISTINCT a.bank) AS ab", {"h": b["i"]})[0]
        f.update(bank=pa.get("bank"), hash=pb.get("h"), records=x["n"], partner_accounts=x["na"],
                 banks=_uniq_banks(x["rb"], x["ab"]))
    elif rel == "RESOLVES_TO":
        f.update(score=rp.get("score"), name=pa.get("raw_name"), canonical=pb.get("canonical_name"),
                 bank=pa.get("bank"))
    elif rel == "HAS_FP":
        x = _read("MATCH (f) WHERE elementId(f) = $f MATCH (f)<-[:HAS_FP]-(a:Account) "
                  "RETURN count(a) AS n, collect(DISTINCT a.bank) AS ab", {"f": b["i"]})[0]
        f.update(bank=pa.get("bank") or pb.get("bank"), kind=pb.get("kind"), signer=pb.get("signer"),
                 batch=pb.get("batch_id"), accounts=x["n"], banks=_uniq_banks(x["ab"]))
    elif rel == "SAME_AS":
        x = _read("MATCH (h) WHERE elementId(h) = $h MATCH (f) WHERE elementId(f) = $f "
                  "OPTIONAL MATCH (h)<-[:USES_PHONE|USES_DEVICE]-(r:Record) WITH h, f, count(r) AS n "
                  "OPTIONAL MATCH (f)<-[:HAS_FP]-(a:Account) RETURN n, count(a) AS na, collect(DISTINCT a.bank) AS ab",
                  {"h": a["i"], "f": b["i"]})[0]
        f.update(kind=pb.get("kind"), records=x["n"], partner_accounts=x["na"],
                 banks=_uniq_banks([config.HOST_BANK] if x["n"] else [], x["ab"]))
    return f


def edge_detail(rel: str, source: str, target: str) -> dict | None:
    rel = {"FP": "HAS_FP"}.get(rel.upper(), rel.upper())
    rows = lookup([source, target])
    by = {ui_id(r["l"], r["p"]): r for r in rows}
    a, b = by.get(source), by.get(target)
    if not a or not b:
        return None
    out = {"rel": rel, "source": source, "target": target}
    if rel == "SENT":
        if a["l"] != "Remitter":
            a, b = b, a
        ts = _read("MATCH (r) WHERE elementId(r) = $a MATCH (a) WHERE elementId(a) = $b "
                   "MATCH (r)-[:SENT]->(t:Transfer)-[:TO]->(a) OPTIONAL MATCH (t)-[:VIA]->(h:ExchangeHouse) "
                   "RETURN t.tid AS tid, t.amount_pkr AS amount_pkr, t.amount_fx AS amount_fx, t.currency AS currency, "
                   "t.ts AS date, h.code AS house ORDER BY date, tid LIMIT 200", {"a": a["i"], "b": b["i"]})
        if not ts:
            return None
        na, nb = node_id("Remitter", a["p"])[0], node_id("Account", b["p"])[0]
        rids = [x for t in ts for x in (rel_id("SENT", na, f"Transfer:{t['tid']}"), rel_id("TO", f"Transfer:{t['tid']}", nb))]
        facts = {"count": len(ts), "transfers": ts, "first": str(ts[0]["date"] or ""), "last": str(ts[-1]["date"] or ""),
                 "total_pkr": sum(t["amount_pkr"] or 0 for t in ts), "houses": sorted({t["house"] for t in ts if t["house"]}),
                 "bank": b["p"].get("bank")}
        out.update(provenance("SENT", facts), transfers=ts, count=len(ts), committed=rels_committed(rids))
        return out
    q = (f"MATCH (a) WHERE elementId(a) = $a MATCH (b) WHERE elementId(b) = $b MATCH (a)-[x:`{rel}`]->(b) "
         "RETURN properties(x) AS rp LIMIT 1")
    hit = _read(q, {"a": a["i"], "b": b["i"]})
    if not hit:
        hit = _read(q, {"a": b["i"], "b": a["i"]})
        if not hit:
            return None
        a, b = b, a
    rp = hit[0]["rp"] or {}
    facts = _facts(rel, a, b, rp)
    out.update(provenance(rel, facts))
    if rp.get("score") is not None:
        out["score"] = round(float(rp["score"]), 4)
    if rel == "RESOLVES_TO" and not is_partner("Record", a["p"]):
        res = resolver_reasons(a["p"].get("raw_name") or "", b["p"].get("canonical_name") or "", a["p"].get("urdu_name"))
        if res:
            out["reasons"] = res["reasons"]
            out["resolver"] = {"band": res["band"], "score": res["score"]}
            out["evidence"].append({"k": "Resolver band (re-run)", "v": res["band"]})
    out["committed"] = rels_committed([rel_id(rel, node_id(a["l"], a["p"])[0], node_id(b["l"], b["p"])[0])])
    return out


# ------------------------------------------------------------------ search / expand / path
HEX = re.compile(r"^[0-9a-f]{4,64}$")


def search(q: str, limit: int = 20) -> list[dict]:
    """Ids: exact/prefix (index seeks). Names: case-insensitive contains on Remitter.name, Person.canonical_name and
    host-bank Record raw/Urdu names only (partner names are never searched). Each source gets its own LIMIT so one
    crowded kind cannot hide the others; results rank exact > prefix > contains, person/record before remitter."""
    q = (q or "").strip()
    limit = max(1, min(int(limit), SEARCH_MAX))
    pre = q[:3].lower() if q[:3].lower() in ("ph:", "dv:", "fp:") else ""
    raw = q[3:].strip() if pre else q
    if len(raw) < 2:
        return []
    up, low = raw.upper(), raw.lower()
    hexq = bool(HEX.match(low))
    rows = _read(
        "CALL () { MATCH (n:Account) WHERE $ids AND n.iban STARTS WITH $up RETURN n, 'iban' AS m LIMIT $lim "
        "UNION MATCH (n:Record) WHERE $ids AND n.rid STARTS WITH $up RETURN n, 'rid' AS m LIMIT $lim "
        "UNION MATCH (n:Remitter) WHERE $ids AND n.rmid STARTS WITH $up RETURN n, 'rmid' AS m LIMIT $lim "
        "UNION MATCH (n:Person) WHERE $ids AND n.pid STARTS WITH $pid RETURN n, 'pid' AS m LIMIT $lim "
        "UNION MATCH (n:Phone) WHERE $ph AND n.h STARTS WITH $low RETURN n, 'phone hash' AS m LIMIT $lim "
        "UNION MATCH (n:Device) WHERE $dv AND n.h STARTS WITH $low RETURN n, 'device hash' AS m LIMIT $lim "
        "UNION MATCH (n:Fingerprint) WHERE $fp AND n.fp STARTS WITH $low RETURN n, 'fingerprint' AS m LIMIT $lim } "
        "RETURN labels(n)[0] AS l, properties(n) AS p, m",
        {"up": up, "low": low, "pid": "P-" + raw[2:] if raw[:2].upper() == "P-" else raw, "lim": limit,
         "ids": not pre, "ph": hexq and pre in ("", "ph:"), "dv": hexq and pre in ("", "dv:"),
         "fp": hexq and pre in ("", "fp:")})
    if not pre and not (hexq and len(low) >= 6):
        rows += _read(
            "CALL () { MATCH (n:Person) WHERE toLower(n.canonical_name) CONTAINS $low RETURN n, 'canonical name' AS m LIMIT $lim "
            "UNION MATCH (n:Record) WHERE n.bank = $host AND toLower(n.raw_name) CONTAINS $low "
            "RETURN n, 'record name' AS m LIMIT $lim "
            "UNION MATCH (n:Record) WHERE n.bank = $host AND n.urdu_name CONTAINS $raw RETURN n, 'urdu name' AS m LIMIT $lim "
            "UNION MATCH (n:Remitter) WHERE toLower(n.name) CONTAINS $low RETURN n, 'name' AS m LIMIT $lim } "
            "RETURN labels(n)[0] AS l, properties(n) AS p, m",
            {"low": low, "raw": raw, "host": config.HOST_BANK, "lim": limit})
    try:
        boost = scenario_membership()
    except Exception:
        boost = {}
    return rank_results(rows, low, limit, boost)


KIND_ORDER = {"person": 0, "record": 1, "remitter": 2, "account": 3, "phone": 4, "device": 5, "fingerprint": 6}


def rank_results(rows: list[dict], low: str, limit: int, boost: set | dict | None = None) -> list[dict]:
    """rows: {l, p, m}. Dedupe by UI id; rank exact > word-prefix > contains, scenario entities (`boost`) first,
    then interleave kinds (person, record, remitter, ...) so one crowded kind cannot fill the list."""
    out, seen = [], set()
    for r in rows:
        u = ui_id(r["l"], r["p"])
        if u in seen:
            continue
        seen.add(u)
        n = gnode(u, r["l"], r["p"])
        out.append({"id": u, "label": n["label"], "kind": n["kind"], "bank": n["bank"], "match": r["m"]})
    boost = boost or ()

    def tier(x):
        lab, key = (x["label"] or "").lower(), x["id"].lower().split(":", 1)[-1]
        t = 0 if (lab == low or key == low) else 1 if (lab.startswith(low) or key.startswith(low) or
                                                        any(w.startswith(low) for w in lab.split())) else 2
        return (t, x["id"] not in boost)

    groups: dict[tuple, dict[str, list]] = {}
    for x in sorted(out, key=lambda x: ((x["label"] or "").lower(), x["id"])):
        groups.setdefault(tier(x), {}).setdefault(x["kind"], []).append(x)
    ranked = []
    for t in sorted(groups):
        lanes = [groups[t][k] for k in sorted(groups[t], key=lambda k: KIND_ORDER.get(k, 9))]
        for i in range(max(len(l) for l in lanes)):
            ranked += [l[i] for l in lanes if i < len(l)]
    return ranked[:limit]


def expand(uid: str, depth: int = 1) -> dict:
    start = lookup([uid])
    if not start:
        return {"nodes": [], "links": []}
    g = G()
    bfs(g, start, depth=max(1, min(int(depth), 2)), budget=EXPAND_BUDGET)
    return g.gdata(focus={uid}, scenarios=scenario_membership())


def path(source: str, target: str, max_hops: int = 6) -> dict:
    rows = lookup([source, target])
    by = {ui_id(r["l"], r["p"]): r for r in rows}
    if source not in by or target not in by:
        return {"nodes": [], "links": [], "found": False}
    raw = max(1, min(int(max_hops), 8)) * 2      # a collapsed SENT hop is two raw hops (via the Transfer)
    hit = _read(
        "MATCH (a) WHERE elementId(a) = $a MATCH (b) WHERE elementId(b) = $b "
        f"MATCH p = shortestPath((a)-[*..{raw}]-(b)) "
        "WHERE all(n IN nodes(p) WHERE NOT n:Bank AND NOT n:ExchangeHouse) "
        "UNWIND relationships(p) AS x RETURN " + EDGE_COLS, {"a": by[source]["i"], "b": by[target]["i"]}, timeout=8)
    g = G()
    transfers: dict[str, dict] = {}
    for r in hit:
        if "Transfer" in (r["sl"], r["el"]):
            t = r["ei"] if r["el"] == "Transfer" else r["si"]
            other = (r["si"], r["sl"], r["sp"]) if r["el"] == "Transfer" else (r["ei"], r["el"], r["ep"])
            transfers.setdefault(t, {})[r["t"]] = other
        else:
            g.add_rows([r])
    for t in transfers.values():
        if "SENT" in t and "TO" in t:
            (ri, _, rp), (ai, _, ap) = t["SENT"], t["TO"]
            ru, au = g.add(ri, "Remitter", rp), g.add(ai, "Account", ap)
            c = _read("MATCH (r) WHERE elementId(r) = $r MATCH (a) WHERE elementId(a) = $a "
                      "MATCH (r)-[:SENT]->(t:Transfer)-[:TO]->(a) RETURN count(t) AS c", {"r": ri, "a": ai})[0]["c"]
            g.link("SENT", ru, au, count=c)
    for r in rows:
        if ui_id(r["l"], r["p"]) not in g.nodes:
            g.add(r["i"], r["l"], r["p"])
    d = g.gdata(focus={source, target}, scenarios=scenario_membership())
    d["found"] = bool(hit) or source == target
    return d


# ------------------------------------------------------------------ patterns
def _shared_q(kind: str, use: str) -> str:
    return (
        f"MATCH (f:Fingerprint {{kind: '{kind}'}}) "
        "WITH f, COUNT { (f)<-[:HAS_FP]-(:Account) } AS na, "
        f"COUNT {{ (f)<-[:SAME_AS]-()<-[:{use}]-(:Record) }} AS nr WHERE na + nr >= $min "
        "WITH f, na + nr AS n, [(f)<-[:HAS_FP]-(a:Account) | a.bank] + CASE WHEN nr > 0 THEN [$host] ELSE [] END AS bl "
        "WITH f, n, reduce(s = [], b IN bl | CASE WHEN b IN s THEN s ELSE s + b END) AS banks "
        "WHERE size(banks) >= $banks WITH f, n, size(banks) AS nb ORDER BY n DESC, nb DESC, f.fp "
        "WITH collect(f) AS xs WITH size(xs) AS total, xs[0..$m] AS xs UNWIND xs AS f "
        "CALL (f) { MATCH (:Account)-[x:HAS_FP]->(f) RETURN x "
        "UNION MATCH ()-[x:SAME_AS]->(f) RETURN x "
        f"UNION MATCH (:Record)-[x:{use}]->()-[:SAME_AS]->(f) RETURN x "
        f"UNION MATCH (r:Record)-[:{use}]->()-[:SAME_AS]->(f) MATCH (r)-[x:HOLDS]->() RETURN x }} "
        f"RETURN total, 'fp:' + f.fp AS k, {EDGE_COLS}, null AS c")


_SENT_COLS = ("elementId(rm) AS si, 'Remitter' AS sl, properties(rm) AS sp, 'SENT' AS t, {} AS rp, "
              "elementId(a) AS ei, 'Account' AS el, properties(a) AS ep, c")

PATTERNS: dict[str, dict] = {
    "shared-phone": {
        "title": "Shared phone across banks",
        "description": "One phone (keyed hash) on 3 or more records/accounts at 2 or more banks. Largest first.",
        "q": _shared_q("phone", "USES_PHONE"), "p": {"min": 3, "banks": 2}},
    "shared-device": {
        "title": "Shared device across banks",
        "description": "One device (keyed hash) on 3 or more records/accounts at 2 or more banks. Largest first.",
        "q": _shared_q("device", "USES_DEVICE"), "p": {"min": 3, "banks": 2}},
    "fan-in": {
        "title": "Fan-in accounts",
        "description": "Accounts receiving transfers from 2 or more different remitters (the data holds no account "
                       "with 4 or more, so the threshold is 2). Most senders first.",
        "q": ("MATCH (a:Account)<-[:TO]-(:Transfer)<-[:SENT]-(rm:Remitter) WITH a, count(DISTINCT rm) AS n "
              "WHERE n >= $min WITH a, n ORDER BY n DESC, a.iban "
              "WITH collect(a) AS xs WITH size(xs) AS total, xs[0..$m] AS xs UNWIND xs AS a "
              "MATCH (rm:Remitter)-[:SENT]->(t:Transfer)-[:TO]->(a) WITH total, a, rm, count(t) AS c "
              "RETURN total, a.iban AS k, " + _SENT_COLS),
        "p": {"min": 2}},
    "fan-out": {
        "title": "Fan-out remitters",
        "description": "Remitters paying 4 or more beneficiary accounts at 3 or more banks. Most banks first.",
        "q": ("MATCH (rm:Remitter)-[:SENT]->(:Transfer)-[:TO]->(a:Account) "
              "WITH rm, count(DISTINCT a) AS na, count(DISTINCT a.bank) AS nb WHERE na >= $min AND nb >= $banks "
              "WITH rm, na, nb ORDER BY nb DESC, na DESC, rm.rmid "
              "WITH collect(rm) AS xs WITH size(xs) AS total, xs[0..$m] AS xs UNWIND xs AS rm "
              "MATCH (rm)-[:SENT]->(t:Transfer)-[:TO]->(a:Account) WITH total, rm, a, count(t) AS c "
              "RETURN total, rm.rmid AS k, " + _SENT_COLS),
        "p": {"min": 4, "banks": 3}},
    "cross-bank-person": {
        "title": "Person reaching 3+ banks",
        "description": "A resolved person whose phone or device also appears, as partner fingerprints, on accounts at "
                       "other banks: 3 or more banks in total.",
        "q": ("MATCH (p:Person)<-[:RESOLVES_TO]-(:Record)-[:USES_PHONE|USES_DEVICE]->()-[:SAME_AS]->(:Fingerprint)"
              "<-[:HAS_FP]-(a:Account) WITH p, count(DISTINCT a.bank) + 1 AS nb, count(DISTINCT a) AS na "
              "WHERE nb >= $banks WITH p, nb, na ORDER BY nb DESC, na DESC, p.pid "
              "WITH collect(p) AS xs WITH size(xs) AS total, xs[0..$m] AS xs UNWIND xs AS p "
              "CALL (p) { MATCH (:Record)-[x:RESOLVES_TO]->(p) RETURN x "
              "UNION MATCH (p)<-[:RESOLVES_TO]-(:Record)-[x:HOLDS|USES_PHONE|USES_DEVICE]->() RETURN x "
              "UNION MATCH (p)<-[:RESOLVES_TO]-(:Record)-[:USES_PHONE|USES_DEVICE]->()-[x:SAME_AS]->() RETURN x "
              "UNION MATCH (p)<-[:RESOLVES_TO]-(:Record)-[:USES_PHONE|USES_DEVICE]->()-[:SAME_AS]->()"
              "<-[x:HAS_FP]-(:Account) RETURN x } "
              f"RETURN total, p.pid AS k, {EDGE_COLS}, null AS c"),
        "p": {"banks": 3}},
    "partner-hit": {
        "title": "Partner fingerprint hits",
        "description": "Host-bank phones/devices whose keyed hash equals a partner bank's signed fingerprint. "
                       "Most partner accounts first.",
        "q": ("MATCH (h)-[:SAME_AS]->(f:Fingerprint) WITH h, f, COUNT { (f)<-[:HAS_FP]-() } AS na "
              "ORDER BY na DESC, f.fp WITH collect({h: h, f: f}) AS xs WITH size(xs) AS total, xs[0..$m] AS xs "
              "UNWIND xs AS y WITH total, y.h AS h, y.f AS f "
              "CALL (h, f) { MATCH (h)-[x:SAME_AS]->(f) RETURN x "
              "UNION MATCH (:Record)-[x:USES_PHONE|USES_DEVICE]->(h) RETURN x "
              "UNION MATCH (:Account)-[x:HAS_FP]->(f) RETURN x } "
              f"RETURN total, 'fp:' + f.fp AS k, {EDGE_COLS}, null AS c"),
        "p": {}},
}


def patterns_list() -> list[dict]:
    return [{"key": k, "title": v["title"], "description": v["description"]} for k, v in PATTERNS.items()]


def assemble_matches(rows: list[dict], node_cap: int = PATTERN_NODE_CAP) -> tuple[G, list[list[str]]]:
    """Group pattern rows by match key (in row order) and add whole matches until the node cap."""
    groups: dict[str, list] = {}
    for r in rows:
        groups.setdefault(r["k"], []).append(r)
    g, matches = G(), []
    for k, rs in groups.items():
        fresh = {i for r in rs for i in (r["si"], r["ei"]) if i not in g.uid}
        if matches and len(g.nodes) + len(fresh) > node_cap:
            break
        g.add_rows(rs)
        matches.append(sorted({g.uid[i] for r in rs for i in (r["si"], r["ei"]) if i in g.uid}))
    return g, matches


def run_pattern(key: str) -> dict | None:
    pat = PATTERNS.get(key)
    if not pat:
        return None
    if key not in _PATTERN_CACHE:      # deterministic and small (<=400 nodes): computed once per process
        _PATTERN_CACHE[key] = _run_pattern(key, pat)
    return _PATTERN_CACHE[key]


_PATTERN_CACHE: dict[str, dict] = {}


def _run_pattern(key: str, pat: dict) -> dict:
    rows = _read(pat["q"], {"host": config.HOST_BANK, "m": PATTERN_MATCH_LIMIT, **pat["p"]}, timeout=20)
    g, matches = assemble_matches(rows)
    d = g.gdata(scenarios=scenario_membership())
    total = rows[0]["total"] if rows else 0
    return {"key": key, "title": pat["title"], "description": pat["description"], **d,
            "matches": matches, "count": total, "shown": len(matches)}


# ------------------------------------------------------------------ offline helpers
def _offline_grand() -> dict | None:
    c = sse.load_cache(cache_key("grand"))
    return c.get("result") if c else None


def _replay(name: str):
    import offline
    return offline.replay(name)


def eid_from_node(n: dict) -> str:
    label = KIND_LABEL.get(n["kind"], n["kind"].capitalize())
    key = n["id"][3:] if n["id"][:3] in ("ph:", "dv:", "fp:") else n["id"]
    p = {KEY_PROPS.get(label, "id"): key}
    if label == "Fingerprint" and n.get("bank"):
        p["bank"] = n["bank"]
    return node_id(label, p)[0]


def offline_node(gd: dict, uid: str) -> dict | None:
    n = next((x for x in gd["nodes"] if x["id"] == uid), None)
    if not n:
        return None
    deg = Counter(l["rel"] for l in gd["links"] if uid in (l["source"], l["target"]))
    props = {"bank": n.get("bank")} if n.get("bank") else {}
    if n.get("fpKind"):
        props["kind"] = n["fpKind"]
    return {"id": uid, "kind": n["kind"], "label": n["label"], "bank": n.get("bank"), "hollow": n.get("hollow", False),
            "props": props, "degree": dict(deg), "scenarios": n.get("scenarios", []),
            "integrity": {"eid": eid_from_node(n), "committed": None, "tampered": bool(n.get("tampered"))},
            "source": "cached grand graph", "replayed": True}


def offline_edge(gd: dict, rel: str, source: str, target: str) -> dict | None:
    l = next((x for x in gd["links"] if x["rel"] == rel and {x["source"], x["target"]} == {source, target}), None)
    if not l:
        return None
    nodes = {n["id"]: n for n in gd["nodes"]}
    a, b = nodes.get(l["source"], {}), nodes.get(l["target"], {})
    f = {"bank": a.get("bank") or b.get("bank"), "score": l.get("score"), "count": l.get("count"),
         "kind": b.get("fpKind") or a.get("fpKind")}
    if rel == "SENT":
        f["bank"] = b.get("bank")
    out = {"rel": rel, "source": source, "target": target, **provenance(rel, f), "committed": None,
           "source_note": "template from the cached grand graph", "replayed": True}
    if l.get("score") is not None:
        out["score"] = l["score"]
    return out


def offline_search(gd: dict, q: str, limit: int) -> list[dict]:
    low = q.strip().lower()
    raw = low[3:] if low[:3] in ("ph:", "dv:", "fp:") else low
    out = []
    for n in gd["nodes"]:
        key = n["id"].lower()
        key = key[3:] if key[:3] in ("ph:", "dv:", "fp:") else key
        if key.startswith(raw):
            out.append({"id": n["id"], "label": n["label"], "kind": n["kind"], "bank": n.get("bank"), "match": "id"})
        elif n["kind"] in ("remitter", "person") or (n["kind"] == "record" and n.get("bank") == config.HOST_BANK):
            if raw and raw in (n["label"] or "").lower():
                out.append({"id": n["id"], "label": n["label"], "kind": n["kind"], "bank": n.get("bank"), "match": "name"})
        if len(out) >= limit:
            break
    return out


def offline_subgraph(gd: dict, ids: set[str], focus: set[str]) -> dict:
    nodes = [{**n, "focus": n["id"] in focus} for n in gd["nodes"] if n["id"] in ids]
    links = [l for l in gd["links"] if l["source"] in ids and l["target"] in ids]
    return {"nodes": nodes, "links": links, "replayed": True}


def offline_expand(gd: dict, uid: str, depth: int) -> dict:
    adj: dict[str, set] = {}
    for l in gd["links"]:
        adj.setdefault(l["source"], set()).add(l["target"])
        adj.setdefault(l["target"], set()).add(l["source"])
    ids, frontier = {uid}, {uid}
    for _ in range(max(1, min(depth, 2))):
        frontier = {m for x in frontier for m in adj.get(x, ())} - ids
        ids |= frontier
    return offline_subgraph(gd, ids if uid in adj or any(n["id"] == uid for n in gd["nodes"]) else set(), {uid})


def offline_path(gd: dict, source: str, target: str) -> dict:
    adj: dict[str, set] = {}
    for l in gd["links"]:
        adj.setdefault(l["source"], set()).add(l["target"])
        adj.setdefault(l["target"], set()).add(l["source"])
    prev, q = {source: None}, deque([source])
    while q:
        x = q.popleft()
        if x == target:
            break
        for m in adj.get(x, ()):
            if m not in prev:
                prev[m] = x
                q.append(m)
    if target not in prev:
        return {"nodes": [], "links": [], "found": False, "replayed": True}
    ids, x = [], target
    while x is not None:
        ids.append(x)
        x = prev[x]
    pairs = {frozenset(p) for p in zip(ids, ids[1:])}
    d = offline_subgraph(gd, set(ids), {source, target})
    d["links"] = [l for l in d["links"] if frozenset((l["source"], l["target"])) in pairs]
    d["found"] = True
    return d


# ------------------------------------------------------------------ routes
def _unavailable(e: Exception):
    return HTTPException(503, f"graph unavailable: {type(e).__name__}: {e}")


@router.get("/graph/grand")
def graph_grand(limit: int = GRAND_DEFAULT):
    if config.DEMO_OFFLINE:
        gd = _offline_grand()
        if gd is None:
            raise HTTPException(404, "offline: no recording 'explore-grand' (run make record-cache)")
        return {**gd, "replayed": True}
    try:
        return grand(limit)
    except Exception as e:
        raise _unavailable(e)


@router.get("/graph/node/{uid:path}")
def graph_node(uid: str):
    if config.DEMO_OFFLINE:
        hit = _replay(cache_key("node", uid))
        if hit is None and (gd := _offline_grand()):
            hit = offline_node(gd, uid)
        if hit is None:
            raise HTTPException(404, f"offline: node {uid} not recorded")
        return hit
    try:
        d = node_detail(uid)
    except Exception as e:
        raise _unavailable(e)
    if d is None:
        raise HTTPException(404, f"no node {uid}")
    return d


@router.get("/graph/edge")
def graph_edge(rel: str, source: str, target: str):
    rel = {"FP": "HAS_FP"}.get(rel.upper(), rel.upper())
    if config.DEMO_OFFLINE:
        hit = _replay(cache_key("edge", rel, source, target))
        if hit is None and (gd := _offline_grand()):
            hit = offline_edge(gd, rel, source, target)
        if hit is None:
            raise HTTPException(404, f"offline: edge {rel} {source}>{target} not recorded")
        return hit
    try:
        d = edge_detail(rel, source, target)
    except Exception as e:
        raise _unavailable(e)
    if d is None:
        raise HTTPException(404, f"no {rel} link between {source} and {target}")
    return d


@router.get("/graph/search")
def graph_search(q: str, limit: int = 20):
    if config.DEMO_OFFLINE:
        hit = _replay(cache_key("search", q.strip().lower(), limit))
        if hit is None:
            gd = _offline_grand() or {"nodes": []}
            hit = {"results": offline_search(gd, q, limit), "replayed": True}
        return hit
    try:
        return {"results": search(q, limit)}
    except Exception as e:
        raise _unavailable(e)


@router.get("/graph/expand")
def graph_expand(id: str, depth: int = 1):  # noqa: A002 - query param name is part of the contract
    if config.DEMO_OFFLINE:
        hit = _replay(cache_key("expand", id, depth))
        if hit is None:
            hit = offline_expand(_offline_grand() or {"nodes": [], "links": []}, id, depth)
        return hit
    try:
        return expand(id, depth)
    except Exception as e:
        raise _unavailable(e)


@router.get("/graph/patterns")
def graph_patterns():
    if config.DEMO_OFFLINE:
        hit = _replay(cache_key("patterns"))
        if hit is not None:
            return hit
    return {"patterns": patterns_list()}


@router.get("/graph/pattern/{key}")
def graph_pattern(key: str):
    if key not in PATTERNS:
        raise HTTPException(404, f"unknown pattern {key}")
    if config.DEMO_OFFLINE:
        hit = _replay(cache_key("pattern", key))
        if hit is None:
            p = PATTERNS[key]
            hit = {"key": key, "title": p["title"], "description": p["description"], "nodes": [], "links": [],
                   "matches": [], "count": 0, "shown": 0, "replayed": True, "note": "offline: pattern not recorded"}
        return hit
    try:
        return run_pattern(key)
    except Exception as e:
        raise _unavailable(e)


@router.get("/graph/path")
def graph_path(source: str, target: str, max: int = 6):  # noqa: A002 - contract param name
    if config.DEMO_OFFLINE:
        hit = _replay(cache_key("path", source, target, max))
        if hit is None:
            hit = offline_path(_offline_grand() or {"nodes": [], "links": []}, source, target)
        return hit
    try:
        return path(source, target, max)
    except Exception as e:
        raise _unavailable(e)
