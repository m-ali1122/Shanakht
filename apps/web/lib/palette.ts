// 3D palette: plain hex mirroring styles/tokens.css, so three.js materials can use it.
// The console is dark; these values are tuned for a near-black stage.

export const MAIN = "#3452FF";
export const MAIN_BRIGHT = "#6E84FF"; // cobalt lifted for lines/text on dark
export const ACCENT = "#B8F04A"; // lime: focus halo, the one thing to look at
export const MATCH = "#0EA371";
export const CLOSE = "#F59E0B";
export const NOMATCH = "#E5484D";

export const STAGE = "#0A0C14";
export const FG = "#EEF0F6";
export const FG2 = "#B4B9CF";
export const MUTED = "#8A90AA";
export const DIM = "#2A2F44";

export const BANK: Record<string, string> = {
  MRGL: "#3452FF",
  RAVI: "#8B5CF6",
  CHNB: "#0EA5B7",
  INDS: "#D97706",
};
export const BANK_NAME: Record<string, string> = {
  MRGL: "Margalla (host)",
  RAVI: "Ravi Bank",
  CHNB: "Chenab Bank",
  INDS: "Indus Bank",
};
export const NO_BANK = "#5C627C";

export type Kind = "remitter" | "account" | "record" | "person" | "phone" | "device" | "fingerprint" | "decision";
export const KINDS: Kind[] = ["remitter", "account", "record", "person", "phone", "device", "fingerprint", "decision"];

export const KIND_COLOR: Record<Kind, string> = {
  remitter: "#6E84FF",
  account: "#38BDF8",
  record: "#C9CEDF",
  person: "#F2F4FA",
  phone: "#F0A35E",
  device: "#E879A8",
  fingerprint: "#2DD4BF",
  decision: "#B8F04A",
};
export const KIND_LABEL: Record<Kind, string> = {
  remitter: "Sender",
  account: "Account",
  record: "KYC record",
  person: "Person",
  phone: "Phone",
  device: "Device",
  fingerprint: "Partner fingerprint",
  decision: "Decision",
};

export const REL_COLOR: Record<string, string> = {
  SENT: "#7C8CFF",
  HOLDS: "#5E6788",
  RESOLVES_TO: "#A9B0CC",
  USES_PHONE: "#F0A35E",
  USES_DEVICE: "#E879A8",
  HAS_FP: "#2DD4BF",
  SAME_AS: "#FACC15",
};
export const REL_LABEL: Record<string, string> = {
  SENT: "Sent money",
  HOLDS: "Holds account",
  RESOLVES_TO: "Same person",
  USES_PHONE: "Uses phone",
  USES_DEVICE: "Uses device",
  HAS_FP: "Partner fingerprint",
  SAME_AS: "Fingerprint match",
};
export const REL_DEFAULT = "#4A5170";
export const relColor = (rel: string) => REL_COLOR[rel] ?? REL_DEFAULT;
export const relLabel = (rel: string) =>
  REL_LABEL[rel] ?? rel.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export const SCENARIO_COLOR: Record<string, string> = {
  S1: "#0EA371",
  S2: "#F59E0B",
  S3: "#E5484D",
  S4: "#0EA5B7",
  S5: "#F43F5E",
  S6: "#8B5CF6",
};
export const SCENARIO_NONE = "#3A405A";

export const bankColor = (b?: string | null) => (b && BANK[b]) || NO_BANK;
