import type { CaseOutput, EgressItem, IntegrityItem, LedgerBlock, PayeeResult, StepEvent, VoiceResult } from "./types";
import { FP, IBAN, S5_RING } from "./scenarios";
import { RING_C } from "./mockGraph";

// Scripted fixtures for mock mode. Shapes are identical to what the agent
// service streams, so the UI code path is the same online and in mock.

const EPOCH = 214;
const ROOT = "0x9f2c4e81a0d7b3561c8e2f94d0a7b16e3c5d82f1a94e07b6d3c18a52e9f04b7d";

// ------------------------------------------------------------------ payee
const PAYEE: Record<string, PayeeResult> = {
  S1: {
    band: "MATCH", score: 0.99, reasons: [], title: "AYESHA SIDDIQUI", bank: "MRGL",
    alignment: [
      { typed_token: "Ayesha", title_token: "AYESHA", relation: "exact" },
      { typed_token: "Siddiqui", title_token: "SIDDIQUI", relation: "exact" },
    ],
    explain: { en: "PERSON_1 matches the account title exactly.", ur: "نام اکاؤنٹ کے عنوان سے مکمل طور پر ملتا ہے۔" },
  },
  S2: {
    band: "CLOSE", score: 0.91, reasons: ["INITIAL_EXPANDED", "VARIANT_SPELLING", "PATRONYMIC_DROPPED"], title: "MUHAMMAD ALI", bank: "RAVI",
    alignment: [
      { typed_token: "Mohd", title_token: "MUHAMMAD", relation: "initial", reason: "INITIAL_EXPANDED" },
      { typed_token: "Ali", title_token: "ALI", relation: "exact" },
      { typed_token: "s/o", title_token: null, relation: "dropped", reason: "PATRONYMIC_DROPPED" },
      { typed_token: "Rehmat", title_token: null, relation: "dropped", reason: "PATRONYMIC_DROPPED" },
    ],
    explain: {
      en: "Mohd is a short form of Muhammad, and the father's name (s/o Rehmat) is not part of the account title.",
      ur: "محمد کا مختصر نام لکھا گیا ہے، اور والد کا نام اکاؤنٹ کے عنوان میں شامل نہیں۔",
    },
    case_id: "CASE-S2",
  },
  S3: {
    band: "NO_MATCH", score: 0.07, reasons: ["DIFFERENT_PERSON"], title: "TARIQ MEHMOOD", bank: "MRGL",
    alignment: [
      { typed_token: "Zainab", title_token: null, relation: "dropped" },
      { typed_token: "Bibi", title_token: null, relation: "dropped" },
      { typed_token: null, title_token: "TARIQ", relation: "extra" },
      { typed_token: null, title_token: "MEHMOOD", relation: "extra" },
    ],
    banner: "Account exists. Name does not belong to it. This payment would have reached a stranger.",
    explain: { en: "The account belongs to a different person; no token of the typed name appears in the title.", ur: "یہ اکاؤنٹ کسی اور شخص کا ہے؛ لکھا گیا نام عنوان سے بالکل نہیں ملتا۔" },
  },
  S4: {
    band: "CLOSE", score: 0.88, reasons: ["SCRIPT_CONVERTED", "VARIANT_SPELLING", "TITLE_DROPPED"], title: "RAJA IMRAN AKRAM", bank: "CHNB",
    urdu_name: "راجہ عمران اکرم",
    alignment: [
      { typed_token: null, title_token: "RAJA", relation: "extra", reason: "TITLE_DROPPED" },
      { typed_token: "Imraan", title_token: "IMRAN", relation: "transliterated", reason: "VARIANT_SPELLING" },
      { typed_token: "Akram", title_token: "AKRAM", relation: "exact" },
    ],
    explain: {
      en: "Imraan and IMRAN are two spellings of the same Urdu name on the KYC record, and the title Raja was left out.",
      ur: "عمران کے دونوں ہجے کے وائی سی ریکارڈ کے ایک ہی اردو نام سے ملتے ہیں، اور لقب راجہ چھوڑ دیا گیا۔",
    },
    case_id: "CASE-S4",
  },
};

