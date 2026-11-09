"""Shanakht synthetic data generator (spec section 4, fixtures from docs/CONTRACTS.md).

Deterministic: seed from env SEED (default 20261111). Writes data/out/*.
Run:  .venv/Scripts/python.exe data/generator/generate.py
"""
import datetime as dt
import json
import os
import random
import re
import sys
import uuid
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from perturb import VARIANTS, add_patronymic, perturb  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = HERE.parents[1]
OUT = ROOT / "data" / "out"
SEED = int(os.getenv("SEED", "20261111"))

BANKS = [
    {"code": "MRGL", "id": 1, "name": "Margalla Bank", "role": "host",
     "quirk": "UPPERCASE, no titles, max 35 chars"},
    {"code": "RAVI", "id": 2, "name": "Ravi Commercial Bank", "role": "partner",
     "quirk": "UPPERCASE, A to Z only"},
    {"code": "CHNB", "id": 3, "name": "Chenab Bank", "role": "partner",
     "quirk": "UPPERCASE, customer-chosen English spelling"},
    {"code": "INDS", "id": 4, "name": "Indus Microfinance", "role": "partner",
     "quirk": "Title Case, initials, truncate 24"},
]
BANK_CODES = [b["code"] for b in BANKS]
EXCHANGE_HOUSES = [
    {"code": "GULF", "name": "Gulf Bridge Exchange", "country": "AE", "currency": "AED", "fx": 76.0},
    {"code": "THMS", "name": "Thames Remit", "country": "UK", "currency": "GBP", "fx": 375.0},
    {"code": "NAJD", "name": "Najd Transfer", "country": "SA", "currency": "SAR", "fx": 74.5},
    {"code": "HUDS", "name": "Hudson Remit", "country": "US", "currency": "USD", "fx": 280.0},
]
EH = {e["code"]: e for e in EXCHANGE_HOUSES}

GIVEN_M = ["Muhammad", "Ahmad", "Ali", "Imran", "Usman", "Bilal", "Faisal", "Tariq", "Zulfiqar",
           "Abdul Rehman", "Hamza", "Hassan", "Hussain", "Shahid", "Asif", "Kamran", "Naveed",
           "Waqas", "Adeel", "Farhan"]
GIVEN_F = ["Ayesha", "Fatima", "Zainab", "Maryam", "Sana", "Rabia", "Hira", "Nimra", "Saima",
           "Shazia", "Amna", "Iqra", "Mehwish", "Sadia"]
FAMILY = ["Raja", "Chaudhry", "Malik", "Sheikh", "Syed", "Mian", "Khan", "Butt", "Qureshi", "Awan",
          "Siddiqui", "Abbasi", "Rajput", "Bhatti", "Mughal"]
FATHERS = GIVEN_M + ["Rehmat", "Nawaz", "Akram", "Aslam", "Bashir", "Ghulam Rasool", "Mehmood", "Yousaf"]
TITLE_POOL = ["Raja", "Ch.", "Syed", "Rana", "Hafiz", "Mian"]

START = dt.datetime(2026, 5, 9)
END = dt.datetime(2026, 11, 8, 23, 59)
EID_ADHA = dt.date(2026, 5, 27)

SCRIPT_MAP = json.loads((HERE / "script_map.json").read_text(encoding="utf-8"))["names"]
URDU = {e["roman"].lower(): e["urdu"] for e in SCRIPT_MAP}
SHAHMUKHI = {e["roman"].lower(): e["shahmukhi"] for e in SCRIPT_MAP if "shahmukhi" in e}
URDU["ch."] = URDU["chaudhry"]
URDU["m."] = URDU["muhammad"]


# ------------------------------------------------------------------ helpers
def to_urdu(canonical_name: str, shahmukhi: bool = False) -> str:
    """Map a canonical Roman name (title + given + family) to Urdu script, phrase-first."""
    toks = canonical_name.split()
    out, i = [], 0
    while i < len(toks):
        two = " ".join(toks[i:i + 2]).lower()
        if i + 1 < len(toks) and two in URDU:
            out.append(URDU[two]); i += 2; continue
        t = toks[i].lower()
        if shahmukhi and t in SHAHMUKHI:
            out.append(SHAHMUKHI[t])
        else:
            out.append(URDU.get(t, toks[i]))
        i += 1
    return " ".join(out)


