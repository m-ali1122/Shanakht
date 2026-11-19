"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, Play, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { SCENARIOS } from "@/lib/scenarios";
import type { StepEvent } from "@/lib/types";
import { BAND_INK, BAND_WORD } from "./bits";

type RowState = "later" | "running" | "done" | "error";
interface Row { key: string; name: string; state: RowState; ms?: number | null; fact?: React.ReactNode; tone?: string }

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (d?: string | null) => (d ? `${MONTH[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : "");

const ACTION: Record<string, { text: string; tone: string }> = {
  auto_pass: { text: "Release automatically", tone: "var(--match-ink)" },
  review: { text: "Hold and open a case", tone: "var(--close-ink)" },
  hold: { text: "Hold before sending", tone: "var(--nomatch-ink)" },
};

/** Elapsed ms for the step that is running now (ticks while it runs). */
function useElapsed(running: string | null) {
  const t0 = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });
  const [now, setNow] = useState(0);
  if (t0.current.key !== running) t0.current = { key: running, at: performance.now() };
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [running]);
  return running ? Math.max(0, Math.round(now - t0.current.at)) : 0;
}

function payeeRows(steps: StepEvent[], phase: string): Row[] {
  const last = (n: string) => [...steps].reverse().find((x) => x.step === n);
  const st = (e?: StepEvent): RowState => (!e ? "later" : e.status === "running" ? "running" : e.status === "error" ? "error" : "done");
  const d = (n: string) => last(n)?.data ?? {};
  const rows: Row[] = [];
  const tf = last("title_fetch");
  rows.push({ key: "title_fetch", name: "Title lookup", state: st(tf), ms: tf?.ms, fact: tf && tf.status !== "running" ? (d("title_fetch").title ? <>{d("title_fetch").bank} holds <span className="font-medium text-fg">{d("title_fetch").title}</span></> : "Account not found") : null });
  const cp = last("compare");
  const band = d("compare").band;
  rows.push({ key: "compare", name: "Compare names", state: st(cp), ms: cp?.ms, fact: cp && band ? <><span style={{ color: BAND_INK[band] }} className="font-medium">{BAND_WORD[band]}</span> · score <span className="font-mono">{Number(d("compare").score).toFixed(2)}</span></> : null });
  const hs = last("history");
  const h = d("history");
  rows.push({ key: "history", name: "Transfer history", state: st(hs), ms: hs?.ms, fact: hs && hs.status !== "running" ? (h.prior_transfers ? `${h.prior_transfers} earlier transfers to this account since ${month(h.first)}` : "No earlier transfers to this account") : null });
  const dc = last("decision");
  const act = ACTION[d("decision").action];
  rows.push({ key: "decision", name: "Decision", state: st(dc), ms: dc?.ms, fact: dc && act ? <span style={{ color: act.tone }} className="font-medium">{act.text}</span> : null });
  const ph = last("phrase");
  rows.push({ key: "phrase", name: "Explain", state: st(ph), ms: ph?.ms, fact: ph && ph.status !== "running" ? (d("phrase").source === "llm" ? "Written by the model through the masking gateway" : "Template wording, no model call") : null });
  const lg = last("ledger");
  if (lg || (phase !== "done" && dc && d("decision").action !== "review")) {
    rows.push({ key: "ledger", name: "Anchor decision", state: st(lg), ms: lg?.ms, fact: lg?.data?.block != null ? <>On chain in block <span className="font-mono">#{lg.data.block}</span></> : null });
  }
  // The stream only reports finished steps, so the first unfinished one is the one in flight.
  if (phase === "running" && !rows.some((r) => r.state === "running")) {
    const nxt = rows.find((r) => r.state === "later");
    if (nxt) nxt.state = "running";
  }
  return rows;
}

function Timeline({ rows, elapsed }: { rows: Row[]; elapsed: number }) {
  return (
    <ol className="relative">
      {rows.map((r, i) => (
        <li key={r.key} className="relative grid grid-cols-[20px_1fr_auto] gap-x-3 pb-4">
          {i < rows.length - 1 && <span className={`absolute left-[9px] top-[22px] bottom-0 w-px ${r.state === "done" ? "bg-match/60" : "bg-rule"}`} />}
          <span className="relative z-10 mt-[1px] flex h-[19px] w-[19px] items-center justify-center rounded-full border bg-bg" style={{ borderColor: r.state === "done" ? "var(--match)" : r.state === "running" ? "var(--main)" : r.state === "error" ? "var(--nomatch)" : "var(--rule)" }}>
            {r.state === "done" ? <Check size={11} strokeWidth={3} className="text-match-ink" /> : r.state === "running" ? <Loader2 size={11} className="animate-spin text-main-ink" /> : r.state === "error" ? <X size={11} strokeWidth={3} className="text-nomatch-ink" /> : null}
          </span>
          <span className="min-w-0">
            <span className={`block text-[14px] ${r.state === "later" ? "text-muted" : "font-medium text-fg"}`}>{r.name}</span>
            {r.fact && <span className="mt-0.5 block text-[13px] leading-snug text-fg-2 line-in">{r.fact}</span>}
          </span>
          <span className="pt-[2px] font-mono text-[12px] tabular-nums text-muted">
            {r.state === "running" ? <span className="text-main-ink">{(elapsed / 1000).toFixed(1)} s</span> : r.ms != null && r.state === "done" ? `${r.ms.toLocaleString("en-US")} ms` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

function OpenCase() {
  const caseId = useStore((s) => s.caseId);
  const caseStatus = useStore((s) => s.caseStatus);
  const runCase = useStore((s) => s.runCase);
  const setView = useStore((s) => s.setView);
  const busy = useStore((s) => s.busy);
  if (!caseId) return null;
  const fresh = caseStatus === "idle";
  return (
    <button
      onClick={() => (fresh ? runCase() : setView("investigate"))}
      disabled={busy && fresh}
      className="flex h-10 w-full items-center justify-between rounded-[var(--radius-sm)] border border-main/60 bg-main-soft px-3 text-[14px] font-semibold text-fg transition-colors duration-150 hover:bg-main disabled:opacity-60"
    >
      Open investigation
      <span className="flex items-center gap-2 font-mono text-[12px] font-normal text-fg-2">
        {caseId}
        <ArrowRight size={15} />
      </span>
    </button>
  );
}

function Outcome() {
  const payee = useStore((s) => s.payee);
  const steps = useStore((s) => s.payeeSteps);
  if (!payee) return null;
  const action = (payee as unknown as { decision?: { action?: string } }).decision?.action ?? [...steps].reverse().find((e) => e.step === "decision")?.data?.action;
  if (action === "review" || payee.case_id) return <OpenCase />;
  const a = ACTION[action ?? ""];
  if (!a) return null;
  return (
    <div className="rounded-[var(--radius-sm)] border border-rule px-3 py-2.5 text-[14px] font-medium" style={{ color: a.tone }}>
      {action === "auto_pass" ? "Released to the beneficiary" : "Held before sending"}
    </div>
  );
}

function PayeeRoute() {
  const steps = useStore((s) => s.payeeSteps);
  const phase = useStore((s) => s.payeePhase);
  const runPayee = useStore((s) => s.runPayee);
  const busy = useStore((s) => s.busy);
  const rows = payeeRows(steps, phase);
  const running = rows.find((r) => r.state === "running")?.key ?? null;
  const elapsed = useElapsed(running);
  const total = rows.reduce((a, r) => a + (r.state === "done" ? r.ms ?? 0 : 0), 0);
  return (
    <>
      <Timeline rows={rows} elapsed={elapsed} />
      {phase === "idle" && (
        <button onClick={() => runPayee()} disabled={busy} className="flex h-9 items-center gap-2 self-start rounded-[var(--radius-sm)] border border-rule px-3 text-[13px] font-medium text-fg hover:border-main disabled:opacity-60">
          <Play size={13} /> Run the check
        </button>
      )}
      {phase === "done" && (
        <div className="space-y-3">
          <div className="text-[12px] text-muted">Checked in <span className="font-mono tabular-nums text-fg-2">{(total / 1000).toFixed(1)} s</span></div>
          <Outcome />
        </div>
      )}
    </>
  );
}

function RingRoute() {
  const ring = useStore((s) => s.ringAlert);
  const caseStatus = useStore((s) => s.caseStatus);
  const caseOut = useStore((s) => s.caseOut);
  const hit = useStore((s) => s.registryHit);
  const blocks = useStore((s) => s.blocks);
  const published = blocks.filter((b) => b.kind === "publish").length;
  const caseState: RowState = caseStatus === "running" ? "running" : caseOut ? "done" : "later";
  const rows: Row[] = [
    { key: "ring", name: "Graph scan", state: ring ? "done" : "later", fact: ring ? <>Star around the sender: {ring.beneficiaries} beneficiaries at {ring.banks} banks</> : null },
    { key: "case", name: "Case agent", state: caseState, fact: caseOut ? <>Recommends <span className="font-medium text-fg">{caseOut.recommended_action.replaceAll("_", " ")}</span>, risk {caseOut.risk}</> : null },
    { key: "approve", name: "Approve and publish", state: caseStatus === "approving" ? "running" : caseStatus === "approved" ? "done" : "later", fact: caseStatus === "approved" ? `${published} fingerprint${published === 1 ? "" : "s"} published to the registry` : null },
    { key: "incoming", name: "Partner bank check", state: hit ? "done" : "later", fact: hit ? <span className="font-medium text-nomatch-ink">{hit.bank} stopped the next transfer: registry hit</span> : null },
  ];
  const running = rows.find((r) => r.state === "running")?.key ?? null;
  const elapsed = useElapsed(running);
  return (
    <>
      <Timeline rows={rows} elapsed={elapsed} />
      {ring && <OpenCase />}
    </>
  );
}

function VoiceRoute() {
  const voice = useStore((s) => s.voice);
  const mic = useStore((s) => s.mic);
  const pending = useStore((s) => s.transcriptPending);
  const transcript = voice?.transcript ?? pending;
  const thinking = mic === "thinking";
  const elapsed = useElapsed(thinking ? "q" : null);
  const rows: Row[] = [
    { key: "hear", name: "Speech to text", state: mic === "listening" ? "running" : transcript ? "done" : "later", fact: transcript ? (voice?.language === "ur" ? "Heard in Urdu" : voice ? "Heard in English" : "Question received") : null },
    { key: "query", name: "Write the graph query", state: thinking ? "running" : voice ? "done" : "later", fact: voice ? `${voice.cypher_attempts.length} attempt${voice.cypher_attempts.length === 1 ? "" : "s"}${voice.cypher_attempts.some((c) => c.status === "repaired" || c.status === "error") ? ", repaired after an error" : ""}` : null },
    { key: "rows", name: "Run it on the graph", state: voice ? "done" : "later", fact: voice ? `${voice.rows} row${voice.rows === 1 ? "" : "s"}, ${voice.highlight_ids?.length ?? 0} node${(voice.highlight_ids?.length ?? 0) === 1 ? "" : "s"} lit` : null },
    { key: "answer", name: "Answer in the same language", state: voice ? "done" : "later" },
  ];
  return (
    <>
      <Timeline rows={rows} elapsed={elapsed} />
      {voice && voice.cypher_attempts.length > 0 && (
        <div className="min-h-0 space-y-2">
          {voice.cypher_attempts.map((c, i) => (
            <div key={i} className="rounded-[var(--radius-sm)] border border-rule bg-surface p-2">
              <div className="mb-1 text-[12px] font-medium" style={{ color: c.status === "ok" ? "var(--match-ink)" : c.status === "repaired" ? "var(--close-ink)" : "var(--nomatch-ink)" }}>
                Query {i + 1} · {c.status}
              </div>
              <pre className="max-h-[120px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-fg-2">{c.query}</pre>
              {c.error && <div className="mt-1 font-mono text-[11px] text-nomatch-ink">{c.error}</div>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Right column of Inbound: the path the check takes, with live timings, then what to do about it. */
export default function CheckRoute() {
  const idx = useStore((s) => s.scenarioIdx);
  const key = SCENARIOS[idx].key;
  return (
    <section className="flex min-h-0 flex-col border-l border-rule" aria-label="Check route">
      <div className="flex h-10 shrink-0 items-center px-4">
        <span className="text-[13px] font-semibold text-fg">{key === "S6" ? "Query route" : key === "S5" ? "Ring route" : "Check route"}</span>
      </div>
      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-1">
        {key === "S6" ? <VoiceRoute /> : key === "S5" ? <RingRoute /> : <PayeeRoute />}
      </div>
    </section>
  );
}
