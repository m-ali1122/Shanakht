"use client";
import { Mic } from "lucide-react";
import { useStore } from "@/lib/store";
import { SCENARIOS } from "@/lib/scenarios";
import type { AlignmentItem } from "@/lib/types";
import Queue from "@/components/shell/Queue";
import CheckRoute from "@/components/shell/CheckRoute";
import NameCrossing, { type CrossingData } from "@/components/shell/NameCrossing";
import RingFan from "@/components/shell/RingFan";
import AskSurface from "@/components/shell/AskSurface";
import { BankTag } from "@/components/shell/bits";

/** The crossing's data, filled in step by step as the check streams (title first, then the alignment, then the verdict). */
function useCrossing(): CrossingData {
  const idx = useStore((s) => s.scenarioIdx);
  const payee = useStore((s) => s.payee);
  const steps = useStore((s) => s.payeeSteps);
  const phase = useStore((s) => s.payeePhase);
  const t = SCENARIOS[idx].transfer;
  const data = (n: string) => [...steps].reverse().find((e) => e.step === n && e.status !== "running")?.data;
  const tf = data("title_fetch");
  const cp = data("compare");
  const dc = data("decision");
  const ph = data("phrase");
  const p = payee as (typeof payee & { phrase?: { en?: string; ur?: string }; decision?: { banner?: string } }) | null;
  return {
    typed: t.typed_name,
    title: p?.title ?? tf?.title ?? null,
    urdu: p?.urdu_name ?? tf?.urdu_name ?? null,
    alignment: (p?.alignment ?? cp?.alignment ?? null) as AlignmentItem[] | null,
    band: p?.band ?? cp?.band ?? null,
    score: p?.score ?? cp?.score ?? null,
    reasons: p?.reasons ?? cp?.reasons ?? [],
    banner: p?.banner ?? p?.decision?.banner ?? dc?.banner ?? null,
    explain: p?.explain ?? p?.phrase ?? ph ?? null,
    bank: t.bank,
    looking: phase === "running" && !tf,
  };
}

function TransferHead() {
  const idx = useStore((s) => s.scenarioIdx);
  const t = SCENARIOS[idx].transfer;
  return (
    <div className="flex items-center gap-6 border-b border-rule px-6 py-3 text-[13px]">
      <div className="min-w-0">
        <span className="text-muted">From </span>
        <span className="font-medium text-fg">{t.sender}</span>
        <span className="text-muted"> via {t.exchange_name}, {t.country}</span>
      </div>
      <div className="flex-1" />
      <span className="font-mono text-[12px] text-fg-2">{t.iban}</span>
      <BankTag code={t.bank} />
      <span className="shrink-0 tabular-nums text-fg">
        PKR {t.amount_pkr.toLocaleString("en-US")}
        <span className="ml-1.5 text-muted">{t.currency} {t.amount_fx.toLocaleString("en-US")}</span>
      </span>
    </div>
  );
}

/** A voice question asked outside case 6 still gets its answer shown here. */
function VoiceAside() {
  const voice = useStore((s) => s.voice);
  const pending = useStore((s) => s.transcriptPending);
  const mic = useStore((s) => s.mic);
  if (!voice && !pending && mic === "idle") return null;
  return (
    <div className="flex items-center gap-3 border-b border-rule bg-main-soft/50 px-6 py-2 text-[13px] line-in">
      <Mic size={14} className="shrink-0 text-main-ink" />
      <span className="min-w-0 truncate text-fg-2">{voice?.transcript ?? pending ?? ""}{mic === "listening" && !pending ? "Listening…" : ""}</span>
      <span className="ml-auto min-w-0 truncate font-medium text-fg">{voice ? voice.answer : mic === "thinking" ? "Querying the graph…" : ""}</span>
    </div>
  );
}

export default function InboundView() {
  const idx = useStore((s) => s.scenarioIdx);
  const key = SCENARIOS[idx].key;
  const crossing = useCrossing();
  return (
    <div className="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)_296px] 2xl:grid-cols-[340px_minmax(0,1fr)_340px]">
      <Queue />
      <section className="flex min-h-0 min-w-0 flex-col" aria-label={key === "S6" ? "Ask the graph" : "Name crossing"}>
        {key !== "S6" && <TransferHead />}
        {key !== "S6" && <VoiceAside />}
        <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-8">
          <div className="my-auto">{key === "S6" ? <AskSurface /> : key === "S5" ? <RingFan /> : <NameCrossing d={crossing} />}</div>
        </div>
      </section>
      <CheckRoute />
    </div>
  );
}