TITLE_STRIP = re.compile(r"^(raja|ch\.?|chaudhry|syed|rana|hafiz|mian|malik|sheikh)\s+", re.I)
REL_STRIP = re.compile(r"\s+(s/o|d/o|w/o)\s+.*$", re.I)


def title_for(bank: str, name: str, keep_title: bool = True) -> str:
    """Apply a bank's account-title quirk (spec 4.1) to a KYC English name."""
    n = REL_STRIP.sub("", name).strip()
    if bank == "MRGL":
        n = TITLE_STRIP.sub("", n)
        return n.upper()[:35].strip()
    if bank == "RAVI":
        n = re.sub(r"[^A-Za-z ]", "", n.replace("-", ""))
        return re.sub(r"\s+", " ", n).upper().strip()
    if bank == "CHNB":
        return n.upper()
    if bank == "INDS":
        toks = [t.title() if not t.endswith(".") else t[0].upper() + "." for t in n.split()]
        if toks and toks[0] in ("Muhammad", "Mohammad", "Mohd", "Muhammed", "Mohammed", "Muhd"):
            toks[0] = "M."
        s = " ".join(toks)
        if len(s) > 24:
            toks = [t[0] + "." if k < len(toks) - 1 and not t.endswith(".") else t
                    for k, t in enumerate(toks)]
            s = " ".join(toks)
        return s[:24].strip()
    raise ValueError(bank)


