"use client";
// Investigate workspace: agent trail (left), 3D case graph (centre), evidence + decision (right).
// Ported from the old CasePanel + GraphCanvas; every flow still runs through lib/store.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  AlertTriangle, Check, CheckCircle2, ChevronRight, Eye, EyeOff, FolderOpen, Loader2, RotateCw, ShieldCheck, X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useGraphStore, type ColourBy } from "@/lib/graphStore";
import { adaptCy, endId, mergeData, type GData, type GLink, type GNode } from "@/lib/graphAdapt";
import { MOCK } from "@/lib/api";
import { HIDDEN_UNTIL_INCOMING } from "@/lib/mockGraph";
import { S5_RING, SCENARIOS } from "@/lib/scenarios";
import type { StepEvent } from "@/lib/types";
import Inspector from "@/components/graph/Inspector";
import Legend from "@/components/graph/Legend";

const Graph3D = dynamic(() => import("@/components/graph/Graph3D"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-[13px] text-muted"><Loader2 size={14} className="mr-2 animate-spin" />Loading the 3D renderer</div>,
});

const ACTION_LABEL: Record<string, string> = {
  proceed: "Proceed with the payment",
  hold: "Hold this payment for review",
  hold_and_publish: "Hold, and publish fingerprints to the shared registry",
};
const STEP_NAME: Record<string, string> = {
  start: "Case opened",
  model: "Model call",
  cypher: "Graph query",
  integrity: "Integrity check",
  registry: "Registry lookup",
  propose_action: "Action proposed",
  validate: "Output validated",
  evidence: "Evidence checked",
  gateway: "Pseudonymised",
  tamper: "Insider edit",
  final: "Recommendation ready",
};
const RISK_STYLE: Record<string, string> = {
  low: "bg-[color-mix(in_srgb,var(--match)_16%,transparent)] text-match-ink",
  medium: "bg-[color-mix(in_srgb,var(--close)_18%,transparent)] text-close-ink",
  high: "bg-[color-mix(in_srgb,var(--nomatch)_18%,transparent)] text-nomatch-ink",
};

/** Resolve bare ids (as the agent cites them) to graph node ids: exact, then ph:/fp:/dv: twins. */
function resolver(data: GData) {
  const have = new Set(data.nodes.map((n) => n.id));
  return (ids: string[]) => ids.flatMap((id) => (have.has(id) ? [id] : ["ph:", "fp:", "dv:"].map((p) => p + id).filter((x) => have.has(x))));
}

