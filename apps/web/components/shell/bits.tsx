"use client";
import { CircleCheck, CircleDashed, CirclePause, Loader2, Mic, OctagonX } from "lucide-react";
import type { Outcome } from "./ui";

export const BANK_COLOR: Record<string, string> = { MRGL: "var(--bank-mrgl)", RAVI: "var(--bank-ravi)", CHNB: "var(--bank-chnb)", INDS: "var(--bank-inds)" };
export const BANK_NAME: Record<string, string> = { MRGL: "Margalla", RAVI: "Ravi Commercial", CHNB: "Chenab", INDS: "Indus Microfinance" };
export const BAND_FILL: Record<string, string> = { MATCH: "var(--match)", CLOSE: "var(--close)", NO_MATCH: "var(--nomatch)", RING: "var(--nomatch)" };
export const BAND_INK: Record<string, string> = { MATCH: "var(--match-ink)", CLOSE: "var(--close-ink)", NO_MATCH: "var(--nomatch-ink)", RING: "var(--nomatch-ink)" };
export const BAND_WORD: Record<string, string> = { MATCH: "Match", CLOSE: "Close match", NO_MATCH: "No match", RING: "Ring alert" };

export const tint = (c: string, pct = 10) => `color-mix(in srgb, ${c} ${pct}%, var(--surface))`;

/** "PK36RAVI0000000000020001" -> "RAVI ··0001" */
export function shortIban(iban: string) {
  return `${iban.slice(4, 8)} ··${iban.slice(-4)}`;
}

export function BankDot({ code, size = 8 }: { code: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: BANK_COLOR[code] ?? "var(--muted)" }} />;
}

export function BankTag({ code }: { code: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-fg-2" title={BANK_NAME[code]}>
      <BankDot code={code} size={7} />
      {code}
    </span>
  );
}

const GLYPH: Record<Outcome, { Icon: typeof CircleCheck; color: string; word: string }> = {
  pending: { Icon: CircleDashed, color: "var(--muted)", word: "Not checked" },
  checking: { Icon: Loader2, color: "var(--main-ink)", word: "Checking" },
  pass: { Icon: CircleCheck, color: "var(--match-ink)", word: "Passed" },
  review: { Icon: CirclePause, color: "var(--close-ink)", word: "Held for review" },
  stop: { Icon: OctagonX, color: "var(--nomatch-ink)", word: "Stopped" },
  ask: { Icon: Mic, color: "var(--main-ink)", word: "Voice query" },
};

export function OutcomeGlyph({ o, size = 16 }: { o: Outcome; size?: number }) {
  const g = GLYPH[o];
  return <g.Icon size={size} strokeWidth={2} className={`shrink-0 ${o === "checking" ? "animate-spin" : ""}`} style={{ color: g.color }} aria-label={g.word} />;
}
export const outcomeWord = (o: Outcome) => GLYPH[o].word;