class Gen:
    def __init__(self, seed):
        self.rng = random.Random(seed)
        self.used_cnic, self.used_phone, self.used_iban = set(), set(), set()
        self.persons, self.records, self.accounts = [], [], []
        self.remitters, self.transfers = [], []
        self.rec_counter = Counter()
        self.tid = 0

    # ----------------------------------------------------- identifiers
    def cnic(self):
        while True:
            c = f"9{self.rng.randrange(10**4):04d}-{self.rng.randrange(10**7):07d}-{self.rng.randrange(10)}"
            if c not in self.used_cnic:
                self.used_cnic.add(c); return c

    def phone(self):
        while True:
            p = f"03{self.rng.randrange(10, 50):02d}-{self.rng.randrange(10**7):07d}"
            if p not in self.used_phone and p != "0300-5550505":
                self.used_phone.add(p); return p

    def device(self):
        return str(uuid.UUID(int=self.rng.getrandbits(128), version=4))

    def iban(self, bank):
        while True:
            i = f"PK{self.rng.randrange(10, 100)}{bank}{self.rng.randrange(10**6, 10**16):016d}"
            if i not in self.used_iban:
                self.used_iban.add(i); return i

    # ----------------------------------------------------- people
    def new_person(self, pid=None, given=None, family=None, title=None, gender=None,
                   father=None, phone=None, device=None, middle=None):
        rng = self.rng
        gender = gender or ("M" if rng.random() < 0.62 else "F")
        if given is None:
            given = rng.choice(GIVEN_M if gender == "M" else GIVEN_F)
            if gender == "M" and given != "Muhammad" and rng.random() < 0.25:
                middle = given; given = "Muhammad"
        if family is None:
            family = rng.choice(FAMILY)
        if title is None and rng.random() < 0.12:
            title = rng.choice(TITLE_POOL)
            if title.lower().rstrip(".") in family.lower():
                title = None
        father = father or rng.choice(FATHERS)
        parts = [p for p in (title, given, middle, family) if p]
        canonical = " ".join(parts)
        p = {"person_id": pid or f"P{len(self.persons) + 1:05d}", "canonical_name": canonical,
             "title": title, "given": given, "middle": middle, "family": family,
             "father": father, "gender": gender, "cnic_syn": self.cnic(),
             "phone": phone or self.phone(), "device": device or self.device()}
        self.persons.append(p)
        return p

    def new_record(self, person, bank, rid=None, raw_name=None, title_raw=None, iban=None,
                   urdu_name=None, phone=None, device=None, perturb_name=True):
        rng = self.rng
        self.rec_counter[bank] += 1
        rid = rid or f"R-{bank}-{self.rec_counter[bank]:05d}"
        if raw_name is None:
            raw_name = person["canonical_name"]
            if perturb_name:
                allow = ("variant", "drop_title", "add_title", "case", "collapse")
                if bank == "CHNB":  # customer-chosen spelling: always a variant if possible
                    from perturb import apply_variant
                    raw_name = apply_variant(raw_name, rng)
                raw_name, _ = perturb(raw_name, rng, n_max=2, typo_rate=0.05, allow=allow)
        shah = person["canonical_name"] and rng.random() < 0.03 and any(
            t.lower() in SHAHMUKHI for t in person["canonical_name"].split())
        if urdu_name is None:
            urdu_name = to_urdu(person["canonical_name"], shahmukhi=shah)
        script = "shahmukhi" if shah else "urdu"
        iban = iban or self.iban(bank)
        self.used_iban.add(iban)
        rec = {"rid": rid, "bank": bank, "person_id": person["person_id"], "raw_name": raw_name,
               "urdu_name": urdu_name, "script": script, "father_name": person["father"],
               "gender": person["gender"], "cnic_syn": person["cnic_syn"],
               "phone": phone or person["phone"], "device": device or person["device"],
               "iban": iban, "synthetic": True}
        self.records.append(rec)
        self.accounts.append({"iban": iban, "bank": bank, "rid": rid,
                              "title_raw": title_raw or title_for(bank, raw_name),
                              "title_script": "roman", "synthetic": True})
        return rec

    # ----------------------------------------------------- remitters / transfers
    def new_remitter(self, rmid, name, eh_code):
        r = {"rmid": rmid, "name": name, "country": EH[eh_code]["country"],
             "exchange_house": eh_code, "synthetic": True}
        self.remitters.append(r)
        return r

    def transfer(self, rem, iban, bank, ts, typed_name, amount_pkr=None, ring=None, scenario=None):
        self.tid += 1
        e = EH[rem["exchange_house"]]
        amount_pkr = amount_pkr or int(round(self.rng.lognormvariate(11.0, 0.6) / 100) * 100)
        self.transfers.append({
            "tid": f"T{self.tid:06d}", "rmid": rem["rmid"], "exchange_house": e["code"],
            "iban": iban, "bank": bank, "amount_pkr": amount_pkr,
            "amount_fx": round(amount_pkr / e["fx"], 2), "currency": e["currency"],
            "ts": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "typed_name": typed_name, "band": None,
            "ring": ring, "scenario": scenario, "synthetic": True})

    def typed_from(self, rec, person, n_max=2):
        """How a remitter abroad types the beneficiary's name."""
        name = person["canonical_name"]
        if self.rng.random() < 0.2:
            name = add_patronymic(name, person["father"], "s/o" if person["gender"] == "M" else "d/o")
        name, _ = perturb(name, self.rng, n_max=n_max, typo_rate=0.04,
                          allow=("variant", "drop_title", "case", "collapse"))
        return name


# ------------------------------------------------------------------ calendar
def day_weights():
    days, w = [], []
    d = START.date()
    while d <= END.date():
        weight = 1.0
        if d.day <= 5:
            weight *= 2.5
        if 0 < (EID_ADHA - d).days <= 7:
            weight *= 3.0
        days.append(d); w.append(weight)
        d += dt.timedelta(days=1)
    return days, w


def rand_ts(rng, days, w):
    d = rng.choices(days, weights=w)[0]
    return dt.datetime(d.year, d.month, d.day, rng.randrange(7, 23), rng.randrange(60), rng.randrange(60))


