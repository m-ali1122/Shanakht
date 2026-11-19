"use client";
import { ShieldCheck, WifiOff } from "lucide-react";
import { useStore } from "@/lib/store";
import { SCENARIOS } from "@/lib/scenarios";
import { BankDot, BANK_NAME } from "./bits";
import { MicButton, MicLevel } from "./mic";

const BANKS = ["MRGL", "RAVI", "CHNB", "INDS"] as const;

/** What the workspace is looking at, in one line. */
function Context() {
  const view = useStore((s) => s.view);
  const idx = useStore((s) => s.scenarioIdx);
  const caseId = useStore((s) => s.caseId);
  const blocks = useStore((s) => s.blocks.length);
  const sc = SCENARIOS[idx];
  const t = sc.transfer;
  const word = { inbound: "Inbound", investigate: "Investigate", graph: "Graph", audit: "Audit" }[view];
  let ctx: React.ReactNode = null;
  if (view === "inbound") ctx = <>Margalla Bank desk · remittances arriving from exchange houses</>;
  if (view === "investigate") ctx = caseId ? <><span className="font-mono text-[12px] text-fg-2">{caseId}</span> · {t.sender} to {t.typed_name}</> : <>No case open for case {idx + 1}</>;
  if (view === "graph") ctx = <>Cross-bank identity graph · partner banks contribute fingerprints only</>;
  if (view === "audit") ctx = <>Local chain · {blocks} block{blocks === 1 ? "" : "s"} · Merkle roots, decisions and registry entries</>;
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <h1 className="shrink-0 text-[14px] font-semibold text-fg">{word}</h1>
      <span className="truncate text-[13px] text-muted">{ctx}</span>
    </div>
  );
}

function Privacy() {
  const c = useStore((s) => s.counter);
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 text-[12px] text-fg-2"
      title="Pseudonymization gateway: raw identifiers sent to the model vs. identifiers replaced by tokens"
    >
      <ShieldCheck size={14} className={c.identifiers === 0 ? "text-match-ink" : "text-nomatch-ink"} />
      <span className={`font-medium tabular-nums ${c.identifiers === 0 ? "text-match-ink" : "text-nomatch-ink"}`}>{c.identifiers}</span> raw IDs to model
      <span className="text-muted">·</span>
      <span className="font-medium tabular-nums text-fg">{c.tokens}</span> masked
    </span>
  );
}

function Banks() {
  const flash = useStore((s) => s.flash);
  const hit = useStore((s) => s.registryHit);
  return (
    <div className="flex shrink-0 items-center gap-1" aria-label="Consortium members">
      {BANKS.map((b) => {
        const isHit = hit?.bank === b;
        return (
          <span
            key={b + (flash[b] ?? "")}
            title={`${BANK_NAME[b]}${b === "MRGL" ? " (this desk)" : ""}${isHit ? ": registry hit" : ""}`}
            className={`flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium ${
              isHit ? "border-nomatch/70 text-nomatch-ink" : "border-transparent text-fg-2"
            } ${flash[b] ? "chip-flash" : ""}`}
          >
            <BankDot code={b} size={7} />
            {b}
            {isHit && <span className="font-semibold">hit</span>}
          </span>
        );
      })}
      <span
        key={"reg" + (flash.Registry ?? "")}
        title="Shared mule registry (on-chain)"
        className={`flex h-6 items-center gap-1.5 rounded-full border border-rule px-2 text-[11px] font-medium text-fg-2 ${flash.Registry ? "chip-flash" : ""}`}
      >
        Registry
      </span>
    </div>
  );
}

export default function StatusLine() {
  const offline = useStore((s) => s.offlineDot);
  const mic = useStore((s) => s.mic);
  return (
    <header className="flex h-10 shrink-0 items-center gap-5 border-b border-rule bg-bg px-4">
      <Context />
      <div className="flex-1" />
      <Privacy />
      <span className="h-4 w-px bg-rule" />
      <Banks />
      {offline && (
        <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-close-ink" title="Offline mode: answers come from the recorded cache">
          <WifiOff size={14} /> Offline
        </span>
      )}
      <span className="h-4 w-px bg-rule" />
      <div className="flex shrink-0 items-center gap-2">
        {mic !== "idle" && <MicLevel bars={5} height={14} />}
        <MicButton />
      </div>
    </header>
  );
}
