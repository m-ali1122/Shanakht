"use client";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { SCENARIOS } from "@/lib/scenarios";
import { GUIDE, STEP_LABEL, type StepKey } from "@/lib/guide";
import { useUI } from "./ui";

const KEYS: [string, string][] = [
  ["Space", "Next step"],
  ["1 – 6", "Jump to a case"],
  ["G  I V G A", "Go to Inbound, Investigate, Graph, Audit"],
  ["V", "Start or stop the mic"],
  ["Shift V", "Play the recorded voice clip"],
  ["T", "Tamper with evidence (open case)"],
  ["R", "Reset the demo"],
  ["O", "Offline indicator"],
  ["?", "This list"],
  ["Esc", "Close"],
];

function Help() {
  const setHelp = useUI((s) => s.setHelp);
  return (
    <div className="absolute bottom-[calc(100%+8px)] right-3 z-40 w-[340px] rounded-[var(--radius)] border border-rule bg-surface-2 p-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)] line-in" role="dialog" aria-label="Keyboard shortcuts">
      <div className="mb-2 flex items-center">
        <span className="text-[13px] font-semibold text-fg">Keyboard</span>
        <button onClick={() => setHelp(false)} className="ml-auto text-[12px] text-muted hover:text-fg">Close</button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-[13px]">
        {KEYS.map(([k, d]) => (
          <div key={k} className="contents">
            <dt><kbd className="key whitespace-nowrap">{k}</kbd></dt>
            <dd className="text-fg-2">{d}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Chord() {
  return (
    <span className="flex items-center gap-2 text-[13px] text-fg-2 line-in">
      <kbd className="key">G</kbd> go to
      {[["I", "Inbound"], ["V", "Investigate"], ["G", "Graph"], ["A", "Audit"]].map(([k, w]) => (
        <span key={k} className="flex items-center gap-1"><kbd className="key !bg-accent !text-accent-ink !border-accent">{k}</kbd>{w}</span>
      ))}
    </span>
  );
}

/** Thin bar under every workspace: which case, how far along, and the one thing to do next. */
export default function DemoBar() {
  const idx = useStore((s) => s.scenarioIdx);
  const ptr = useStore((s) => s.stepPtr);
  const busy = useStore((s) => s.busy);
  const caseOut = useStore((s) => s.caseOut);
  const next = useStore((s) => s.next);
  const setScenario = useStore((s) => s.setScenario);
  const help = useUI((s) => s.help);
  const setHelp = useUI((s) => s.setHelp);
  const chord = useUI((s) => s.chord);

  const sc = SCENARIOS[idx];
  const g = GUIDE[idx];
  const steps = sc.steps as StepKey[];
  const done = ptr >= steps.length;
  const upcoming = steps[ptr];
  const waiting = busy || (upcoming === "approve" && !caseOut);
  const last = idx === SCENARIOS.length - 1;

  return (
    <footer className="relative flex h-12 shrink-0 items-center gap-4 border-t border-rule bg-bg pl-4 pr-3">
      <div className="flex shrink-0 items-center gap-0.5" role="tablist" aria-label="Cases">
        {SCENARIOS.map((s, i) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={i === idx}
            onClick={() => setScenario(i)}
            title={`Case ${i + 1}: ${GUIDE[i].kicker} (${i + 1})`}
            className={`h-6 w-6 rounded-[4px] text-[12px] font-medium tabular-nums transition-colors duration-150 ${
              i === idx ? "bg-surface-2 text-fg ring-1 ring-rule" : "text-muted hover:text-fg-2"
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        {chord ? (
          <Chord />
        ) : (
          <>
            <span className="shrink-0 text-[12px] tabular-nums text-muted">Case {idx + 1} of {SCENARIOS.length}</span>
            <span className="shrink-0 text-[14px] font-semibold text-fg">{g.kicker}</span>
            <span className="truncate text-[13px] text-fg-2" title={g.lede}>{g.lede}</span>
          </>
        )}
      </div>

      <ol className="flex shrink-0 items-center gap-1.5" aria-label="Steps in this case">
        {steps.map((s, i) => {
          const state = i < ptr ? "done" : i === ptr ? "now" : "later";
          return (
            <li key={s} title={`${i + 1}. ${STEP_LABEL[s]}${state === "done" ? " (done)" : ""}`} aria-current={state === "now" ? "step" : undefined}>
              <span
                className={`block h-2 rounded-full transition-all duration-200 ${
                  state === "done" ? "w-2 bg-match" : state === "now" ? "w-5 bg-accent" : "w-2 bg-rule"
                }`}
              />
            </li>
          );
        })}
      </ol>

      <div className="flex shrink-0 items-center gap-2">
        {!done ? (
          <button
            onClick={() => next()}
            disabled={waiting}
            className="flex h-8 items-center gap-2 rounded-[var(--radius-sm)] bg-main pl-3 pr-1.5 text-[13px] font-semibold text-white transition-opacity duration-150 hover:brightness-110 disabled:cursor-progress disabled:opacity-60"
          >
            {waiting && <Loader2 size={14} className="animate-spin" />}
            {waiting ? "Working…" : STEP_LABEL[upcoming]}
            <kbd className="rounded-[4px] bg-white/20 px-1.5 font-mono text-[11px] font-normal leading-[18px] text-white/90">Space</kbd>
          </button>
        ) : last ? (
          <Link href="/" className="flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-rule px-3 text-[13px] font-medium text-fg hover:border-main">
            All cases <ArrowRight size={14} />
          </Link>
        ) : (
          <button
            onClick={() => setScenario(idx + 1)}
            className="flex h-8 items-center gap-2 rounded-[var(--radius-sm)] bg-main px-3 text-[13px] font-semibold text-white hover:brightness-110"
            title={`Case ${idx + 2}: ${GUIDE[idx + 1].kicker}`}
          >
            Next case <ArrowRight size={14} />
          </button>
        )}
        <button
          onClick={() => setHelp(!help)}
          aria-expanded={help}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] font-mono text-[13px] text-fg-2 hover:bg-surface-2 ${help ? "bg-surface-2 text-fg" : ""}`}
        >
          ?
        </button>
      </div>
      {help && <Help />}
    </footer>
  );
}
