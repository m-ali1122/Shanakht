import type { BankCode, GraphElements, GraphEdge, GraphNode } from "./types";
import { FP, IBAN } from "./scenarios";

// One graph for all scenarios, laid out once. Scenario switching only changes
// focus and highlight classes, so the graph never re-layouts mid-demo.

const nodes: GraphNode[] = [];
const edges: GraphEdge[] = [];
let eid = 0;

function acct(iban: string, bank: BankCode) {
  nodes.push({ data: { id: iban, kind: "account", label: `${bank} ··${iban.slice(-4)}`, bank } });
}
function rem(id: string, label: string) {
  nodes.push({ data: { id, kind: "remitter", label } });
}
function rec(id: string, label: string, bank: BankCode = "MRGL") {
  nodes.push({ data: { id, kind: "record", label, bank } });
}
function phone(fp: string) {
  nodes.push({ data: { id: "ph:" + fp, kind: "phone", label: fp.slice(0, 6), bank: "MRGL" } });
}
function fpn(fp: string, kind: "phone" | "device", bank: BankCode) {
  nodes.push({ data: { id: "fp:" + fp, kind: "fingerprint", label: fp.slice(0, 6), bank, hollow: true, fpKind: kind } });
}
function e(source: string, target: string, rel: string, label?: string) {
  edges.push({ data: { id: `e${eid++}`, source, target, rel, label } });
}

// ---------- S1
rem("RM-S1", "Kamran Butt");
acct(IBAN.S1, "MRGL");
rec("R-MRGL-S1", "AYESHA SIDDIQUI");
e("RM-S1", IBAN.S1, "SENT", "3");
e("R-MRGL-S1", IBAN.S1, "HOLDS");

// ---------- S2
rem("RM-S2", "Rehmat Ali");
acct(IBAN.S2, "RAVI");
fpn(FP.S2_PHONE, "phone", "RAVI");
e("RM-S2", IBAN.S2, "SENT", "7");
e(IBAN.S2, "fp:" + FP.S2_PHONE, "FP");

// ---------- S3
rem("RM-S3", "Shahid Hussain");
acct(IBAN.S3_TYPED, "MRGL");
acct(IBAN.S3_INTENDED, "MRGL");
rec("R-MRGL-S3-T", "TARIQ MEHMOOD");
rec("R-MRGL-S3-Z", "ZAINAB BIBI");
e("RM-S3", IBAN.S3_INTENDED, "SENT", "4");
e("RM-S3", IBAN.S3_TYPED, "SENT", "new");
e("R-MRGL-S3-T", IBAN.S3_TYPED, "HOLDS");
e("R-MRGL-S3-Z", IBAN.S3_INTENDED, "HOLDS");

// ---------- S4
rem("RM-S4", "Farhan Raja");
acct(IBAN.S4, "CHNB");
fpn(FP.S4_PHONE, "phone", "CHNB");
e("RM-S4", IBAN.S4, "SENT", "2");
e(IBAN.S4, "fp:" + FP.S4_PHONE, "FP");

// ---------- S5 ring A
rem("RM-S5", "Faisal Nawaz");
acct(IBAN.S5_1, "MRGL");
acct(IBAN.S5_2, "MRGL");
acct(IBAN.S5_3, "RAVI");
acct(IBAN.S5_4, "RAVI");
acct(IBAN.S5_5, "INDS");
acct(IBAN.S5_6, "INDS");
rec("R-MRGL-S5-1", "USMAN GHANI");
rec("R-MRGL-S5-2", "M USMAN");
phone(FP.S5_PHONE);
fpn(FP.S5_PHONE, "phone", "RAVI");
fpn(FP.S5_DEVICE, "device", "INDS");
for (const a of [IBAN.S5_1, IBAN.S5_2, IBAN.S5_3, IBAN.S5_4, IBAN.S5_5]) e("RM-S5", a, "SENT", "1");
e("R-MRGL-S5-1", IBAN.S5_1, "HOLDS");
e("R-MRGL-S5-2", IBAN.S5_2, "HOLDS");
e("R-MRGL-S5-1", "ph:" + FP.S5_PHONE, "USES_PHONE");
e("R-MRGL-S5-2", "ph:" + FP.S5_PHONE, "USES_PHONE");
e("ph:" + FP.S5_PHONE, "fp:" + FP.S5_PHONE, "SAME_AS");
for (const a of [IBAN.S5_3, IBAN.S5_4, IBAN.S5_5]) e(a, "fp:" + FP.S5_PHONE, "FP");
e(IBAN.S5_3, "fp:" + FP.S5_DEVICE, "FP");
e(IBAN.S5_5, "fp:" + FP.S5_DEVICE, "FP");
e(IBAN.S5_6, "fp:" + FP.S5_DEVICE, "FP");

