// Plain-language copy for first-time visitors: what each case shows and
// what each step does. Used by the home page and the console demo bar.

export type StepKey = "payee" | "ring" | "case" | "approve" | "incoming" | "voice0" | "voice1" | "voice2";

export const STEP_LABEL: Record<StepKey, string> = {
  payee: "Check the payee",
  ring: "Scan the graph",
  case: "Open the case",
  approve: "Approve",
  incoming: "Partner bank check",
  voice0: "Ask in Urdu",
  voice1: "Ask about a phone",
  voice2: "Ask across banks",
};

export interface CaseGuide {
  kicker: string;
  lede: string;
  watch: string;
  outcome: "pass" | "review" | "stop" | "ask";
}

export const GUIDE: CaseGuide[] = [
  {
    kicker: "The everyday transfer",
    lede: "A sender in London pays Ayesha Siddiqui. The typed name matches the account title, so the payment goes through.",
    watch: "The match band and the token alignment under the transfer.",
    outcome: "pass",
  },
  {
    kicker: "Same person, different spelling",
    lede: "“Mohd Ali s/o Rehmat” vs. “Muhammad Ali”. A plain string compare would bounce it; Shanakht shows why it is close.",
    watch: "The case agent writes its own graph queries, then every cited fact is checked against a signed root.",
    outcome: "review",
  },
  {
    kicker: "Right account, wrong person",
    lede: "The account number is valid, but it belongs to someone else. Two digits were swapped.",
    watch: "The intended account appears beside the typed one.",
    outcome: "stop",
  },
  {
    kicker: "Urdu as the anchor",
    lede: "The sender typed “Imraan Akram”; the bank holds the name in Urdu. Shanakht matches through the script, not the spelling.",
    watch: "The Urdu title and the script-conversion reason.",
    outcome: "review",
  },
  {
    kicker: "A mule ring across banks",
    lede: "Five beneficiaries at three banks share one phone and one device. No single bank can see it; the shared graph can.",
    watch: "Fingerprints are published on-chain without exposing a raw phone number, and a partner bank catches the next attempt.",
    outcome: "stop",
  },
  {
    kicker: "Ask the graph out loud",
    lede: "Ask in Urdu or English. Speech becomes a graph query, and the answer comes back in the same language.",
    watch: "The transcript, the answer in the same language, and the graph query it ran.",
    outcome: "ask",
  },
];

export const OUTCOME_LABEL: Record<CaseGuide["outcome"], string> = {
  pass: "Passes",
  review: "Needs a look",
  stop: "Stopped",
  ask: "Voice",
};

/** Plain-language text for the name-check reason codes. */
export const REASON_TEXT: Record<string, string> = {
  INITIAL_EXPANDED: "Short form expanded",
  PATRONYMIC_DROPPED: "Father’s name (s/o) not on the account",
  VARIANT_SPELLING: "Spelling variant",
  TITLE_DROPPED: "Honorific removed",
  TITLE_ADDED: "Honorific on the account only",
  SURNAME_MISSING: "Surname missing",
  SCRIPT_CONVERTED: "Matched through the Urdu name",
  DIFFERENT_PERSON: "Different person",
  TOKEN_ORDER: "Names in a different order",
  NO_MATCH: "No match",
};

export function reasonText(code: string): string {
  if (REASON_TEXT[code]) return REASON_TEXT[code];
  const s = code.replaceAll("_", " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