/** Node ids a step touched: any graph id mentioned anywhere in its payload (query text, rows, rationale). */
function stepIds(e: StepEvent, resolve: (ids: string[]) => string[]): string[] {
  const out = new Set<string>();
  let budget = 4000;
  const walk = (v: unknown) => {
    if (budget-- <= 0 || v == null) return;
    if (typeof v === "string") {
      for (const tok of v.match(/[A-Za-z0-9:_-]{4,}/g) ?? []) resolve([tok]).forEach((x) => out.add(x));
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object") Object.values(v as object).forEach(walk);
  };
  walk(e.data);
  return [...out];
}

// ---------------------------------------------------------------- left: agent trail

function TrailStep({ e, i, active, ids, onPick }: { e: StepEvent; i: number; active: boolean; ids: string[]; onPick: () => void }) {
  const bad = e.status === "error" || e.status === "blocked" || e.status === "excluded";
  const text: string | undefined = e.data?.text ?? e.data?.purpose ?? e.data?.summary ?? (e.step === "propose_action" ? e.data?.rationale : undefined);
  const q: string | undefined = e.data?.query;
  const dot = e.status === "running" ? "border-main bg-bg" : bad ? "border-nomatch bg-nomatch" : active ? "border-accent bg-accent" : "border-rule bg-surface-2";
  return (
    <li className="line-in relative pl-6">
      <span className="absolute bottom-0 left-[7px] top-0 w-px bg-rule" aria-hidden />
      <span className={`absolute left-[3px] top-[11px] h-[9px] w-[9px] rounded-full border-2 ${dot}`} aria-hidden />
      <button
        onClick={onPick}
        aria-pressed={active}
        className={`w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors ${active ? "bg-surface-2" : "hover:bg-surface-2/60"}`}
      >
        <div className="flex items-center gap-2 text-[13px]">
          {e.status === "running" && <Loader2 size={12} className="shrink-0 animate-spin text-main" />}
          {e.status === "repaired" && <RotateCw size={12} className="shrink-0 text-match-ink" />}
          <span className={`font-medium ${bad ? "text-nomatch-ink" : "text-fg"}`}>{STEP_NAME[e.step] ?? e.step}</span>
          {e.data?.attempt ? <span className="text-[12px] text-muted">#{e.data.attempt}</span> : null}
          {bad && <span className="text-[12px] text-nomatch-ink">{e.status}</span>}
          <span className="ml-auto flex items-center gap-2">
            {ids.length > 0 && <span className="rounded-full bg-bg px-1.5 font-mono text-[10.5px] tabular-nums text-muted" title="Entities this step touched">{ids.length}</span>}
            {e.ms && e.status !== "running" ? <span className="font-mono text-[11px] tabular-nums text-muted">{e.ms >= 1000 ? `${(e.ms / 1000).toFixed(1)}s` : `${e.ms}ms`}</span> : null}
          </span>
        </div>
        {text && <div className={`mt-0.5 text-[12.5px] leading-snug text-fg-2 ${active ? "" : "line-clamp-2"}`}>{text}</div>}
      </button>
      {active && q && (
        <pre className={`scroll-thin mx-2 mb-1 mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] px-2 py-1.5 font-mono text-[11.5px] leading-[1.5] ${e.status === "error" ? "bg-[color-mix(in_srgb,var(--nomatch)_10%,transparent)] text-nomatch-ink" : "bg-bg text-fg-2"}`}>{q}</pre>
      )}
      {active && e.data?.error && <div className="mx-2 mb-1 font-mono text-[12px] text-nomatch-ink">{e.data.error}</div>}
      {i < 0 && null}
    </li>
  );
}

function ModelView() {
  const egress = useStore((s) => s.egress);
  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-snug text-fg-2">Exact payloads sent through the pseudonymisation gateway. Names, IBANs, phones and fingerprints are tokens; the mapping stays inside the bank.</p>
      {egress.length === 0 && <p className="text-[13px] text-muted">No model calls yet.</p>}
      {egress.map((e, i) => (
        <div key={i} className="overflow-hidden rounded-[var(--radius-sm)] border border-rule">
          <div className="flex items-baseline gap-2 border-b border-rule bg-surface-2 px-2.5 py-1.5">
            <span className="text-[12px] font-semibold text-fg">{e.call}</span>
            <span className="ml-auto truncate font-mono text-[11px] text-muted">{e.model} · {e.tokens} tok</span>
          </div>
          <pre className="scroll-thin max-h-44 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[11.5px] leading-[1.5] text-fg-2">{e.payload}</pre>
          <div className="truncate border-t border-rule px-2.5 py-1 font-mono text-[11px] text-muted">sha256 {e.sha256}</div>
        </div>
      ))}
    </div>
  );
}

function AgentTrail({ data, activeStep, setActiveStep }: { data: GData; activeStep: number | null; setActiveStep: (i: number | null) => void }) {
  const steps = useStore((s) => s.caseSteps);
  const status = useStore((s) => s.caseStatus);
  const caseId = useStore((s) => s.caseId);
  const counter = useStore((s) => s.counter);
  const modelView = useStore((s) => s.modelView);
  const toggleModelView = useStore((s) => s.toggleModelView);
  const setHighlight = useStore((s) => s.setHighlight);
  const out = useStore((s) => s.caseOut);
  const listRef = useRef<HTMLDivElement>(null);
  const resolve = useMemo(() => resolver(data), [data]);
  const idsPer = useMemo(() => steps.map((e) => stepIds(e, resolve)), [steps, resolve]);

  useEffect(() => {
    if (out || modelView) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [steps.length, out, modelView]);

  const pick = (i: number) => {
    if (activeStep === i) { setActiveStep(null); return; }
    setActiveStep(i);
    if (idsPer[i]?.length) setHighlight(idsPer[i]);
  };

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r border-rule bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-rule px-4">
        <span className="text-[13px] font-semibold text-fg">Agent trail</span>
        {caseId && <span className="truncate rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-2">{caseId}</span>}
        {status === "running" && <Loader2 size={13} className="animate-spin text-main" />}
        {caseId && status !== "idle" && (
          <button
            onClick={toggleModelView}
            aria-pressed={modelView}
            title="What the model saw"
            className={`ml-auto flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[12px] font-medium ${modelView ? "bg-main text-white" : "text-fg-2 hover:bg-surface-2"}`}
          >
            {modelView ? <EyeOff size={13} /> : <Eye size={13} />} Model view
          </button>
        )}
      </div>
      <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {modelView ? (
          <ModelView />
        ) : steps.length === 0 ? (
          <p className="px-2 pt-2 text-[13px] leading-snug text-muted">{status === "idle" ? "The agent's queries, model calls and checks appear here once a case is opened." : "Starting…"}</p>
        ) : (
          <ol>
            {steps.map((e, i) => (
              <TrailStep key={i} e={e} i={i} active={activeStep === i} ids={idsPer[i] ?? []} onPick={() => pick(i)} />
            ))}
          </ol>
        )}
      </div>
      <div className="grid shrink-0 grid-cols-2 border-t border-rule text-[12px]">
        <div className="border-r border-rule px-4 py-2">
          <div className={`font-mono text-[15px] tabular-nums ${counter.identifiers ? "text-nomatch-ink" : "text-match-ink"}`}>{counter.identifiers}</div>
          <div className="text-muted">raw ids to the model</div>
        </div>
        <div className="px-4 py-2">
          <div className="font-mono text-[15px] tabular-nums text-fg">{counter.tokens}</div>
          <div className="text-muted">masked as tokens</div>
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- right: evidence + decision

function IntegrityCard({ onPick }: { onPick: (ids: string[]) => void }) {
  const integ = useStore((s) => s.integrity);
  const reverify = useStore((s) => s.reverify);
  if (!integ) return null;
  const changed = (integ.items ?? []).filter((i) => i.status !== "verified").length;
  return (
    <section className={`rounded-[var(--radius)] border p-3 ${changed ? "border-nomatch/60 bg-[color-mix(in_srgb,var(--nomatch)_8%,transparent)]" : "border-rule"}`}>
      <div className="flex items-center gap-2">
        {changed ? <AlertTriangle size={15} className="text-nomatch-ink" /> : <ShieldCheck size={15} className="text-match-ink" />}
        <span className={`text-[13px] font-semibold ${changed ? "text-nomatch-ink" : "text-fg"}`}>
          {changed ? `${changed} evidence item${changed > 1 ? "s" : ""} changed` : "Evidence verified on-chain"}
        </span>
        <button onClick={reverify} className="ml-auto flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] font-medium text-fg-2 hover:bg-surface-2 hover:text-fg">
          <RotateCw size={12} /> Re-verify
        </button>
      </div>
      <div className="mt-0.5 text-[12px] text-muted">{integ.verified} of {integ.total} match the signed root · epoch {integ.epoch} · block #{integ.block}</div>
      {(integ.items ?? []).length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {(integ.items ?? []).map((it) => (
            <li key={(it as any).element_id ?? it.id}>
              <button onClick={() => onPick([it.id])} className="flex w-full items-center gap-2 rounded-[4px] px-1 py-0.5 text-left text-[12px] hover:bg-surface-2">
                {it.status === "verified" ? <Check size={12} className="shrink-0 text-match" /> : <X size={12} className="shrink-0 text-nomatch-ink" />}
                <span className={`truncate ${it.status === "verified" ? "text-fg-2" : "font-medium text-nomatch-ink"}`}>{it.label}</span>
                {it.status !== "verified" ? (
                  <span className="ml-auto shrink-0 text-[11px] text-nomatch-ink">changed after epoch {integ.epoch}</span>
                ) : (
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{it.leaf?.slice(0, 8)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NoCase() {
  const status = useStore((s) => s.caseStatus);
  const caseId = useStore((s) => s.caseId);
  const runCase = useStore((s) => s.runCase);
  const payee = useStore((s) => s.payee);
  const ring = useStore((s) => s.ringAlert);
  const canOpen = !!caseId && status === "idle" && (ring || (payee && payee.band === "CLOSE"));
  if (canOpen) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-[var(--radius)] border border-dashed border-main/50 p-4">
        <div className="text-[14px] font-semibold text-fg">{ring ? "Ring alert needs an investigation" : "Close match needs a second look"}</div>
        <p className="text-[13px] leading-snug text-fg-2">The agent gathers evidence from the graph and recommends an action. You decide.</p>
        <button onClick={runCase} className="flex h-9 items-center gap-2 rounded-[var(--radius)] bg-main px-3.5 text-[13px] font-semibold text-white hover:brightness-110">
          <FolderOpen size={14} /> Open the case
        </button>
      </div>
    );
  }
  if (payee?.band === "MATCH") return <Outcome tone="match" title="No case needed" body="Name matches. The payment proceeds automatically and the decision is logged." />;
  if (payee?.band === "NO_MATCH") return <Outcome tone="nomatch" title="Held before sending" body="The sender is asked to confirm the account. The hold is logged." />;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
      <FolderOpen size={22} strokeWidth={1.5} />
      <span className="text-[13px]">No case open</span>
    </div>
  );
}
function Outcome({ tone, title, body }: { tone: "match" | "nomatch"; title: string; body: string }) {
  return (
    <div className={`rounded-[var(--radius)] border p-4 ${tone === "match" ? "border-match/40" : "border-nomatch/40"}`}>
      <div className={`flex items-center gap-2 text-[14px] font-semibold ${tone === "match" ? "text-match-ink" : "text-nomatch-ink"}`}>
        {tone === "match" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {title}
      </div>
      <p className="mt-1 text-[13px] leading-snug text-fg-2">{body}</p>
    </div>
  );
}

function EvidencePanel({ onEvidence, activeEv }: { onEvidence: (ids: string[], i: number) => void; activeEv: number | null }) {
  const out = useStore((s) => s.caseOut);
  const status = useStore((s) => s.caseStatus);
  const steps = useStore((s) => s.caseSteps);
  const approve = useStore((s) => s.approve);
  const reject = useStore((s) => s.reject);
  const decided = status === "approved" || status === "rejected";
  const proceed = out?.recommended_action === "proceed";

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-rule bg-surface 2xl:w-[420px]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-rule px-4">
        <span className="text-[13px] font-semibold text-fg">Evidence</span>
        {status === "running" && <span className="flex items-center gap-1 text-[12px] text-fg-2"><Loader2 size={12} className="animate-spin" /> Investigating</span>}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!out ? (
          status === "idle" ? <NoCase /> : (
            <div className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={13} className="animate-spin" /> {steps.length} step{steps.length === 1 ? "" : "s"} so far</div>
          )
        ) : (
          <div className="space-y-5">
            <section className="line-in">
              <p className="text-[14px] leading-[1.6] text-fg">{out.narrative}</p>
              {out.narrative_ur && <p className="urdu mt-1.5 text-[14px] text-fg-2" lang="ur" dir="rtl" style={{ lineHeight: 2 }}>{out.narrative_ur}</p>}
            </section>

            {(out.evidence ?? []).length > 0 && (
              <section className="line-in">
                <div className="label mb-1.5">Cited evidence</div>
                <ul className="space-y-1.5">
                  {(out.evidence ?? []).map((ev, i) => (
                    <li key={i}>
                      <button
                        onClick={() => onEvidence(ev.node_ids ?? [], i)}
                        aria-pressed={activeEv === i}
                        className={`flex w-full gap-2.5 rounded-[var(--radius-sm)] border px-2.5 py-2 text-left text-[13px] leading-snug transition-colors ${activeEv === i ? "border-accent/70 bg-accent/10 text-fg" : "border-rule text-fg-2 hover:border-main/60"}`}
                      >
                        <span className="mt-[1px] font-mono text-[11px] text-muted">{i + 1}</span>
                        <span className="min-w-0 flex-1">{ev.claim}</span>
                        {(ev.node_ids ?? []).length > 0 && <span className="shrink-0 self-start rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums text-muted">{ev.node_ids.length}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
                {out.open_questions && out.open_questions.length > 0 && <p className="mt-2 text-[12px] leading-snug text-muted">Open questions: {out.open_questions.join(" ")}</p>}
              </section>
            )}

            <IntegrityCard onPick={(ids) => onEvidence(ids, -1)} />
          </div>
        )}
      </div>

      {out && (
        <div className="shrink-0 border-t border-rule px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="label">Recommendation</span>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${RISK_STYLE[out.risk] ?? ""}`}>{out.risk} risk</span>
            <span className="text-[12px] tabular-nums text-muted">{Math.round(out.confidence * 100)}% confident</span>
          </div>
          <div className={`mt-1 text-[16px] font-semibold leading-snug ${proceed ? "text-match-ink" : "text-nomatch-ink"}`}>{ACTION_LABEL[out.recommended_action] ?? out.recommended_action}</div>
          {decided ? (
            <div className={`mt-3 flex h-9 items-center justify-center gap-2 rounded-[var(--radius)] text-[13px] font-semibold ${status === "approved" ? "bg-[color-mix(in_srgb,var(--match)_16%,transparent)] text-match-ink" : "bg-surface-2 text-fg-2"}`}>
              {status === "approved" ? <><Check size={14} /> Approved · anchored on-chain</> : <><X size={14} /> Rejected · logged</>}
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button onClick={approve} disabled={status !== "ready"} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-[var(--radius)] bg-main text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {status === "approving" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve
              </button>
              <button onClick={reject} disabled={status !== "ready"} className="flex h-9 w-28 items-center justify-center gap-2 rounded-[var(--radius)] border border-rule bg-surface-2 text-[13px] font-medium text-fg-2 hover:border-nomatch hover:text-nomatch-ink disabled:opacity-50">
                <X size={14} /> Reject
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------- view

export default function InvestigateView() {
  const graph = useStore((s) => s.graph);
  const focus = useStore((s) => s.focus);
  const highlight = useStore((s) => s.highlight);
  const pulse = useStore((s) => s.pulse);
  const pulseNonce = useStore((s) => s.pulseNonce);
  const revealed = useStore((s) => s.revealed);
  const ringAlert = useStore((s) => s.ringAlert);
  const integrity = useStore((s) => s.integrity);
  const scenarioIdx = useStore((s) => s.scenarioIdx);
  const caseSteps = useStore((s) => s.caseSteps);
  const caseOut = useStore((s) => s.caseOut);
  const setStoreHighlight = useStore((s) => s.setHighlight);
  const active = useStore((s) => s.view) === "investigate";

  const caseExtra = useGraphStore((s) => s.caseExtra);
  const gHighlight = useGraphStore((s) => s.highlight);
  const selection = useGraphStore((s) => s.selection);
  const selScope = useGraphStore((s) => s.selScope);
  const gFocus = useGraphStore((s) => s.focus);
  const pathFrom = useGraphStore((s) => s.pathFrom);
  const qerror = useGraphStore((s) => s.qerror);
  const select = useGraphStore((s) => s.select);
  const clearSelection = useGraphStore((s) => s.clearSelection);
  const pathTo = useGraphStore((s) => s.pathTo);
  const resetCase = useGraphStore((s) => s.resetCase);

  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [activeEv, setActiveEv] = useState<number | null>(null);
  const [colourBy, setColourBy] = useState<ColourBy>("kind");

  const base = useMemo(() => adaptCy(graph, SCENARIOS[scenarioIdx]?.key), [graph, scenarioIdx]);
  const data = useMemo(() => (caseExtra.nodes.length ? mergeData(base, caseExtra) : base), [base, caseExtra]);
  const resolve = useMemo(() => resolver(data), [data]);

  // New scenario / graph: drop anything explored on top of the old one.
  useEffect(() => { resetCase(); setActiveStep(null); setActiveEv(null); }, [graph, scenarioIdx, resetCase]);
  useEffect(() => { if (caseSteps.length === 0) setActiveStep(null); }, [caseSteps.length]);
  useEffect(() => { setActiveEv(null); }, [caseOut]);
  // A highlight from the demo flow (evidence, ring, voice) replaces an exploratory one.
  useEffect(() => { useGraphStore.getState().setHighlight(null); }, [highlight]);
  // Selection made in the Graph view does not carry over.
  useEffect(() => {
    if (active && useGraphStore.getState().selScope !== "case") { clearSelection(); useGraphStore.getState().setHighlight(null); }
  }, [active, clearSelection]);

  const focusIds = useMemo(() => new Set(focus), [focus]);
  const hlList = useMemo(() => (gHighlight ? gHighlight.nodes : highlight), [gHighlight, highlight]);
  const hlNodes = useMemo(() => new Set(hlList), [hlList]);
  const hlLinks = useMemo(() => new Set(gHighlight?.links ?? []), [gHighlight]);
  const ringIds = useMemo(() => new Set(ringAlert ? [...S5_RING, ...pulse] : []), [ringAlert, pulse]);
  const tamperedIds = useMemo(
    () => new Set(resolve((integrity?.items ?? []).filter((i) => i.status !== "verified").map((i) => i.id))),
    [integrity, resolve],
  );
  const hiddenIds = useMemo(() => new Set(MOCK ? HIDDEN_UNTIL_INCOMING.filter((id) => !revealed.includes(id)) : []), [revealed]);
  const pulseObj = useMemo(() => ({ ids: pulse, nonce: pulseNonce }), [pulse, pulseNonce]);
  const fitIds = hlList.length ? hlList : focus;
  const fitKey = `${scenarioIdx}|${fitIds.join(",")}`;
  const mine = selScope === "case" ? selection : null;

  const onNodeClick = useCallback((n: GNode) => {
    if (pathFrom && pathFrom !== n.id) { pathTo(n.id, data, "case"); return; }
    const nb = data.links.flatMap((l) => (endId(l.source) === n.id ? [endId(l.target)] : endId(l.target) === n.id ? [endId(l.source)] : []));
    setStoreHighlight([n.id, ...nb]);
    // the highlight change refits the camera onto the node and its neighbours
    select({ type: "node", id: n.id }, data, "case");
  }, [pathFrom, pathTo, data, setStoreHighlight, select]);
  const onLinkClick = useCallback((l: GLink) => {
    setStoreHighlight([endId(l.source), endId(l.target)]);
    select({ type: "link", id: l.id, rel: l.rel, source: endId(l.source), target: endId(l.target) }, data, "case");
  }, [data, setStoreHighlight, select]);

  // Evidence row: highlight its entities and fly there; if it names exactly one linked pair, explain that link.
  const onEvidence = useCallback((ids: string[], i: number) => {
    setActiveEv(i >= 0 ? i : null);
    setStoreHighlight(ids);
    const r = resolve(ids);
    if (!r.length) return;
    const set = new Set(r);
    const between = data.links.filter((l) => set.has(endId(l.source)) && set.has(endId(l.target)));
    if (between.length === 1) {
      const l = between[0];
      select({ type: "link", id: l.id, rel: l.rel, source: endId(l.source), target: endId(l.target) }, data, "case");
    } else if (r.length === 1) {
      select({ type: "node", id: r[0] }, data, "case");
    }
    // the highlight change flies the camera to these entities (fitKey)
  }, [resolve, data, setStoreHighlight, select]);

  return (
    <div className="flex h-full min-h-0 w-full bg-bg">
      <AgentTrail data={data} activeStep={activeStep} setActiveStep={setActiveStep} />

      <section className="relative min-w-0 flex-1 overflow-hidden" aria-label="Case graph">
        <div className="absolute inset-0">
          {data.nodes.length ? (
            <Graph3D
              data={data}
              variant="case"
              active={active}
              colourBy={colourBy}
              highlightNodes={hlNodes}
              highlightLinks={hlLinks}
              dimOthers
              focusIds={focusIds}
              focus={gFocus}
              fitIds={fitIds}
              fitKey={fitKey}
              selectedId={mine?.type === "node" ? mine.id : null}
              selectedLinkId={mine?.type === "link" ? mine.id : null}
              ringIds={ringIds}
              tamperedIds={tamperedIds}
              hiddenIds={hiddenIds}
              pulse={pulseObj}
              onNodeClick={onNodeClick}
              onLinkClick={onLinkClick}
              onBackgroundClick={clearSelection}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-muted">{graph ? "This case has no graph neighbourhood." : "Loading the case graph…"}</div>
          )}
        </div>

        <div className="pointer-events-none absolute left-4 top-3 z-10 flex items-center gap-3">
          <span className="text-[13px] font-semibold text-fg">{SCENARIOS[scenarioIdx]?.title}</span>
          <span className="font-mono text-[11.5px] text-muted">{data.nodes.length} entities · {data.links.length} links</span>
        </div>
        <div className={`absolute top-2.5 z-10 flex rounded-[var(--radius-sm)] border border-rule bg-surface/90 p-0.5 backdrop-blur-sm ${mine ? "right-[384px]" : "right-3"}`}>
          {(["kind", "bank"] as ColourBy[]).map((c) => (
            <button key={c} onClick={() => setColourBy(c)} aria-pressed={colourBy === c}
              className={`rounded-[5px] px-2 py-0.5 text-[12px] capitalize ${colourBy === c ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"}`}>
              {c}
            </button>
          ))}
        </div>

        <div className="absolute bottom-3 left-3 z-10">
          <Legend colourBy={colourBy} rels={false} />
        </div>
        {(pathFrom || qerror) && (
          <div className={`absolute bottom-3 z-10 text-[12px] ${mine ? "right-[384px]" : "right-3"}`}>
            {pathFrom ? <span className="rounded-full bg-accent px-2.5 py-0.5 font-medium text-accent-ink">Pick the second entity for the path</span> : <span className="text-fg-2">{qerror}</span>}
          </div>
        )}

        {mine && (
          <div className="absolute bottom-0 right-0 top-0 z-20">
            <Inspector data={data} scope="case" />
          </div>
        )}
      </section>

      <EvidencePanel onEvidence={onEvidence} activeEv={activeEv} />
    </div>
  );
}