export function payeeEvents(key: string): StepEvent[] {
  const r = PAYEE[key];
  if (!r) return [];
  const ev: StepEvent[] = [
    { step: "title_fetch", status: "running" },
    { step: "title_fetch", status: "ok", data: { bank: r.bank, title: r.title, status: "FOUND" }, ms: 240 },
  ];
  if (r.urdu_name) ev.push({ step: "kyc_name", status: "ok", data: { urdu_name: r.urdu_name }, ms: 160 });
  ev.push(
    { step: "compare", status: "running" },
    { step: "compare", status: "ok", data: { band: r.band, score: r.score, reasons: r.reasons }, ms: 180 },
    { step: "history", status: "ok", data: key === "S2" ? { count: 7, from: "2026-06-04", to: "2026-10-28" } : key === "S3" ? { count: 0, note: "first transfer to this IBAN; 4 prior to PK36MRGL…0012" } : { count: key === "S1" ? 3 : 2 }, ms: 120 },
    { step: "decision", status: "ok", data: { band: r.band, action: r.band === "MATCH" ? "auto_pass" : r.band === "NO_MATCH" ? "hold" : "open_case" }, ms: 60 },
    { step: "phrase", status: "ok", data: r.explain, ms: 420 },
    { step: "final", status: "ok", data: r, ms: 40 },
  );
  return ev;
}

// ------------------------------------------------------------------ case
function items(defs: [string, string][]): IntegrityItem[] {
  return defs.map(([id, label], i) => ({ id, label, leaf: leafHex(id, i), status: "verified" as const }));
}
function leafHex(id: string, i: number) {
  let h = 2166136261;
  for (const c of id + i) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return "0x" + (h.toString(16).padStart(8, "0") + "c3a1" + ((h * 7) >>> 0).toString(16).padStart(8, "0")).slice(0, 16);
}

const S5_ITEMS = items([
  ["R-MRGL-S5-1", "Record · Usman Ghani (MRGL)"],
  ["RM-S5", "Remitter · Faisal Nawaz"],
  [IBAN.S5_1, "Account · MRGL ··0001"],
  [IBAN.S5_2, "Account · MRGL ··0002"],
  [IBAN.S5_3, "Account · RAVI ··0003"],
  [IBAN.S5_4, "Account · RAVI ··0004"],
  [IBAN.S5_5, "Account · INDS ··0005"],
  ["fp:" + FP.S5_PHONE, "Fingerprint · phone " + FP.S5_PHONE],
  ["fp:" + FP.S5_DEVICE, "Fingerprint · device " + FP.S5_DEVICE],
]);

const S2_ITEMS = items([
  ["RM-S2", "Remitter · Rehmat Ali"],
  [IBAN.S2, "Account · RAVI ··0001"],
  ["fp:" + FP.S2_PHONE, "Fingerprint · phone " + FP.S2_PHONE],
]);

