"use client";
// Investigate workspace: the case graph (2D) fills the tab; the agent's work runs as a compact
// pipeline along the top edge (click a stage or a step to light up what it touched); evidence,
// integrity and the decision sit in a right drawer that is open by default.
// Every flow still runs through lib/store.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Eye, EyeOff, FolderOpen, Loader2, PanelRightOpen, RotateCw, ShieldCheck, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { useGraphStore, type ColourBy } from "@/lib/graphStore";
import { adaptCy, endId, mergeData, type GData, type GLink, type GNode } from "@/lib/graphAdapt";
import { MOCK } from "@/lib/api";
import { HIDDEN_UNTIL_INCOMING } from "@/lib/mockGraph";
import { S5_RING, SCENARIOS } from "@/lib/scenarios";
import type { StepEvent } from "@/lib/types";
import Inspector, { inspectorTitle } from "@/components/graph/Inspector";
import Legend from "@/components/graph/Legend";
import { Drawer } from "@/components/shell/Drawer";
import { Pipeline, fmtMs, type PipelineStage } from "@/components/shell/Pipeline";

const Graph2D = dynamic(() => import("@/components/graph/Graph2D"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-[13px] text-muted"><Loader2 size={14} className="mr-2 animate-spin" />Loading the graph</div>,
});

const DRAWER_W = 400;

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
/** Agent steps grouped into the five pipeline stages. */
const STAGES: { id: string; label: string; steps: string[] }[] = [
  { id: "plan", label: "Plan", steps: ["start", "gateway"] },
  { id: "graph", label: "Graph queries", steps: ["cypher", "registry"] },
  { id: "model", label: "Model calls", steps: ["model", "validate", "propose_action"] },
  { id: "evidence", label: "Evidence", steps: ["evidence", "integrity", "tamper"] },
  { id: "final", label: "Recommendation", steps: ["final"] },
];
const stageOf = (step: string) => STAGES.find((s) => s.steps.includes(step))?.id ?? "model";
const RISK_INK: Record<string, string> = { low: "text-match-ink", medium: "text-close-ink", high: "text-nomatch-ink" };
const isBad = (e: StepEvent) => e.status === "error" || e.status === "blocked" || e.status === "excluded";

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

const Label = ({ children }: { children: React.ReactNode }) => <h3 className="mb-1 text-[12px] font-medium text-muted">{children}</h3>;

// ---------------------------------------------------------------- top edge: agent pipeline

