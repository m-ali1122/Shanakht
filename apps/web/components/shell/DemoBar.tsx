"use client";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { SCENARIOS } from "@/lib/scenarios";
import { GUIDE, STEP_LABEL, type StepKey } from "@/lib/guide";
import { useUI } from "./ui";
import { Drawer } from "./Drawer";
import { TABS } from "./TopBar";
import { VIEW_LABEL } from "@/lib/store";

const KEYS: [string, string][] = [
  ["Space", "Next step"],
  ["1 – 6", "Jump to a case"],
  ["G then C", "Check tab"],
  ["G then I", "Investigate tab (G V also works)"],
  ["G then G", "Graph tab"],
  ["G then L", "Ledger tab (G A also works)"],
  ["V", "Start or stop the mic"],
  ["Shift V", "Play the recorded voice clip"],
  ["T", "Tamper with evidence (open case)"],
  ["R", "Reset the demo"],
  ["O", "Offline indicator"],
  ["?", "This list"],
  ["Esc", "Close a drawer or this list"],
];

function Help() {
  const help = useUI((s) => s.help);
  const setHelp = useUI((s) => s.setHelp);
  return (
    <Drawer open={help} onClose={() => setHelp(false)} title="Keyboard" width={360}>
      <dl className="text-[13px]">
        {KEYS.map(([k, d]) => (
          <div key={k} className="grid grid-cols-[96px_1fr] items-center gap-3 border-b border-rule py-2 last:border-b-0">
            <dt><kbd className="key whitespace-nowrap">{k}</kbd></dt>
            <dd className="text-fg-2">{d}</dd>
          </div>
        ))}
      </dl>
    </Drawer>
  );
}

function Chord() {
  return (
    <span className="flex items-center gap-3 text-[13px] text-fg-2 line-in">
      <span><kbd className="key">G</kbd> go to</span>
      {TABS.map(({ view, key }) => (
        <span key={key} className="flex items-center gap-1"><kbd className="key !border-accent !bg-accent !text-accent-ink">{key}</kbd>{VIEW_LABEL[view]}</span>
      ))}
    </span>
  );
}

/** Flat bar under every tab: which case, how far along, and the one thing to do next. */
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
    <footer className="flex h-12 shrink-0 items-center gap-5 border-t border-rule bg-bg pl-6 pr-4">
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        {chord ? (
          <Chord />
        ) : (
          <>
            <span className="shrink-0 text-[12px] tabular-nums text-muted">Case {idx + 1} of {SCENARIOS.length}</span>
            <span className="shrink-0 text-[14px] font-semibold text-fg">{g.kicker}</span>
            <span className="truncate text-[13px] text-muted" title={g.lede}>{g.lede}</span>
          </>
        )}
      </div>

      <ol className="flex shrink-0 items-center gap-1.5" aria-label="Steps in this case">
        {steps.map((s, i) => {
          const state = i < ptr ? "done" : i === ptr ? "now" : "later";
          return (
            <li key={s} title={`${i + 1}. ${STEP_LABEL[s]}${state === "done" ? " (done)" : ""}`} aria-current={state === "now" ? "step" : undefined}>
              <span className={`block h-1.5 rounded-full transition-all duration-200 ${state === "done" ? "w-1.5 bg-main" : state === "now" ? "w-5 bg-accent" : "w-1.5 bg-rule"}`} />
            </li>
          );
        })}
      </ol>

      <div className="flex shrink-0 items-center gap-1">
        {!done ? (
          <button
            onClick={() => next()}
            disabled={waiting}
            className="flex h-8 items-center gap-2 rounded-[4px] bg-main pl-3 pr-1.5 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-main-ink disabled:cursor-progress disabled:opacity-60"
          >
            {waiting && <Loader2 size={14} className="animate-spin" />}
            {waiting ? "Working…" : STEP_LABEL[upcoming]}
            <kbd className="rounded-[3px] bg-white/20 px-1.5 font-mono text-[11px] font-normal leading-[18px] text-white">Space</kbd>
          </button>
        ) : last ? (
          <Link href="/" className="flex h-8 items-center gap-2 rounded-[4px] px-3 text-[13px] font-medium text-main-ink hover:bg-main-soft">
            All cases <ArrowRight size={14} />
          </Link>
        ) : (
          <button
            onClick={() => setScenario(idx + 1)}
            className="flex h-8 items-center gap-2 rounded-[4px] bg-main px-3 text-[13px] font-semibold text-white hover:bg-main-ink"
            title={`Case ${idx + 2}: ${GUIDE[idx + 1].kicker} (${idx + 2})`}
          >
            Next case <ArrowRight size={14} />
          </button>
        )}
        <button
          onClick={() => setHelp(!help)}
          aria-expanded={help}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          className={`ml-1 flex h-8 w-8 items-center justify-center rounded-[4px] font-mono text-[13px] text-fg-2 hover:bg-surface-2 ${help ? "bg-surface-2 text-fg" : ""}`}
        >
          ?
        </button>
      </div>
      <Help />
    </footer>
  );
}