const CASES: Record<string, CaseOutput> = {
  "CASE-S2": {
    id: "CASE-S2",
    trigger: "Close match 0.91 on a transfer from Rehmat Ali to RAVI ··0001.",
    narrative:
      "Typed name Mohd Ali s/o Rehmat differs from the title MUHAMMAD ALI only by a short form of Muhammad and the father's name. Rehmat Ali has sent 7 transfers to this account between June and October, none returned. The account's phone fingerprint is not in the consortium registry.",
    narrative_ur: "رحمت علی نے جون سے اکتوبر تک اسی اکاؤنٹ میں سات رقوم بھیجیں، کوئی واپس نہیں ہوئی۔ رجسٹری میں کوئی اندراج نہیں۔",
    evidence: [
      { claim: "7 prior transfers, same remitter to same IBAN, 2026-06-04 to 2026-10-28", node_ids: ["RM-S2", IBAN.S2] },
      { claim: "Account phone fingerprint not flagged in registry", node_ids: ["fp:" + FP.S2_PHONE] },
    ],
    risk: "low", recommended_action: "proceed", confidence: 0.93,
    integrity: { verified: 3, total: 3, epoch: EPOCH, block: 1041, root: ROOT, items: S2_ITEMS },
  },
  "CASE-S4": {
    id: "CASE-S4",
    trigger: "Close match 0.88 on a transfer from Farhan Raja to CHNB ··0001.",
    narrative: "Both spellings map to the Urdu name on the KYC record. Farhan Raja has sent 2 earlier transfers to this account. No registry entry for the account's fingerprints.",
    evidence: [{ claim: "2 prior transfers, same remitter to same IBAN", node_ids: ["RM-S4", IBAN.S4] }],
    risk: "low", recommended_action: "proceed", confidence: 0.88,
    integrity: { verified: 2, total: 2, epoch: EPOCH, block: 1041, root: ROOT, items: items([["RM-S4", "Remitter · Farhan Raja"], [IBAN.S4, "Account · CHNB ··0001"]]) },
  },
  "CASE-S5": {
    id: "CASE-S5",
    trigger: "Ring alert: star motif around Faisal Nawaz with a shared phone fingerprint.",
    narrative:
      "Faisal Nawaz (AE) sent PKR 1,842,000 to five beneficiaries at three banks (MRGL, RAVI, INDS) within 41 hours. All five accounts link to one phone fingerprint; Bilal Ahmed (RAVI) and Hamza Khan (INDS) also share one device fingerprint. Typed beneficiary names differ across accounts. Neither fingerprint is in the registry yet.",
    narrative_ur: "فیصل نواز نے اکتالیس گھنٹوں میں تین بینکوں کے پانچ افراد کو رقم بھیجی۔ پانچوں اکاؤنٹ ایک ہی فون سے جڑے ہیں۔",
    evidence: [
      { claim: "Usman Ghani (MRGL) uses the shared phone", node_ids: ["R-MRGL-S5-1", "ph:" + FP.S5_PHONE] },
      { claim: "5 beneficiary accounts across MRGL, RAVI, INDS", node_ids: ["RM-S5", ...S5_RING] },
      { claim: "All 5 linked to one phone fingerprint", node_ids: ["fp:" + FP.S5_PHONE, ...S5_RING] },
      { claim: "RAVI ··0003 and INDS ··0005 share one device fingerprint", node_ids: ["fp:" + FP.S5_DEVICE, IBAN.S5_3, IBAN.S5_5] },
      { claim: "All 5 transfers within 41 hours (2026-11-06 09:12 to 11-08 02:40)", node_ids: ["RM-S5"] },
    ],
    risk: "high", recommended_action: "hold_and_publish",
    fingerprints_to_publish: [FP.S5_PHONE, FP.S5_DEVICE],
    confidence: 0.86,
    open_questions: ["Whether the RAVI and INDS holders are the same individual cannot be seen from the host bank."],
    integrity: { verified: 9, total: 9, epoch: EPOCH, block: 1041, root: ROOT, items: S5_ITEMS },
  },
};