function AgentStrip({ data, activeStage, setActiveStage, activeStep, setActiveStep, rightInset }: {
  data: GData; activeStage: string | null; setActiveStage: (s: string | null) => void;
  activeStep: number | null; setActiveStep: (i: number | null) => void; rightInset: number;
}) {
  const steps = useStore((s) => s.caseSteps);
  const status = useStore((s) => s.caseStatus);
  const caseId = useStore((s) => s.caseId);
  const out = useStore((s) => s.caseOut);
  const counter = useStore((s) => s.counter);
  const modelView = useStore((s) => s.modelView);
  const toggleModelView = useStore((s) => s.toggleModelView);
  const setHighlight = useStore((s) => s.setHighlight);
  const scenarioIdx = useStore((s) => s.scenarioIdx);
  const resolve = useMemo(() => resolver(data), [data]);
  const idsPer = useMemo(() => steps.map((e) => stepIds(e, resolve)), [steps, resolve]);
  const listRef = useRef<HTMLOListElement>(null);

  const stages: PipelineStage[] = useMemo(() => {
    const lastStage = steps.length ? stageOf(steps[steps.length - 1].step) : null;
    return STAGES.map((st) => {
      const mine = steps.filter((e) => st.steps.includes(e.step));
      const ms = mine.reduce((a, e) => a + (e.ms ?? 0), 0);
      let state: PipelineStage["state"] = "pending";
      if (mine.length) {
        state = mine.some((e) => e.status === "running") || (status === "running" && lastStage === st.id) ? "active" : "done";
        if (mine.some(isBad) && st.id !== "model") state = state === "active" ? "active" : mine.every(isBad) ? "error" : state;
        if (st.id === "evidence" && mine.some((e) => e.step === "tamper")) state = "error";
      }
      if (st.id === "final" && out) state = "done";
      return { id: st.id, label: mine.length > 1 ? `${st.label} · ${mine.length}` : st.label, state, ms: ms || undefined };
    });
  }, [steps, status, out]);

  const stageSteps = activeStage ? steps.map((e, i) => ({ e, i })).filter(({ e }) => stageOf(e.step) === activeStage) : [];

  const pickStage = (id: string) => {
    if (activeStage === id) { setActiveStage(null); setActiveStep(null); return; }
    setActiveStage(id);
    setActiveStep(null);
    const ids = [...new Set(steps.flatMap((e, i) => (stageOf(e.step) === id ? idsPer[i] ?? [] : [])))];
    if (ids.length) setHighlight(ids);
  };
  const pickStep = (i: number) => {
    if (activeStep === i) { setActiveStep(null); return; }
    setActiveStep(i);
    if (idsPer[i]?.length) setHighlight(idsPer[i]);
  };
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [stageSteps.length]);

  return (
    <div className="pointer-events-none absolute left-0 top-0 z-20" style={{ right: rightInset }}>
      <div className="pointer-events-auto border-b border-rule bg-bg/92 px-6 pb-2 pt-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-semibold text-fg">{SCENARIOS[scenarioIdx]?.title}</h1>
          <span className="font-mono text-[12px] text-muted">{caseId ?? "no case open"}</span>
          {status === "running" && <span className="flex items-center gap-1 text-[12.5px] text-main-ink"><Loader2 size={12} className="animate-spin" /> Agent investigating</span>}
          <span className="ml-auto flex items-baseline gap-3 text-[12.5px] text-fg-2">
            <span><span className={`font-mono tabular-nums ${counter.identifiers ? "text-nomatch-ink" : "text-match-ink"}`}>{counter.identifiers}</span> raw IDs to the model</span>
            <span><span className="font-mono tabular-nums text-fg">{counter.tokens}</span> masked as tokens</span>
            {caseId && status !== "idle" && (
              <button
                type="button"
                onClick={toggleModelView}
                aria-pressed={modelView}
                title="The exact payloads the model received"
                className={`flex h-7 items-center gap-1.5 self-center rounded-[4px] px-2 text-[12.5px] font-medium ${modelView ? "bg-main text-white" : "text-main-ink hover:bg-main-soft"}`}
              >
                {modelView ? <EyeOff size={13} /> : <Eye size={13} />} What the model saw
              </button>
            )}
          </span>
        </div>
        {steps.length > 0 ? (
          <Pipeline stages={stages} variant="compact" selectedId={activeStage ?? undefined} onStageClick={pickStage} className="mt-2" />
        ) : (
          <p className="mt-1 text-[12.5px] text-muted">{status === "idle" ? "The agent's plan, graph queries, model calls and evidence appear here once a case is opened." : "Starting…"}</p>
        )}
      </div>

      {activeStage && stageSteps.length > 0 && (
        <ol ref={listRef} className="scroll-thin pointer-events-auto max-h-[36vh] overflow-y-auto border-b border-rule bg-bg/95 px-4 py-1">
          {stageSteps.map(({ e, i }) => {
            const bad = isBad(e);
            const text: string | undefined = e.data?.text ?? e.data?.purpose ?? e.data?.summary ?? (e.step === "propose_action" ? e.data?.rationale : undefined);
            const q: string | undefined = e.data?.query;
            const on = activeStep === i;
            return (
              <li key={i} className="border-b border-rule last:border-b-0">
                <button type="button" onClick={() => pickStep(i)} aria-pressed={on} className={`flex w-full items-baseline gap-3 rounded-[4px] px-2 py-1.5 text-left text-[13px] ${on ? "bg-main-soft" : "hover:bg-surface-2"}`}>
                  {e.status === "running" ? <Loader2 size={12} className="shrink-0 animate-spin self-center text-main" /> : e.status === "repaired" ? <RotateCw size={12} className="shrink-0 self-center text-match-ink" /> : <span className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${bad ? "bg-nomatch" : "bg-main"}`} />}
                  <span className={`w-[132px] shrink-0 font-medium ${bad ? "text-nomatch-ink" : "text-fg"}`}>
                    {STEP_NAME[e.step] ?? e.step}{e.data?.attempt ? <span className="font-normal text-muted"> #{e.data.attempt}</span> : null}
                  </span>
                  <span className={`min-w-0 flex-1 text-fg-2 ${on ? "" : "truncate"}`}>{text ?? (bad ? e.status : "")}</span>
                  {(idsPer[i]?.length ?? 0) > 0 && <span className="shrink-0 text-[12px] tabular-nums text-muted" title="Entities this step touched">{idsPer[i].length} entities</span>}
                  {e.ms && e.status !== "running" ? <span className="w-12 shrink-0 text-right font-mono text-[11.5px] tabular-nums text-muted">{fmtMs(e.ms)}</span> : null}
                </button>
                {on && q && (
                  <pre className={`scroll-thin mx-2 mb-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[3px] px-2 py-1.5 font-mono text-[11.5px] leading-[1.5] ${e.status === "error" ? "bg-[color-mix(in_srgb,var(--nomatch)_8%,transparent)] text-nomatch-ink" : "bg-surface-2 text-fg-2"}`}>{q}</pre>
                )}
                {on && e.data?.error && <div className="mx-2 mb-2 font-mono text-[12px] text-nomatch-ink">{e.data.error}</div>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- drawer bodies

function ModelView() {
  const egress = useStore((s) => s.egress);
  return (
    <div className="space-y-5">
      <p className="text-[13px] leading-snug text-fg-2">Exact payloads sent through the pseudonymisation gateway. Names, IBANs, phones and fingerprints are tokens; the mapping stays inside the bank.</p>
      {egress.length === 0 && <p className="text-[13px] text-muted">No model calls yet.</p>}
      {egress.map((e, i) => (
        <section key={i} className="border-t border-rule pt-3">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-fg">{e.call}</span>
            <span className="ml-auto truncate font-mono text-[11.5px] text-muted">{e.model} · {e.tokens} tok</span>
          </div>
          <pre className="scroll-thin mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[3px] bg-surface-2 px-2.5 py-2 font-mono text-[11.5px] leading-[1.5] text-fg-2">{e.payload}</pre>
          <div className="mt-1 truncate font-mono text-[11px] text-muted">sha256 {e.sha256}</div>
        </section>
      ))}
    </div>
  );
}

function Integrity({ onPick }: { onPick: (ids: string[]) => void }) {
  const integ = useStore((s) => s.integrity);
  const reverify = useStore((s) => s.reverify);
  if (!integ) return null;
  const changed = (integ.items ?? []).filter((i) => i.status !== "verified").length;
  return (
    <section className="border-t border-rule pt-4">
      <div className="flex items-center gap-2">
        {changed ? <AlertTriangle size={15} className="text-nomatch-ink" /> : <ShieldCheck size={15} className="text-match-ink" />}
        <span className={`text-[14px] font-semibold ${changed ? "text-nomatch-ink" : "text-fg"}`}>
          {changed ? `${changed} evidence item${changed > 1 ? "s" : ""} changed` : "Evidence verified on-chain"}
        </span>
        <button type="button" onClick={reverify} className="ml-auto flex h-7 items-center gap-1 rounded-[4px] px-2 text-[12.5px] font-medium text-main-ink hover:bg-main-soft" title="Recompute the evidence hashes against the signed root">
          <RotateCw size={12} /> Re-verify
        </button>
      </div>
      <div className="mt-0.5 text-[12.5px] text-muted">{integ.verified} of {integ.total} match the signed root · epoch {integ.epoch} · block #{integ.block}</div>
      {(integ.items ?? []).length > 0 && (
        <ul className="-mx-2 mt-2">
          {(integ.items ?? []).map((it) => (
            <li key={(it as any).element_id ?? it.id}>
              <button type="button" onClick={() => onPick([it.id])} className="flex h-8 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[13px] hover:bg-surface-2">
                {it.status === "verified" ? <Check size={13} className="shrink-0 text-match-ink" /> : <X size={13} className="shrink-0 text-nomatch-ink" />}
                <span className={`truncate ${it.status === "verified" ? "text-fg-2" : "font-medium text-nomatch-ink"}`}>{it.label}</span>
                {it.status !== "verified" ? (
                  <span className="ml-auto shrink-0 text-[12px] text-nomatch-ink">changed after epoch {integ.epoch}</span>
                ) : (
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{it.leaf?.slice(0, 8)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[12px] text-muted">T simulates an insider edit · R resets the demo</p>
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
      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-fg">{ring ? "Ring alert needs an investigation" : "Close match needs a second look"}</h3>
        <p className="text-[13.5px] leading-snug text-fg-2">The agent gathers evidence from the graph and recommends an action. You decide.</p>
        <button type="button" onClick={runCase} className="flex h-9 items-center gap-2 rounded-[4px] bg-main px-3.5 text-[13.5px] font-semibold text-white hover:bg-main-ink">
          <FolderOpen size={14} /> Open the case
        </button>
      </div>
    );
  }
  if (payee?.band === "MATCH") return <Outcome tone="match" title="No case needed" body="Name matches. The payment proceeds automatically and the decision is logged." />;
  if (payee?.band === "NO_MATCH") return <Outcome tone="nomatch" title="Held before sending" body="The sender is asked to confirm the account. The hold is logged." />;
  return <p className="text-[13.5px] text-muted">No case open. Run the payee check on the Check tab first.</p>;
}
function Outcome({ tone, title, body }: { tone: "match" | "nomatch"; title: string; body: string }) {
  return (
    <div>
      <div className={`flex items-center gap-2 text-[16px] font-semibold ${tone === "match" ? "text-match-ink" : "text-nomatch-ink"}`}>
        {tone === "match" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {title}
      </div>
      <p className="mt-1 text-[13.5px] leading-snug text-fg-2">{body}</p>
    </div>
  );
}

function Evidence({ onEvidence, activeEv }: { onEvidence: (ids: string[], i: number) => void; activeEv: number | null }) {
  const out = useStore((s) => s.caseOut);
  const status = useStore((s) => s.caseStatus);
  const steps = useStore((s) => s.caseSteps);
  const approve = useStore((s) => s.approve);
  const reject = useStore((s) => s.reject);
  const decided = status === "approved" || status === "rejected";
  const proceed = out?.recommended_action === "proceed";

  if (!out) {
    return status === "idle" ? <NoCase /> : (
      <p className="flex items-center gap-2 text-[13.5px] text-muted"><Loader2 size={13} className="animate-spin" /> Investigating · {steps.length} step{steps.length === 1 ? "" : "s"} so far</p>
    );
  }
  return (
    <div className="space-y-6">
      <section className="line-in">
        <p className="text-[14.5px] leading-[1.6] text-fg">{out.narrative}</p>
        {out.narrative_ur && <p className="urdu mt-1.5 text-[14px] text-fg-2" lang="ur" dir="rtl" style={{ lineHeight: 2 }}>{out.narrative_ur}</p>}
      </section>

      {(out.evidence ?? []).length > 0 && (
        <section className="line-in">
          <Label>Cited evidence · choose one to see it on the graph</Label>
          <ol className="-mx-2">
            {(out.evidence ?? []).map((ev, i) => (
              <li key={i} className="border-b border-rule last:border-b-0">
                <button
                  type="button"
                  onClick={() => onEvidence(ev.node_ids ?? [], i)}
                  aria-pressed={activeEv === i}
                  className={`flex w-full gap-3 rounded-[4px] px-2 py-2.5 text-left text-[13.5px] leading-snug transition-colors ${activeEv === i ? "bg-main-soft text-fg" : "text-fg-2 hover:bg-surface-2"}`}
                >
                  <span className="w-4 shrink-0 font-mono text-[11.5px] leading-[20px] text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1">{ev.claim}</span>
                  {(ev.node_ids ?? []).length > 0 && <span className="shrink-0 text-[12px] tabular-nums text-muted">{ev.node_ids.length}</span>}
                </button>
              </li>
            ))}
          </ol>
          {out.open_questions && out.open_questions.length > 0 && <p className="mt-2 text-[12.5px] leading-snug text-muted">Open questions: {out.open_questions.join(" ")}</p>}
        </section>
      )}

      <Integrity onPick={(ids) => onEvidence(ids, -1)} />

      <section className="border-t border-rule pt-4">
        <div className="flex items-baseline gap-3">
          <Label>Recommendation</Label>
          <span className={`ml-auto text-[12.5px] font-semibold ${RISK_INK[out.risk] ?? "text-fg"}`}>{out.risk} risk</span>
          <span className="text-[12.5px] tabular-nums text-muted">{Math.round(out.confidence * 100)}% confident</span>
        </div>
        <div className={`text-[17px] font-semibold leading-snug ${proceed ? "text-match-ink" : "text-nomatch-ink"}`}>{ACTION_LABEL[out.recommended_action] ?? out.recommended_action}</div>
        {decided ? (
          <p className={`mt-3 flex items-center gap-2 text-[13.5px] font-semibold ${status === "approved" ? "text-match-ink" : "text-fg-2"}`}>
            {status === "approved" ? <><Check size={14} /> Approved · anchored on-chain</> : <><X size={14} /> Rejected · logged</>}
          </p>
        ) : (
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={approve} disabled={status !== "ready"} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-[4px] bg-main text-[14px] font-semibold text-white hover:bg-main-ink disabled:opacity-50">
              {status === "approving" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve
            </button>
            <button type="button" onClick={reject} disabled={status !== "ready"} className="flex h-10 w-28 items-center justify-center gap-2 rounded-[4px] border border-rule bg-bg text-[14px] font-medium text-fg-2 hover:border-nomatch hover:text-nomatch-ink disabled:opacity-50">
              <X size={14} /> Reject
            </button>
          </div>
        )}
      </section>
    </div>
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
  const modelView = useStore((s) => s.modelView);
  const toggleModelView = useStore((s) => s.toggleModelView);
  const setStoreHighlight = useStore((s) => s.setHighlight);
  const active = useStore((s) => s.view) === "investigate";

  const caseExtra = useGraphStore((s) => s.caseExtra);
  const gHighlight = useGraphStore((s) => s.highlight);
  const selection = useGraphStore((s) => s.selection);
  const selScope = useGraphStore((s) => s.selScope);
  const inspector = useGraphStore((s) => s.inspector);
  const gFocus = useGraphStore((s) => s.focus);
  const pathFrom = useGraphStore((s) => s.pathFrom);
  const qerror = useGraphStore((s) => s.qerror);
  const select = useGraphStore((s) => s.select);
  const clearSelection = useGraphStore((s) => s.clearSelection);
  const pathTo = useGraphStore((s) => s.pathTo);
  const resetCase = useGraphStore((s) => s.resetCase);

  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [activeEv, setActiveEv] = useState<number | null>(null);
  const [colourBy, setColourBy] = useState<ColourBy>("kind");
  const [drawer, setDrawer] = useState(true);

  const base = useMemo(() => adaptCy(graph, SCENARIOS[scenarioIdx]?.key), [graph, scenarioIdx]);
  const data = useMemo(() => (caseExtra.nodes.length ? mergeData(base, caseExtra) : base), [base, caseExtra]);
  const resolve = useMemo(() => resolver(data), [data]);

  // New scenario / graph: drop anything explored on top of the old one.
  useEffect(() => { resetCase(); setActiveStage(null); setActiveStep(null); setActiveEv(null); }, [graph, scenarioIdx, resetCase]);
  useEffect(() => { if (caseSteps.length === 0) { setActiveStage(null); setActiveStep(null); } }, [caseSteps.length]);
  useEffect(() => { setActiveEv(null); if (caseOut) setDrawer(true); }, [caseOut]);
  useEffect(() => { if (modelView) setDrawer(true); }, [modelView]);
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
  const drawerOpen = (drawer || !!mine) && active;
  const inset = drawerOpen ? DRAWER_W : 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const insTitle = useMemo(() => inspectorTitle(data), [mine, inspector.node?.kind, data]);

  const onNodeClick = useCallback((n: GNode) => {
    if (pathFrom && pathFrom !== n.id) { pathTo(n.id, data, "case"); return; }
    const nb = data.links.flatMap((l) => (endId(l.source) === n.id ? [endId(l.target)] : endId(l.target) === n.id ? [endId(l.source)] : []));
    setStoreHighlight([n.id, ...nb]);
    select({ type: "node", id: n.id }, data, "case");
  }, [pathFrom, pathTo, data, setStoreHighlight, select]);
  const onLinkClick = useCallback((l: GLink) => {
    setStoreHighlight([endId(l.source), endId(l.target)]);
    select({ type: "link", id: l.id, rel: l.rel, source: endId(l.source), target: endId(l.target) }, data, "case");
  }, [data, setStoreHighlight, select]);

  // Evidence row: highlight its entities and fit the view to them; if it names exactly one linked pair, explain that link.
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
  }, [resolve, data, setStoreHighlight, select]);

  const closeDrawer = () => {
    if (mine) { clearSelection(); return; } // Esc / ✕ on a detail goes back to the evidence
    if (modelView) { toggleModelView(); return; }
    setDrawer(false);
  };
  const title = mine ? insTitle : modelView ? "What the model saw" : "Evidence and decision";

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg" aria-label="Case graph">
      <div className="absolute inset-0">
        {data.nodes.length ? (
          <Graph2D
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
            rightInset={inset}
            topInset={activeStage ? 260 : 96}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-muted">{graph ? "This case has no graph neighbourhood." : "Loading the case graph…"}</div>
        )}
      </div>

      <AgentStrip data={data} activeStage={activeStage} setActiveStage={setActiveStage} activeStep={activeStep} setActiveStep={setActiveStep} rightInset={inset} />

      <div className="absolute bottom-3 left-6 z-10">
        <Legend colourBy={colourBy} setColourBy={setColourBy} modes={["kind", "bank"]} />
      </div>
      {(pathFrom || qerror) && (
        <div className="pointer-events-none absolute bottom-3 z-10 -translate-x-1/2 text-center text-[12.5px]" style={{ left: `calc((100% - ${inset}px) / 2)` }}>
          {pathFrom ? <span className="bg-bg px-2 font-medium text-fg"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent" />Pick the second entity for the path</span> : <span className="bg-bg/90 px-2 text-fg-2">{qerror}</span>}
        </div>
      )}

      {!drawerOpen && active && (
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className="absolute right-4 top-[84px] z-20 flex h-8 items-center gap-1.5 rounded-[4px] border border-rule bg-bg px-2.5 text-[13px] font-medium text-fg-2 hover:border-main/50 hover:text-main-ink"
        >
          <PanelRightOpen size={14} /> Evidence
        </button>
      )}

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={title}
        width={DRAWER_W}
        modal={false}
        actions={mine ? (
          <button type="button" onClick={clearSelection} className="flex h-8 items-center gap-1 rounded-[4px] px-2 text-[12.5px] font-medium text-main-ink hover:bg-main-soft">
            <ArrowLeft size={13} /> Evidence
          </button>
        ) : modelView ? (
          <button type="button" onClick={toggleModelView} className="flex h-8 items-center gap-1 rounded-[4px] px-2 text-[12.5px] font-medium text-main-ink hover:bg-main-soft">
            <ArrowLeft size={13} /> Evidence
          </button>
        ) : null}
      >
        {mine ? <Inspector data={data} scope="case" /> : modelView ? <ModelView /> : <Evidence onEvidence={onEvidence} activeEv={activeEv} />}
      </Drawer>
    </div>
  );
}
