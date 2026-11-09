"use client";
import { useStore } from "@/lib/store";
import { SCENARIOS } from "@/lib/scenarios";
import MicButton from "./MicButton";

const CHIPS: { code: string; color: string }[] = [
  { code: "MRGL", color: "var(--bank-mrgl)" },
  { code: "RAVI", color: "var(--bank-ravi)" },
  { code: "CHNB", color: "var(--bank-chnb)" },
  { code: "INDS", color: "var(--bank-inds)" },
  { code: "Registry", color: "var(--ink-2)" },
];

export function ScenarioStepper() {
  const idx = useStore((s) => s.scenarioIdx);
  const setScenario = useStore((s) => s.setScenario);
  return (
    <div className="flex items-center gap-1.5" role="tablist" aria-label="Scenarios">
      {SCENARIOS.map((sc, i) => (
        <button
          key={sc.key}
          role="tab"
          aria-selected={i === idx}
          title={`${sc.key}: ${sc.title}`}
          onClick={() => setScenario(i)}
          className={`h-6 w-6 rounded-full border text-[12px] leading-none transition-colors duration-150 ${
            i === idx ? "border-accent bg-accent text-surface" : "border-rule text-ink-2 hover:border-muted"
          }`}
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}

export function BankChips() {
  const flash = useStore((s) => s.flash);
  const hit = useStore((s) => s.registryHit);
  return (
    <div className="flex items-center gap-1.5">
      {CHIPS.map((c) => {
        const f = flash[c.code];
        const showHit = hit && (c.code === hit.bank);
        return (
          <span
            key={c.code + (f ?? "")}
            className={`flex h-6 items-center gap-1.5 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink-2 ${f ? "chip-flash" : ""}`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
            <span className="font-medium">{c.code}</span>
            {showHit && <span className="mono text-[11px] uppercase tracking-[0.06em] text-nomatch">registry hit</span>}
          </span>
        );
      })}
    </div>
  );
}

export default function TopBar() {
  const idx = useStore((s) => s.scenarioIdx);
  const counter = useStore((s) => s.counter);
  const offlineDot = useStore((s) => s.offlineDot);
  const sc = SCENARIOS[idx];
  return (
    <header className="flex h-14 shrink-0 items-center gap-5 border-b border-rule bg-surface px-4">
      <div className="flex items-baseline gap-2.5">
        <span className="font-serif text-[22px] font-medium tracking-[-0.01em] text-ink">Shanakht</span>
        <span className="urdu text-[17px] text-ink-2" style={{ lineHeight: 2 }}>شناخت</span>
      </div>
      <div className="h-6 w-px bg-rule" />
      <ScenarioStepper />
      <div className="min-w-[150px] flex-1 truncate">
        <span className="label mr-2">{sc.key}</span>
        <span className="font-serif text-[16px] text-ink">{sc.title}</span>
      </div>
      <span className="mono hidden min-w-0 truncate text-[11px] text-muted xl:inline" title="Pseudonymization gateway counter">
        Identifiers sent to model: {counter.identifiers} · tokens substituted: {counter.tokens}
      </span>
      <BankChips />
      {offlineDot && <span className="h-1.5 w-1.5 rounded-full bg-close" title="offline mode" />}
      <MicButton />
    </header>
  );
}