const CYPHER_S5_1 = `MATCH (r:Remitter {rmid: $PERSON_1})-[:SENT]->(t:Transfer)-[:TO]->(a:Account)
RETURN a.iban AS iban, a.bank AS bank, count(t) AS n, min(t.ts) AS first, max(t.ts) AS last
LIMIT 200`;
const CYPHER_S5_2_BAD = `MATCH (a:Account) WHERE a.iban IN $ACCTS
OPTIONAL MATCH (a)<-[:HOLDS]-(rec:Record)-[:USES_PHONE]->(p:Phone)
WITH a, coalesce(p, f) AS fp_node
MATCH (fp_node)-[:SAME_AS]->(f:Fingerprint)
RETURN f.fp, count(DISTINCT a) AS accounts LIMIT 200`;
const CYPHER_S5_2_FIX = `MATCH (a:Account) WHERE a.iban IN $ACCTS
OPTIONAL MATCH (a)<-[:HOLDS]-(:Record)-[:USES_PHONE|USES_DEVICE]->(x)-[:SAME_AS]->(f1:Fingerprint)
OPTIONAL MATCH (a)-[:FP]->(f2:Fingerprint)
WITH a, collect(DISTINCT f1) + collect(DISTINCT f2) AS fps
UNWIND fps AS f
RETURN f.fp AS fp, f.kind AS kind, count(DISTINCT a) AS accounts
ORDER BY accounts DESC LIMIT 200`;
const CYPHER_S5_3 = `MATCH (:Remitter {rmid: $PERSON_1})-[:SENT]->(t:Transfer)
WITH t ORDER BY t.ts
WITH collect(t.ts) AS ts
RETURN ts[0] AS first, ts[-1] AS last, size(ts) AS n LIMIT 200`;

export function caseEvents(caseId: string): StepEvent[] {
  if (caseId === "CASE-S5") {
    const c = CASES[caseId];
    return [
      { step: "trigger", status: "info", data: { text: c.trigger }, ms: 200 },
      { step: "gateway", status: "ok", data: { text: "case features tokenized · 14 tokens substituted · 0 identifiers" }, ms: 120 },
      { step: "run_cypher", status: "running", data: { query: CYPHER_S5_1 } },
      { step: "run_cypher", status: "ok", data: { query: CYPHER_S5_1, rows: 5, summary: "5 accounts · 3 banks" }, ms: 640 },
      { step: "run_cypher", status: "running", data: { query: CYPHER_S5_2_BAD } },
      { step: "run_cypher", status: "error", data: { query: CYPHER_S5_2_BAD, error: "Variable `f` not defined (line 3, column 23 (offset: 132))" }, ms: 520 },
      { step: "run_cypher", status: "running", data: { query: CYPHER_S5_2_FIX, attempt: 2 } },
      { step: "run_cypher", status: "repaired", data: { query: CYPHER_S5_2_FIX, rows: 2, summary: "FP_1 phone → 5 accounts · FP_2 device → 2 accounts" }, ms: 810 },
      { step: "run_cypher", status: "running", data: { query: CYPHER_S5_3 } },
      { step: "run_cypher", status: "ok", data: { query: CYPHER_S5_3, rows: 1, summary: "5 transfers · span 41 h" }, ms: 430 },
      { step: "integrity", status: "ok", data: { verified: 9, total: 9, epoch: EPOCH, text: "9 of 9 evidence items verified against epoch 214" }, ms: 280 },
      { step: "get_registry_status", status: "ok", data: { fp: "FP_1", flagged: false, text: "FP_1, FP_2 not flagged" }, ms: 220 },
      { step: "propose_action", status: "ok", data: { action: "hold_and_publish" }, ms: 900 },
      { step: "final", status: "ok", data: c, ms: 120 },
    ];
  }
  const c = CASES[caseId];
  if (!c) return [];
  const isS2 = caseId === "CASE-S2";
  const q = `MATCH (r:Remitter {rmid: $PERSON_1})-[:SENT]->(t:Transfer)-[:TO]->(a:Account {iban: $ACCT_1})
RETURN count(t) AS n, min(t.ts) AS first, max(t.ts) AS last LIMIT 200`;
  return [
    { step: "trigger", status: "info", data: { text: c.trigger }, ms: 180 },
    { step: "gateway", status: "ok", data: { text: "case features tokenized · 6 tokens substituted · 0 identifiers" }, ms: 100 },
    { step: "run_cypher", status: "running", data: { query: q } },
    { step: "run_cypher", status: "ok", data: { query: q, rows: 1, summary: isS2 ? "7 transfers · 2026-06-04 to 2026-10-28" : "2 transfers" }, ms: 520 },
    { step: "integrity", status: "ok", data: { verified: c.integrity!.total, total: c.integrity!.total, epoch: EPOCH, text: `${c.integrity!.total} of ${c.integrity!.total} evidence items verified against epoch 214` }, ms: 220 },
    { step: "get_registry_status", status: "ok", data: { text: "FP_1 not flagged" }, ms: 200 },
    { step: "propose_action", status: "ok", data: { action: c.recommended_action }, ms: 700 },
    { step: "final", status: "ok", data: c, ms: 100 },
  ];
}

