export type Band = "MATCH" | "CLOSE" | "NO_MATCH";
export type BankCode = "MRGL" | "RAVI" | "CHNB" | "INDS";
export type Action = "auto_pass" | "proceed" | "hold" | "hold_and_publish";

/** SSE event shape (docs/CONTRACTS.md): data: {"step","status","data","ms"} */
export interface StepEvent {
  step: string;
  status: "running" | "ok" | "error" | "repaired" | "blocked" | "excluded" | "info";
  data?: any;
  ms?: number;
}

export interface AlignmentItem {
  typed_token: string | null;
  title_token: string | null;
  relation: "exact" | "variant" | "initial" | "transliterated" | "dropped" | "extra";
  reason?: string;
}

export interface PayeeResult {
  band: Band;
  score: number;
  reasons: string[];
  alignment: AlignmentItem[];
  title: string;
  bank: BankCode;
  urdu_name?: string;
  banner?: string;
  explain?: { en: string; ur: string };
  case_id?: string;
}

export interface EvidenceItem {
  claim: string;
  node_ids: string[];
}

export interface IntegrityItem {
  id: string;
  label: string;
  leaf: string;
  status: "verified" | "changed" | "missing";
}

export interface Integrity {
  verified: number;
  total: number;
  epoch: number;
  block: number;
  root: string;
  items: IntegrityItem[];
}

export interface CaseOutput {
  id: string;
  trigger: string;
  narrative: string;
  narrative_ur?: string;
  evidence: EvidenceItem[];
  risk: "low" | "medium" | "high";
  recommended_action: "proceed" | "hold" | "hold_and_publish";
  fingerprints_to_publish?: string[];
  confidence: number;
  open_questions?: string[];
  integrity?: Integrity;
}

export interface EgressItem {
  call: string;
  provider: string;
  model: string;
  payload: string;
  sha256: string;
  tokens: number;
  ts: string;
}

export interface LedgerBlock {
  id: number;
  kind: "decision" | "publish" | "registry_hit" | "commit" | "auto";
  hash: string;
  tx: string;
  band?: Band | "RING";
  action?: Action | string;
  approver?: string;
  bank?: BankCode;
  fp?: string;
  fpKind?: "phone" | "device" | "cnic";
  epoch?: number;
  ts: string;
  detail?: Record<string, any>;
}

export type NodeKind = "person" | "record" | "account" | "remitter" | "phone" | "device" | "fingerprint" | "exchange";

export interface GraphNode {
  data: { id: string; kind: NodeKind; label: string; bank?: BankCode; hollow?: boolean; fpKind?: string };
}
export interface GraphEdge {
  data: { id: string; source: string; target: string; label?: string; rel?: string };
}
export interface GraphElements {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface VoiceResult {
  transcript: string;
  language: "ur" | "en";
  cypher_attempts: { query: string; status: "ok" | "error" | "repaired"; error?: string }[];
  rows: number;
  answer: string;
  highlight_ids: string[];
}

export interface TransferInfo {
  exchange_house: string;
  exchange_name: string;
  country: string;
  remitter_id: string;
  sender: string;
  typed_name: string;
  iban: string;
  bank: BankCode;
  amount_pkr: number;
  amount_fx: number;
  currency: string;
}

export interface Scenario {
  id: number;
  key: string;
  title: string;
  transfer: TransferInfo;
  /** Ordered actions that Space advances through */
  steps: ("payee" | "case" | "approve" | "ring" | "incoming" | "voice0" | "voice1" | "voice2")[];
  focus: string[];
}
