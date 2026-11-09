"""P2 loader: build the schema in docs/SPEC.md 4.5 from data/out into Neo4j.

Privacy model:
  * Only MRGL (host) gets full :Record nodes (+ Phone/Device hashed nodes).
  * Partner banks (RAVI, CHNB, INDS) contribute :Account/:Bank and opaque HMAC :Fingerprint nodes only,
    delivered as Ed25519-signed batches that are verified before any write. No partner name/phone/device/CNIC
    (and no partner title_raw) is stored.
Usage: python data/neo4j/load.py [--no-resolver]
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = ROOT / "data" / "out"
sys.path.insert(0, str(HERE))
import signing  # noqa: E402


def load_env():
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                if v.strip():
                    os.environ.setdefault(k.strip(), v.strip())


load_env()
HMAC_KEY = os.getenv("CONSORTIUM_HMAC_KEY", "demo-consortium-key")
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
AUTH = (os.getenv("NEO4J_USER", "neo4j"), os.getenv("NEO4J_PASSWORD", "shanakht2026"))
RESOLVER = os.getenv("RESOLVER_URL", "http://localhost:8102")
HOST = "MRGL"
log = lambda *a: print("[load]", *a, flush=True)  # noqa: E731


def norm(kind, v):
    v = (v or "").strip()
    return re.sub(r"\D", "", v) if kind in ("phone", "cnic") else v.lower()


def fp(kind, v):
    return hmac.new(HMAC_KEY.encode(), norm(kind, v).encode(), hashlib.sha256).hexdigest()


def jl(name):
    return [json.loads(l) for l in (OUT / name).open(encoding="utf-8") if l.strip()]


def chunks(xs, n=2000):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def resolve(records):
    """Return (list of {person_id, canonical_name, members:[(rid,score)]}, method)."""
    payload = [{k: r.get(k) for k in ("rid", "raw_name", "urdu_name", "father_name", "gender", "cnic_syn")} for r in records]
    if "--no-resolver" not in sys.argv:
        try:
            import httpx
            resp = httpx.post(f"{RESOLVER}/resolve-batch", json={"records": payload}, timeout=600)
            resp.raise_for_status()
            out = []
            for c in resp.json()["clusters"]:
                ms = c.get("member_scores", {})
                out.append({"pid": c["person_id"], "name": c["canonical_name"],
                            "members": [(r, ms.get(r, c.get("confidence", 1.0))) for r in c["rids"]]})
            return out, "resolver /resolve-batch"
        except Exception as e:
            log("resolver unavailable:", repr(e)[:120])
    groups = {}
    for r in payload:
        key = " ".join(re.sub(r"[^a-z ]", "", (r["raw_name"] or "").lower()).split())
        groups.setdefault(key, []).append(r["rid"])
    return [{"pid": "P-X" + hashlib.sha256(k.encode()).hexdigest()[:10], "name": k.title(),
             "members": [(m, 1.0) for m in ms]} for k, ms in groups.items()], "exact-canonical-name fallback"


def main():
    from neo4j import GraphDatabase
    drv = GraphDatabase.driver(NEO4J_URI, auth=AUTH)
    drv.verify_connectivity()
    s = drv.session()
    run = lambda q, **p: s.run(q, **p).consume()  # noqa: E731

    banks, houses = json.loads((OUT / "banks.json").read_text("utf-8")), json.loads((OUT / "exchange_houses.json").read_text("utf-8"))
    accounts, records, remitters, transfers = jl("accounts.jsonl"), jl("records.jsonl"), jl("remitters.jsonl"), jl("transfers.jsonl")
    log("input:", len(accounts), "accounts,", len(records), "records,", len(remitters), "remitters,", len(transfers), "transfers")

    run("MATCH (n) DETACH DELETE n")
    for q in ["CREATE INDEX acct_iban IF NOT EXISTS FOR (n:Account) ON (n.iban)",
              "CREATE INDEX rec_rid IF NOT EXISTS FOR (n:Record) ON (n.rid)",
              "CREATE INDEX fp_fp IF NOT EXISTS FOR (n:Fingerprint) ON (n.fp)",
              "CREATE INDEX rm_id IF NOT EXISTS FOR (n:Remitter) ON (n.rmid)",
              "CREATE INDEX tx_tid IF NOT EXISTS FOR (n:Transfer) ON (n.tid)",
              "CREATE INDEX phone_h IF NOT EXISTS FOR (n:Phone) ON (n.h)",
              "CREATE INDEX device_h IF NOT EXISTS FOR (n:Device) ON (n.h)",
              "CREATE INDEX bank_code IF NOT EXISTS FOR (n:Bank) ON (n.code)",
              "CREATE INDEX person_pid IF NOT EXISTS FOR (n:Person) ON (n.pid)"]:
        run(q)

    run("UNWIND $b AS b CREATE (:Bank {code: b.code, name: b.name})", b=banks)
    run("UNWIND $h AS h CREATE (:ExchangeHouse {code: h.code, name: h.name, country: h.country})", h=houses)
    for c in chunks(remitters):
        run("UNWIND $r AS r CREATE (:Remitter {rmid: r.rmid, name: r.name, country: r.country})", r=c)

    # Accounts: title_raw only for the host bank's own accounts.
    rows = [{"iban": a["iban"], "bank": a["bank"], "t": a["title_raw"] if a["bank"] == HOST else None,
             "sc": a["title_script"] if a["bank"] == HOST else None} for a in accounts]
    for c in chunks(rows):
        run("""UNWIND $r AS r MATCH (b:Bank {code: r.bank})
               CREATE (a:Account {iban: r.iban, bank: r.bank}) SET a.title_raw = r.t, a.title_script = r.sc
               CREATE (a)-[:AT]->(b)""", r=c)

    # Host bank: full records
    mrgl = [r for r in records if r["bank"] == HOST]
    rows = [{"rid": r["rid"], "bank": HOST, "raw_name": r["raw_name"], "urdu_name": r.get("urdu_name"),
             "script": r.get("script"), "cnic": r.get("cnic_syn"), "phone": r.get("phone"),
             "device": r.get("device"), "iban": r["iban"],
             "ph": fp("phone", r["phone"]) if r.get("phone") else None,
             "dh": fp("device", r["device"]) if r.get("device") else None} for r in mrgl]
    for c in chunks(rows):
        run("""UNWIND $r AS r MATCH (a:Account {iban: r.iban})
               CREATE (x:Record {rid: r.rid, bank: r.bank, raw_name: r.raw_name, urdu_name: r.urdu_name,
                                 script: r.script, cnic_syn: r.cnic, phone: r.phone, device: r.device})
               CREATE (x)-[:HOLDS]->(a)
               FOREACH (_ IN CASE WHEN r.ph IS NULL THEN [] ELSE [1] END |
                   MERGE (p:Phone {h: r.ph}) CREATE (x)-[:USES_PHONE]->(p))
               FOREACH (_ IN CASE WHEN r.dh IS NULL THEN [] ELSE [1] END |
                   MERGE (d:Device {h: r.dh}) CREATE (x)-[:USES_DEVICE]->(d))""", r=c)
    log("MRGL records:", len(mrgl))

    # Partner banks: signed fingerprint batches
    by_bank = {}
    for r in records:
        if r["bank"] != HOST:
            by_bank.setdefault(r["bank"], []).append(r)
    batches = 0
    for bank, recs in sorted(by_bank.items()):
        fps = []
        for r in recs:
            for kind, val in (("phone", r.get("phone")), (  "device", r.get("device")), ("cnic", r.get("cnic_syn"))):
                if val:
                    fps.append({"fp": fp(kind, val), "kind": kind, "iban": r["iban"]})
        signed = signing.sign_batch(bank, f"B-{bank}-{os.getenv('SEED', '20261111')}", fps)
        try:
            payload = signing.verify_batch(signed)
        except signing.BatchRejected as e:
            log(f"REJECTED batch from {bank}: {e}")
            continue
        batches += 1
        for c in chunks(payload["fingerprints"]):
            run("""UNWIND $f AS f MATCH (a:Account {iban: f.iban})
                   MERGE (n:Fingerprint {fp: f.fp}) ON CREATE SET n.kind = f.kind
                   MERGE (a)-[:HAS_FP]->(n)
                   SET n.bank = coalesce(n.bank, $bank), n.batch_id = $bid, n.signer = $signer""",
                bank=bank, bid=payload["batch_id"], signer=signed["signer"], f=c)
        log(f"verified+loaded batch {payload['batch_id']} from {bank}: {len(payload['fingerprints'])} fingerprints")

    run("MATCH (p:Phone) MATCH (f:Fingerprint {fp: p.h, kind: 'phone'}) MERGE (p)-[:SAME_AS]->(f)")
    run("MATCH (d:Device) MATCH (f:Fingerprint {fp: d.h, kind: 'device'}) MERGE (d)-[:SAME_AS]->(f)")

    # Person resolution (host records only)
    clusters, method = resolve(mrgl)
    log("person resolution via:", method, "->", len(clusters), "clusters")
    rows = [{"pid": c["pid"], "name": c["name"], "m": [{"rid": r, "score": float(sc)} for r, sc in c["members"]]} for c in clusters]
    for c in chunks(rows, 500):
        run("""UNWIND $r AS r CREATE (p:Person {pid: r.pid, canonical_name: r.name})
               WITH p, r UNWIND r.m AS m MATCH (x:Record {rid: m.rid})
               CREATE (x)-[:RESOLVES_TO {score: m.score}]->(p)""", r=c)

    # Transfers
    for c in chunks(transfers, 3000):
        run("""UNWIND $t AS t MATCH (rm:Remitter {rmid: t.rmid}) MATCH (a:Account {iban: t.iban})
               MATCH (h:ExchangeHouse {code: t.exchange_house})
               CREATE (x:Transfer {tid: t.tid, amount_pkr: t.amount_pkr, amount_fx: t.amount_fx, currency: t.currency,
                                   ts: datetime(t.ts), typed_name: t.typed_name, band: t.band})
               CREATE (rm)-[:SENT]->(x)-[:TO]->(a) CREATE (x)-[:VIA]->(h)""", t=c)

    counts = {}
    for lab in ["Bank", "Account", "Record", "Person", "Remitter", "ExchangeHouse", "Transfer", "Phone", "Device", "Fingerprint"]:
        counts[lab] = s.run(f"MATCH (n:{lab}) RETURN count(n) AS c").single()["c"]
    for rel in ["HOLDS", "RESOLVES_TO", "SAME_AS", "HAS_FP", "SENT", "TO", "VIA"]:
        counts["-" + rel] = s.run(f"MATCH ()-[r:{rel}]->() RETURN count(r) AS c").single()["c"]
    counts["verified_batches"] = batches
    log("counts:", json.dumps(counts))

    q = (HERE / "motifs.cypher").read_text(encoding="utf-8")
    for r in s.run(q.rstrip().rstrip(";")):
        log("ring:", r["remitter"], r["shared_fp"], r["beneficiaries"], r["banks"])
    drv.close()


if __name__ == "__main__":
    main()