/** Re-run after tamper: the changed element is excluded from context. */
export function caseRerunEvents(caseId: string, excludedId: string): StepEvent[] {
  const base = CASES[caseId];
  if (!base) return [];
  const items = base.integrity!.items.map((it) => (it.id === excludedId ? { ...it, status: "changed" as const } : it));
  const ok = items.filter((i) => i.status === "verified").length;
  const c: CaseOutput = {
    ...base,
    narrative:
      base.narrative +
      " One fact was excluded because it changed after epoch 214; the remaining evidence still supports the recommendation.",
    evidence: base.evidence.filter((ev) => !ev.node_ids.includes(excludedId)),
    integrity: { ...base.integrity!, verified: ok, items },
  };
  return [
    { step: "integrity", status: "excluded", data: { verified: ok, total: items.length, epoch: EPOCH, text: `1 fact excluded: changed after epoch ${EPOCH}` }, ms: 320 },
    { step: "rerun", status: "info", data: { text: "agent re-running with verified context only" }, ms: 260 },
    { step: "propose_action", status: "ok", data: { action: c.recommended_action }, ms: 700 },
    { step: "final", status: "ok", data: c, ms: 80 },
  ];
}

export function caseForPayee(key: string): string | undefined {
  return PAYEE[key]?.case_id;
}

// ------------------------------------------------------------------ egress
export function egressFor(caseId: string): Omit<EgressItem, "sha256">[] {
  const ts = "2026-11-09T18:21:04Z";
  if (caseId === "CASE-S5") {
    return [
      {
        call: "plan · run_cypher #1", provider: "onshore", model: "llama-3.3-70b-versatile", tokens: 612, ts,
        payload: JSON.stringify({
          system: "CASE_AGENT v3 (schema §4.5 attached)",
          case: { trigger: "ring_alert", remitter: "PERSON_1", beneficiaries: ["ACCT_1", "ACCT_2", "ACCT_3", "ACCT_4", "ACCT_5"], banks: { MRGL: 2, RAVI: 2, INDS: 1 }, shared: [{ fp: "FP_1", kind: "phone", degree: 5 }, { fp: "FP_2", kind: "device", degree: 2 }] },
        }, null, 1),
      },
      {
        call: "repair · run_cypher #2", provider: "onshore", model: "llama-3.3-70b-versatile", tokens: 288, ts,
        payload: JSON.stringify({ error: "Variable `f` not defined (line 3, column 23 (offset: 132))", previous_query_hash: "sha256:5b0e…", instruction: "fix that specific error" }, null, 1),
      },
      {
        call: "write case", provider: "onshore", model: "llama-3.3-70b-versatile", tokens: 540, ts,
        payload: JSON.stringify({ results: [{ q: 1, rows: 5, banks: 3 }, { q: 2, fps: [{ fp: "FP_1", accounts: 5 }, { fp: "FP_2", accounts: 2 }] }, { q: 3, transfers: 5, span_hours: 41, total_pkr_bucket: "1.5M-2.0M" }], registry: { FP_1: false, FP_2: false }, verified: "9/9 epoch 214" }, null, 1),
      },
    ];
  }
  return [
    {
      call: "plan · run_cypher #1", provider: "onshore", model: "llama-3.3-70b-versatile", tokens: 402, ts,
      payload: JSON.stringify({ system: "CASE_AGENT v3", case: { trigger: "close_match", typed: "PERSON_1", title: "PERSON_1", remitter: "PERSON_2", account: "ACCT_1", reasons: caseId === "CASE-S2" ? ["INITIAL_EXPANDED", "VARIANT_SPELLING", "PATRONYMIC_DROPPED"] : ["SCRIPT_CONVERTED", "VARIANT_SPELLING", "TITLE_DROPPED"] } }, null, 1),
    },
    {
      call: "write case", provider: "onshore", model: "llama-3.3-70b-versatile", tokens: 310, ts,
      payload: JSON.stringify({ results: [{ q: 1, transfers: caseId === "CASE-S2" ? 7 : 2, span_months: 5, returned: 0 }], registry: { FP_1: false } }, null, 1),
    },
  ];
}