# ------------------------------------------------------------------ fixtures
def build_fixtures(g: Gen):
    rng = g.rng
    fx = {}
    # S1
    p = g.new_person("P-S1", title="", given="Ayesha", family="Siddiqui", gender="F", father="Bashir")
    g.new_record(p, "MRGL", rid="R-MRGL-S1", raw_name="Ayesha Siddiqui",
                 iban="PK36MRGL0000000000010001", title_raw="AYESHA SIDDIQUI")
    rem = g.new_remitter("RM-S1", "Kamran Butt", "THMS")
    for m in (6, 7, 8, 9, 10):
        g.transfer(rem, "PK36MRGL0000000000010001", "MRGL", dt.datetime(2026, m, 3, 11, 20),
                   "Ayesha Siddiqui", scenario="S1")
    # S2
    p = g.new_person("P-S2", title="", given="Muhammad", family=None, gender="M", father="Rehmat")
    p["family"] = None; p["canonical_name"] = "Muhammad Ali"; p["given"] = "Muhammad"; p["middle"] = "Ali"
    g.new_record(p, "RAVI", rid="R-RAVI-S2", raw_name="MUHAMMAD ALI",
                 iban="PK36RAVI0000000000020001", title_raw="MUHAMMAD ALI",
                 urdu_name="محمد علی")
    rem = g.new_remitter("RM-S2", "Rehmat Ali", "GULF")
    s2_typed = ["Mohd Ali", "Muhammad Ali s/o Rehmat", "Mohd Ali s/o Rehmat", "M. Ali",
                "Muhammad Ali", "Mohd Ali s/o Rehmat", "Mohammad Ali"]
    for k, (m, d) in enumerate([(6, 2), (7, 1), (7, 28), (8, 30), (9, 2), (10, 1), (11, 1)]):
        g.transfer(rem, "PK36RAVI0000000000020001", "RAVI", dt.datetime(2026, m, d, 14, 5 + k),
                   s2_typed[k], amount_pkr=76000 + 3800 * k, scenario="S2")
    # S3
    pz = g.new_person("P-S3-Z", title="", given="Zainab", family="Bibi", gender="F", father="Aslam")
    g.new_record(pz, "MRGL", rid="R-MRGL-S3-Z", raw_name="Zainab Bibi",
                 iban="PK36MRGL0000000000030012", title_raw="ZAINAB BIBI", urdu_name="زینب بی بی")
    pt = g.new_person("P-S3-T", title="", given="Tariq", family="Mehmood", gender="M", father="Yousaf")
    g.new_record(pt, "MRGL", rid="R-MRGL-S3-T", raw_name="Tariq Mehmood",
                 iban="PK36MRGL0000000000030021", title_raw="TARIQ MEHMOOD", urdu_name="طارق محمود")
    rem = g.new_remitter("RM-S3", "Abdul Rehman Qureshi", "NAJD")
    for m in (7, 8, 9, 10):
        g.transfer(rem, "PK36MRGL0000000000030012", "MRGL", dt.datetime(2026, m, 4, 9, 40),
                   "Zainab Bibi", scenario="S3")
    # S4
    p = g.new_person("P-S4", given="Imran", family="Akram", title="Raja", gender="M", father="Akram")
    g.new_record(p, "CHNB", rid="R-CHNB-S4", raw_name="Raja Imran Akram",
                 iban="PK36CHNB0000000000040001", title_raw="RAJA IMRAN AKRAM",
                 urdu_name="راجہ عمران اکرم")
    rem = g.new_remitter("RM-S4", "Shahid Awan", "HUDS")
    for m in (8, 9, 10):
        g.transfer(rem, "PK36CHNB0000000000040001", "CHNB", dt.datetime(2026, m, 5, 16, 0),
                   "Imraan Akram", scenario="S4")
    # S5 — ring A
    ring_phone = "0300-5550505"
    ring_dev = "5e5e5e5e-0000-4000-8000-000000000005"
    g.used_phone.add(ring_phone)
    rem = g.new_remitter("RM-S5", "Faisal Nawaz", "GULF")
    members = [
        ("R-MRGL-S5-1", "MRGL", "PK36MRGL0000000000050001", "Usman Ghani", "Usman", "Ghani", None),
        ("R-MRGL-S5-2", "MRGL", "PK36MRGL0000000000050002", "M. Usman", "Muhammad", "Usman", None),
        ("R-RAVI-S5-3", "RAVI", "PK36RAVI0000000000050003", "Bilal Ahmed", "Bilal", "Ahmad", ring_dev),
        ("R-RAVI-S5-4", "RAVI", "PK36RAVI0000000000050004", "Bilal Ahmad", "Bilal", "Ahmad", None),
        ("R-INDS-S5-5", "INDS", "PK36INDS0000000000050005", "Hamza Khan", "Hamza", "Khan", ring_dev),
    ]
    base = dt.datetime(2026, 10, 14, 8, 30)
    offsets_h = [0, 5, 11, 19, 26, 33, 41]  # 7 transfers inside 48h
    for k, (rid, bank, iban, name, given, family, dev) in enumerate(members):
        p = g.new_person(f"P-S5-{k + 1}", title="", given=given, family=family, gender="M",
                         phone=ring_phone, device=dev)
        p["canonical_name"] = name if name != "M. Usman" else "Muhammad Usman"
        g.new_record(p, bank, rid=rid, raw_name=name, iban=iban, title_raw=title_for(bank, name),
                     phone=ring_phone, device=dev, urdu_name=to_urdu(p["canonical_name"]))
    for k, h in enumerate(offsets_h):
        _, bank, iban, name, *_ = members[k % 5]
        g.transfer(rem, iban, bank, base + dt.timedelta(hours=h, minutes=7 * k), name,
                   amount_pkr=[185000, 142000, 198000, 166000, 173000, 151000, 189000][k],
                   ring="A", scenario="S5")
    # S5-6: later incoming at INDS, same device, own phone — no historical transfer.
    p = g.new_person("P-S5-6", title="", given="Hamza", family="Khan", gender="M", device=ring_dev)
    g.new_record(p, "INDS", rid="R-INDS-S5-6", raw_name="Hamza Kh.",
                 iban="PK36INDS0000000000050006", title_raw="Hamza Kh.", device=ring_dev)
    return fx


