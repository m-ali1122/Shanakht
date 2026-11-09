import type { Scenario } from "./types";

// Fixture IDs mirror docs/CONTRACTS.md. demo/scenarios.json is the canonical
// copy for services; this is the UI's copy (kept in sync by hand).

export const IBAN = {
  S1: "PK36MRGL0000000000010001",
  S2: "PK36RAVI0000000000020001",
  S3_TYPED: "PK36MRGL0000000000030021",
  S3_INTENDED: "PK36MRGL0000000000030012",
  S4: "PK36CHNB0000000000040001",
  S5_1: "PK36MRGL0000000000050001",
  S5_2: "PK36MRGL0000000000050002",
  S5_3: "PK36RAVI0000000000050003",
  S5_4: "PK36RAVI0000000000050004",
  S5_5: "PK36INDS0000000000050005",
  S5_6: "PK36INDS0000000000050006",
} as const;

export const S5_RING = [IBAN.S5_1, IBAN.S5_2, IBAN.S5_3, IBAN.S5_4, IBAN.S5_5];

// Display fingerprints (first 16 hex) used by mock mode.
export const FP = {
  S5_PHONE: "a41c9e07b2d35f18",
  S5_DEVICE: "7be14c02d9a6e35f",
  S2_PHONE: "3d0f62a9c18e47b5",
  S4_PHONE: "c92e1b7f04a6d853",
  RB_PHONE: "e57a03c9b1d24f60",
} as const;

export const VOICE_QUERIES = [
  { lang: "ur" as const, text: "Faisal Nawaz ne pichle mahine kitne logon ko paise bheje?" },
  { lang: "en" as const, text: "Show every account that shares a phone with Usman Ghani." },
  { lang: "en" as const, text: "Which remitters sent to more than three banks this quarter?" },
];

const S5_FOCUS = ["RM-S5", ...S5_RING, "ph:" + FP.S5_PHONE, "fp:" + FP.S5_PHONE, "fp:" + FP.S5_DEVICE, "R-MRGL-S5-1", "R-MRGL-S5-2"];

export const SCENARIOS: Scenario[] = [
  {
    id: 1, key: "S1", title: "Clean match",
    transfer: { exchange_house: "THMS", exchange_name: "Thames Remit", country: "UK", remitter_id: "RM-S1", sender: "Kamran Butt", typed_name: "Ayesha Siddiqui", iban: IBAN.S1, bank: "MRGL", amount_pkr: 92750, amount_fx: 250, currency: "GBP" },
    steps: ["payee"],
    focus: ["RM-S1", IBAN.S1, "R-MRGL-S1", "P-S1"],
  },
  {
    id: 2, key: "S2", title: "Close match",
    transfer: { exchange_house: "GULF", exchange_name: "Gulf Bridge Exchange", country: "AE", remitter_id: "RM-S2", sender: "Rehmat Ali", typed_name: "Mohd Ali s/o Rehmat", iban: IBAN.S2, bank: "RAVI", amount_pkr: 113700, amount_fx: 1500, currency: "AED" },
    steps: ["payee", "case", "approve"],
    focus: ["RM-S2", IBAN.S2, "fp:" + FP.S2_PHONE],
  },
  {
    id: 3, key: "S3", title: "Valid account number, wrong person",
    transfer: { exchange_house: "NAJD", exchange_name: "Najd Transfer", country: "SA", remitter_id: "RM-S3", sender: "Abdul Rehman Qureshi", typed_name: "Zainab Bibi", iban: IBAN.S3_TYPED, bank: "MRGL", amount_pkr: 148600, amount_fx: 2000, currency: "SAR" },
    steps: ["payee"],
    focus: ["RM-S3", IBAN.S3_TYPED, IBAN.S3_INTENDED, "R-MRGL-S3-T", "R-MRGL-S3-Z"],
  },
  {
    id: 4, key: "S4", title: "Urdu as the anchor",
    transfer: { exchange_house: "HUDS", exchange_name: "Hudson Remit", country: "US", remitter_id: "RM-S4", sender: "Shahid Awan", typed_name: "Imraan Akram", iban: IBAN.S4, bank: "CHNB", amount_pkr: 111600, amount_fx: 400, currency: "USD" },
    steps: ["payee"],
    focus: ["RM-S4", IBAN.S4, "fp:" + FP.S4_PHONE],
  },
  {
    id: 5, key: "S5", title: "Mule ring across banks",
    transfer: { exchange_house: "GULF", exchange_name: "Gulf Bridge Exchange", country: "AE", remitter_id: "RM-S5", sender: "Faisal Nawaz", typed_name: "Usman Ghani", iban: IBAN.S5_1, bank: "MRGL", amount_pkr: 379000, amount_fx: 5000, currency: "AED" },
    steps: ["ring", "case", "approve", "incoming"],
    focus: S5_FOCUS,
  },
  {
    id: 6, key: "S6", title: "Ask the graph",
    transfer: { exchange_house: "GULF", exchange_name: "Gulf Bridge Exchange", country: "AE", remitter_id: "RM-S5", sender: "Faisal Nawaz", typed_name: "Usman Ghani", iban: IBAN.S5_1, bank: "MRGL", amount_pkr: 379000, amount_fx: 5000, currency: "AED" },
    steps: ["voice0", "voice1", "voice2"],
    focus: [...S5_FOCUS, "RM-RB", "RM-RC"],
  },
];