// ------------------------------------------------------------------ voice
export function voiceResult(i: number): VoiceResult {
  if (i === 0)
    return {
      transcript: "Faisal Nawaz ne pichle mahine kitne logon ko paise bheje?", language: "ur",
      cypher_attempts: [{ query: "MATCH (r:Remitter)-[:SENT]->(t:Transfer)-[:TO]->(a:Account) WHERE toLower(r.name) CONTAINS toLower($PERSON_1) AND t.ts >= '2026-10-01' AND t.ts < '2026-11-01' RETURN count(DISTINCT a) AS people, count(DISTINCT a.bank) AS banks, collect(DISTINCT a.iban) AS ibans LIMIT 200", status: "ok" }],
      rows: 1, answer: "پچھلے مہینے پانچ افراد، تین بینکوں میں۔", highlight_ids: ["RM-S5", ...S5_RING],
    };
  if (i === 1)
    return {
      transcript: "Show every account that shares a phone with Usman Ghani.", language: "en",
      cypher_attempts: [{ query: "MATCH (r:Record)-[:USES_PHONE]->(p:Phone) WHERE toLower(r.raw_name) CONTAINS toLower($PERSON_1) MATCH (p)-[:SAME_AS]->(f:Fingerprint) MATCH (a:Account) WHERE (a)<-[:HOLDS]-(:Record)-[:USES_PHONE]->(p) OR (a)-[:FP]->(f) RETURN DISTINCT a.iban, a.bank LIMIT 200", status: "ok" }],
      rows: 5, answer: "Five accounts share a phone with Usman Ghani: two at MRGL, two at RAVI and one at INDS.",
      highlight_ids: [...S5_RING, "ph:" + FP.S5_PHONE, "fp:" + FP.S5_PHONE, "R-MRGL-S5-1"],
    };
  return {
    transcript: "Which remitters sent to more than three banks this quarter?", language: "en",
    cypher_attempts: [
      { query: "MATCH (r:Remitter)-[:SENT]->(t:Transfer)-[:TO]->(a:Account)-[:AT]->(b:Bank) WHERE t.ts >= '2026-10-01' WITH r, count(DISTINCT b) AS banks WHERE banks >= 3 RETURN r.rmid, r.name, banks ORDER BY banks DESC LIMIT 200", status: "ok" },
    ],
    rows: 2, answer: "Two remitters: Faisal Nawaz and Asif Qureshi each sent to accounts at three banks this quarter.",
    highlight_ids: ["RM-S5", ...S5_RING, RING_C.remitter, ...RING_C.accounts, RING_C.device],
  };
}

// ------------------------------------------------------------------ ledger
export const SEED_BLOCKS: LedgerBlock[] = [
  { id: 1039, kind: "commit", hash: "0x41d8c09e7a3b2f15", tx: "0x7e1a…c403", epoch: 212, ts: "17:58", detail: { event: "GraphRootLog.Committed", nodes: 48211, edges: 131904 } },
  { id: 1040, kind: "commit", hash: "0x2bc7e5f0193ad846", tx: "0x93f0…1ad2", epoch: 213, ts: "18:05", detail: { event: "GraphRootLog.Committed", nodes: 48233, edges: 131977 } },
  { id: 1041, kind: "commit", hash: ROOT.slice(0, 18), tx: "0x0c5d…e871", epoch: 214, ts: "18:12", detail: { event: "GraphRootLog.Committed", root: ROOT, nodes: 48240, edges: 132006 } },
];