// ---------- Ring B (unscripted): 4 beneficiaries, 2 banks
rem("RM-RB", "Tariq Aslam");
fpn(FP.RB_PHONE, "phone", "RAVI");
const RB = ["PK36MRGL0000000000081001", "PK36MRGL0000000000081002", "PK36RAVI0000000000081003", "PK36RAVI0000000000081004"];
RB.forEach((a, i) => { acct(a, i < 2 ? "MRGL" : "RAVI"); e("RM-RB", a, "SENT", "1"); e(a, "fp:" + FP.RB_PHONE, "FP"); });

// ---------- Ring C (unscripted): 6 beneficiaries, 3 banks
const RC_DEV = "4f2a90c1e7b36d58";
rem("RM-RC", "Asif Qureshi");
fpn(RC_DEV, "device", "CHNB");
const RC = ["PK36MRGL0000000000082001", "PK36MRGL0000000000082002", "PK36CHNB0000000000082003", "PK36CHNB0000000000082004", "PK36INDS0000000000082005", "PK36INDS0000000000082006"];
const RC_BANKS: BankCode[] = ["MRGL", "MRGL", "CHNB", "CHNB", "INDS", "INDS"];
RC.forEach((a, i) => { acct(a, RC_BANKS[i]); e("RM-RC", a, "SENT", "1"); e(a, "fp:" + RC_DEV, "FP"); });
export const RING_C = { remitter: "RM-RC", accounts: RC, device: "fp:" + RC_DEV };
export const RING_B = { remitter: "RM-RB", accounts: RB, phone: "fp:" + FP.RB_PHONE };

// ---------- Background: ordinary remitters (deterministic)
const BG_REM = ["Naveed Butt", "Sana Malik", "Hassan Awan", "Rabia Sheikh", "Waqas Mughal", "Adeel Bhatti", "Hira Abbasi", "Kamran Rajput"];
const BG_REC = ["SAIMA BUTT", "IQRA MALIK", "HUSSAIN AWAN", "NIMRA SHEIKH", "SHAHID MUGHAL", "AMNA BHATTI", "MARYAM ABBASI", "ASIF RAJPUT", "FATIMA AWAN", "BILAL MALIK"];
const BANKS: BankCode[] = ["MRGL", "RAVI", "CHNB", "INDS"];
let r = 1;
BG_REM.forEach((name, i) => {
  const id = `RM-BG${i + 1}`;
  rem(id, name);
  const n = 1 + (i % 3 === 0 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const bank = BANKS[(i + k) % 4];
    const iban = `PK36${bank}00000000000900${String(r).padStart(2, "0")}`;
    acct(iban, bank);
    e(id, iban, "SENT", String(2 + ((i + k) % 5)));
    if (bank === "MRGL") {
      const rid = `R-MRGL-BG${r}`;
      rec(rid, BG_REC[(r - 1) % BG_REC.length]);
      e(rid, iban, "HOLDS");
    }
    r++;
  }
});

export const MOCK_GRAPH: GraphElements = { nodes, edges };
export const HIDDEN_UNTIL_INCOMING = [IBAN.S5_6];
