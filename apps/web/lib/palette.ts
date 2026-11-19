// Canvas palette: plain hex mirroring styles/tokens.css (console v3, light), so the 2D graph
// canvas can draw with it. Tuned for a white stage: every mark is readable on #FFFFFF.

export const MAIN = "#3452FF";
export const MAIN_INK = "#2A41D6";
export const MAIN_BRIGHT = MAIN; // kept for older imports
export const MAIN_SOFT = "#EEF1FF";
export const ACCENT = "#B8F04A"; // lime: focus halo fill only, never text
export const ACCENT_EDGE = "#7FB71A"; // lime darkened for a visible ring stroke on white
export const MATCH = "#087A54";
export const CLOSE = "#9A5B00";
export const NOMATCH = "#C22E33";

export const STAGE = "#FFFFFF";
export const FG = "#0B0E1A";
export const FG2 = "#3A4058";
export const MUTED = "#6B7190";
export const RULE = "#E6E8EE";
export const SURFACE_2 = "#F5F6F8";
export const DIM = "#D9DCE4"; // faded node fill
export const LINK = "#CDD1DB"; // resting link
export const LINK_DIM = "#ECEEF2";

export const BANK: Record<string, string> = {
  MRGL: "#3452FF",
  RAVI: "#7C4DDB",
  CHNB: "#0B8FA3",
  INDS: "#C26A05",
};
export const BANK_NAME: Record<string, string> = {
  MRGL: "Margalla (host)",
  RAVI: "Ravi Bank",
  CHNB: "Chenab Bank",
  INDS: "Indus Bank",
};
export const NO_BANK = "#8A90A6";

export type Kind = "remitter" | "account" | "record" | "person" | "phone" | "device" | "fingerprint" | "decision";
export const KINDS: Kind[] = ["remitter", "account", "record", "person", "phone", "device", "fingerprint", "decision"];

export const KIND_COLOR: Record<Kind, string> = {
  remitter: "#3452FF",
  account: "#0B8FA3",
  record: "#9AA0B4",
  person: "#0B0E1A",
  phone: "#D97706",
  device: "#C2417A",
  fingerprint: "#0E9F8E",
  decision: "#6B7190",
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
  SENT: "#3452FF",
  HOLDS: "#8A90A6",
  RESOLVES_TO: "#5B6180",
  USES_PHONE: "#D97706",
  USES_DEVICE: "#C2417A",
  HAS_FP: "#0E9F8E",
  SAME_AS: "#B58900",
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
export const REL_DEFAULT = "#8A90A6";
export const relColor = (rel: string) => REL_COLOR[rel] ?? REL_DEFAULT;
export const relLabel = (rel: string) =>
  REL_LABEL[rel] ?? rel.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export const SCENARIO_COLOR: Record<string, string> = {
  S1: "#087A54",
  S2: "#9A5B00",
  S3: "#C22E33",
  S4: "#0B8FA3",
  S5: "#D6336C",
  S6: "#7C4DDB",
};
export const SCENARIO_NONE = "#C3C7D2";

export const bankColor = (b?: string | null) => (b && BANK[b]) || NO_BANK;

/** "#RRGGBB" + alpha -> rgba() */
export function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