def build_ring(g: Gen, rmid, rem_name, eh, spec, start, tag):
    """spec: list of bank codes, one per beneficiary. Shared phone; first 2 share device."""
    phone = g.phone()
    dev = g.device()
    rem = g.new_remitter(rmid, rem_name, eh)
    accts = []
    for k, bank in enumerate(spec):
        p = g.new_person(phone=phone, device=dev if k < 2 else None)
        rec = g.new_record(p, bank, phone=phone, device=dev if k < 2 else None)
        accts.append((rec, p))
    for k in range(len(spec) + 2):
        rec, p = accts[k % len(spec)]
        g.transfer(rem, rec["iban"], rec["bank"], start + dt.timedelta(hours=7 * k + g.rng.randrange(3)),
                   g.typed_from(rec, p), amount_pkr=g.rng.randrange(140, 200) * 1000, ring=tag)
    return {"rmid": rmid, "beneficiaries": [a[0]["rid"] for a in accts],
            "banks": sorted(set(spec)), "phone": phone}


# ------------------------------------------------------------------ main
def main():
    g = Gen(SEED)
    rng = g.rng
    build_fixtures(g)
    ring_b = build_ring(g, "RM-RB", "Waqas Bhatti", "THMS", ["MRGL", "MRGL", "RAVI", "RAVI"],
                        dt.datetime(2026, 9, 9, 10, 0), "B")
    # Ring C spans 4 banks so the S6 query "more than three banks this quarter" finds it (see report).
    ring_c = build_ring(g, "RM-RC", "Naveed Abbasi", "NAJD",
                        ["MRGL", "RAVI", "CHNB", "INDS", "MRGL", "CHNB"],
                        dt.datetime(2026, 11, 2, 9, 0), "C")

    # --- background population: ~3,000 records per bank, ~8% multi-bank ---
    N = 11000
    for _ in range(N):
        p = g.new_person()
        primary = rng.choice(BANK_CODES)
        banks = [primary]
        if rng.random() < 0.08:
            others = [b for b in BANK_CODES if b != primary]
            banks += rng.sample(others, 2 if rng.random() < 0.15 else 1)
        for b in banks:
            g.new_record(p, b)
        # ~3% of MRGL customers hold a second MRGL account (duplicate KYC record) — gives
        # the MRGL-only ER eval real positive pairs.
        if "MRGL" in banks and rng.random() < 0.03:
            g.new_record(p, "MRGL")

    # --- remitters (~600 total) and background transfers (~20,000 total) ---
    by_person = defaultdict(list)
    for r in g.records:
        by_person[r["person_id"]].append(r)
    person_by_id = {p["person_id"]: p for p in g.persons}
    ring_pids = {r["person_id"] for r in g.records if r["phone"] == "0300-5550505"} | \
        {r["person_id"] for r in g.records if r["rid"] in set(ring_b["beneficiaries"] + ring_c["beneficiaries"])}
    pool = [r for r in g.records if r["person_id"] not in ring_pids and not r["rid"].startswith(("R-MRGL-S", "R-RAVI-S", "R-CHNB-S", "R-INDS-S"))]
    days, w = day_weights()
    eh_codes = [e["code"] for e in EXCHANGE_HOUSES]
    normal = []
    while len(g.remitters) < 600:
        k = len(g.remitters) + 1
        gender_name = f"{rng.choice(GIVEN_M)} {rng.choice(FAMILY)}"
        rem = g.new_remitter(f"RM{k:04d}", gender_name, rng.choices(eh_codes, weights=[5, 2, 4, 1])[0])
        n_ben = rng.choices([1, 2, 3, 4], weights=[45, 30, 17, 8])[0]
        bens, banks = [], set()
        while len(bens) < n_ben:
            r = rng.choice(pool)
            if len(banks | {r["bank"]}) > 3:  # normal remitters never span >3 banks
                continue
            bens.append(r); banks.add(r["bank"])
        normal.append((rem, bens))
    target = 20000 - len(g.transfers)
    for _ in range(target):
        rem, bens = rng.choice(normal)
        r = rng.choices(bens, weights=[3] + [1] * (len(bens) - 1))[0]
        g.transfer(rem, r["iban"], r["bank"], rand_ts(rng, days, w),
                   g.typed_from(r, person_by_id[r["person_id"]]))
    g.transfers.sort(key=lambda t: (t["ts"], t["tid"]))

    # --- write ---
    OUT.mkdir(parents=True, exist_ok=True)

    def jsonl(name, rows):
        with open(OUT / name, "w", encoding="utf-8", newline="\n") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    (OUT / "banks.json").write_text(json.dumps(BANKS, indent=1), encoding="utf-8")
    (OUT / "exchange_houses.json").write_text(json.dumps(EXCHANGE_HOUSES, indent=1), encoding="utf-8")
    jsonl("records.jsonl", g.records)
    jsonl("accounts.jsonl", g.accounts)
    jsonl("remitters.jsonl", g.remitters)
    jsonl("transfers.jsonl", g.transfers)
    jsonl("ground_truth.jsonl", [{"rid": r["rid"], "person_id": r["person_id"]} for r in g.records])
    rings = {"A": {"rmid": "RM-S5", "beneficiaries": ["R-MRGL-S5-1", "R-MRGL-S5-2", "R-RAVI-S5-3",
                                                      "R-RAVI-S5-4", "R-INDS-S5-5"],
                   "banks": ["INDS", "MRGL", "RAVI"], "phone": "0300-5550505"},
             "B": ring_b, "C": ring_c}
    (OUT / "rings.json").write_text(json.dumps(rings, indent=1), encoding="utf-8")

    # --- summary ---
    rc = Counter(r["bank"] for r in g.records)
    multi = sum(1 for pid, rs in by_person.items() if len({r["bank"] for r in rs}) >= 2)
    mrgl_dup = sum(1 for pid, rs in by_person.items() if sum(r["bank"] == "MRGL" for r in rs) >= 2)
    shah = sum(r["script"] == "shahmukhi" for r in g.records)
    print(f"seed={SEED}")
    print(f"{'bank':<6}{'records':>9}{'accounts':>10}{'transfers_in':>14}")
    tc = Counter(t["bank"] for t in g.transfers)
    ac = Counter(a["bank"] for a in g.accounts)
    for b in BANK_CODES:
        print(f"{b:<6}{rc[b]:>9}{ac[b]:>10}{tc[b]:>14}")
    print(f"persons={len(by_person)} cross_bank_persons={multi} ({100 * multi / len(by_person):.1f}%) "
          f"mrgl_duplicate_persons={mrgl_dup} shahmukhi_records={shah}")
    print(f"remitters={len(g.remitters)} transfers={len(g.transfers)} "
          f"range={g.transfers[0]['ts'][:10]}..{g.transfers[-1]['ts'][:10]}")
    for tag, r in rings.items():
        n_t = sum(1 for t in g.transfers if t["ring"] == tag)
        print(f"ring {tag}: remitter={r['rmid']} beneficiaries={len(r['beneficiaries'])} "
              f"banks={len(r['banks'])} ({','.join(r['banks'])}) transfers={n_t}")


if __name__ == "__main__":
    main()
