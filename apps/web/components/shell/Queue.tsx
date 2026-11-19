"use client";
import { useStore } from "@/lib/store";
import { SCENARIOS } from "@/lib/scenarios";
import { BankDot, OutcomeGlyph, outcomeWord } from "./bits";
import { useUI, liveOutcome, type Outcome } from "./ui";

/** The six demo transfers as they arrive at the Margalla desk. Selecting one = pressing its number. */
export default function Queue() {
  const idx = useStore((s) => s.scenarioIdx);
  const setScenario = useStore((s) => s.setScenario);
  const live = useStore(liveOutcome);
  const outcomes = useUI((s) => s.outcomes);
  return (
    <section className="flex min-h-0 flex-col border-r border-rule" aria-label="Inbound queue">
      <div className="flex h-10 shrink-0 items-center px-4">
        <span className="text-[13px] font-semibold text-fg">Queue</span>
        <span className="ml-2 text-[12px] tabular-nums text-muted">{SCENARIOS.length} transfers</span>
      </div>
      <ol className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {SCENARIOS.map((sc, i) => {
          const t = sc.transfer;
          const on = i === idx;
          const stored = outcomes[sc.key];
          const o: Outcome = sc.key === "S6" ? "ask" : on ? live ?? "pending" : stored && stored !== "checking" ? stored : "pending";
          const voice = sc.key === "S6";
          return (
            <li key={sc.key}>
              <button
                onClick={() => setScenario(i)}
                aria-current={on ? "true" : undefined}
                title={`${outcomeWord(o)} (press ${i + 1})`}
                className={`group relative grid w-full grid-cols-[20px_1fr_auto] gap-x-2.5 rounded-[var(--radius-sm)] px-2.5 py-2.5 text-left transition-colors duration-150 ${
                  on ? "bg-surface-2" : "hover:bg-surface"
                }`}
              >
                {on && <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r bg-main" />}
                <span className="pt-[2px]"><OutcomeGlyph o={o} /></span>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-[14px] font-medium text-fg">{voice ? "Ask the graph" : t.typed_name}</span>
                    {!voice && (
                      <span className="ml-auto shrink-0 text-[12px] tabular-nums text-fg-2">
                        {t.currency} {t.amount_fx.toLocaleString("en-US")}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
                    {voice ? (
                      <>Voice query · Urdu or English</>
                    ) : (
                      <>
                        <span className="truncate">from {t.sender} · {t.country}</span>
                        <span className="ml-auto flex shrink-0 items-center gap-1"><BankDot code={t.bank} size={6} /><span className="text-fg-2">{t.bank}</span></span>
                      </>
                    )}
                  </span>
                </span>
                <span className="pt-[1px]">
                  <kbd className={`key ${on ? "" : "opacity-60 group-hover:opacity-100"}`}>{i + 1}</kbd>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
