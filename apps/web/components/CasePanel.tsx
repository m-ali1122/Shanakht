"use client";
import { useEffect, useRef } from "react";
import { Check, X, ChevronRight, Loader2, Eye, EyeOff, RotateCw } from "lucide-react";
import { useStore } from "@/lib/store";
import type { StepEvent } from "@/lib/types";

const ACTION_LABEL: Record<string, string> = {
  proceed: "Proceed",
  hold: "Hold this payment for review",
  hold_and_publish: "Hold pending review; publish fingerprints to consortium registry",
};

function StepLine({ e }: { e: StepEvent }) {
  const color =
    e.status === "error" || e.status === "blocked" || e.status === "excluded" ? "text-nomatch" : e.status === "repaired" ? "text-match" : e.status === "running" ? "text-accent" : "text-ink-2";
  const status = e.status === "running" ? "…" : e.status;
  const q: string | undefined = e.data?.query;
  const text: string | undefined = e.data?.text ?? e.data?.summary;
  return (
    <div className="line-in py-[3px]">
      <div className={`mono flex items-baseline gap-1 text-[12px] ${color}`}>
        <ChevronRight size={11} className="shrink-0 translate-y-[1px]" />
        <span className="font-medium">{e.step}</span>
        {e.data?.attempt ? <span className="text-muted">attempt {e.data.attempt}</span> : null}
        <span>{status}</span>
        {e.ms && e.status !== "running" ? <span className="ml-auto text-muted">{e.ms}ms</span> : null}
      </div>
      {q && e.status !== "running" && (
        <pre className={`mono mt-1 whitespace-pre-wrap break-words rounded-[var(--radius)] border px-2 py-1.5 text-[11px] leading-[1.45] ${e.status === "error" ? "border-nomatch/40 text-nomatch" : e.status === "repaired" ? "border-match/40 text-ink-2" : "border-rule text-ink-2"}`}>
          {q}
        </pre>
      )}
      {e.data?.error && <div className="mono mt-1 pl-4 text-[11px] text-nomatch">{e.data.error}</div>}
      {text && <div className="mt-[2px] pl-4 text-[12px] text-ink-2">{text}</div>}
    </div>
  );
}

function IntegrityBlock() {
  const integ = useStore((s) => s.integrity);
  const reverify = useStore((s) => s.reverify);
  const setHighlight = useStore((s) => s.setHighlight);
  if (!integ) return null;
  const changed = (integ.items ?? []).filter((i) => i.status !== "verified").length;
  return (
    <div className="mt-3 border-t border-rule pt-3">
      <div className="flex items-baseline gap-2">
        <span className="label">Integrity</span>
        <span className={`mono text-[12px] ${changed ? "text-nomatch" : "text-ink-2"}`}>
          {integ.verified} of {integ.total} evidence items verified · epoch {integ.epoch} · block {integ.block}
        </span>
        <button onClick={reverify} className="ml-auto flex items-center gap-1 text-[12px] text-accent hover:underline">
          <RotateCw size={11} /> Re-verify
        </button>
      </div>
      <ul className="mt-1.5 grid grid-cols-1 gap-[2px]">
        {(integ.items ?? []).map((it) => (
          <li key={(it as any).element_id ?? it.id}>
            <button onClick={() => setHighlight([it.id])} className="flex w-full items-center gap-1.5 text-left text-[12px] hover:text-accent">
              {it.status === "verified" ? <Check size={12} className="shrink-0 text-match" /> : <X size={12} className="shrink-0 text-nomatch" />}
              <span className={`truncate ${it.status === "verified" ? "text-ink-2" : "text-nomatch"}`}>{it.label}</span>
              {it.status !== "verified" ? (
                <span className="ml-auto shrink-0 text-[11px] text-nomatch">changed after epoch {integ.epoch}</span>
              ) : (
                <span className="mono ml-auto shrink-0 text-[10px] text-muted">{it.leaf.slice(0, 10)}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModelView() {
  const egress = useStore((s) => s.egress);
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-ink-2">Exact payloads sent through the pseudonymization gateway. Names, IBANs, phones and fingerprints are tokens; the mapping vault stays inside the bank.</p>
      {egress.length === 0 && <p className="text-[12px] text-muted">No model calls yet.</p>}
      {egress.map((e, i) => (
        <div key={i} className="rounded-[var(--radius)] border border-rule">
          <div className="flex items-baseline gap-2 border-b border-rule px-2 py-1">
            <span className="text-[12px] font-medium text-ink">{e.call}</span>
            <span className="mono ml-auto text-[10px] text-muted">{e.provider} · {e.model} · {e.tokens} tok</span>
          </div>
          <pre className="mono max-h-40 overflow-auto whitespace-pre-wrap break-words px-2 py-1.5 text-[11px] leading-[1.45] text-ink-2 scroll-thin">{e.payload}</pre>
          <div className="mono border-t border-rule px-2 py-1 text-[10px] text-muted">sha256 {e.sha256}</div>
        </div>
      ))}
    </div>
  );
}

export default function CasePanel() {
  const steps = useStore((s) => s.caseSteps);
  const out = useStore((s) => s.caseOut);
  const status = useStore((s) => s.caseStatus);
  const caseId = useStore((s) => s.caseId);
  const modelView = useStore((s) => s.modelView);
  const toggleModelView = useStore((s) => s.toggleModelView);
  const approve = useStore((s) => s.approve);
  const reject = useStore((s) => s.reject);
  const runCase = useStore((s) => s.runCase);
  const setHighlight = useStore((s) => s.setHighlight);
  const payee = useStore((s) => s.payee);
  const ring = useStore((s) => s.ringAlert);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [steps.length]);

  const canOpen = !!caseId && status === "idle" && (ring || (payee && payee.band === "CLOSE"));

  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-rule bg-surface">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-rule px-4">
        <span className="label">Case</span>
        {caseId && <span className="mono text-[11px] text-muted">{caseId}</span>}
        {status === "running" && <Loader2 size={12} className="animate-spin text-accent" />}
        {caseId && status !== "idle" && (
          <button onClick={toggleModelView} className="ml-auto flex items-center gap-1 text-[12px] text-accent hover:underline" aria-pressed={modelView}>
            {modelView ? <EyeOff size={12} /> : <Eye size={12} />} What the model saw
          </button>
        )}
      </div>

      <div ref={logRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {status === "idle" && !out && (
          <div className="text-[13px] text-muted">
            {canOpen ? (
              <button onClick={runCase} className="rounded-[var(--radius)] border border-accent px-3 py-1.5 text-[13px] text-accent hover:bg-accent hover:text-surface">
                Open case
              </button>
            ) : payee?.band === "MATCH" ? (
              "Match. Payment proceeds automatically; no case needed."
            ) : payee?.band === "NO_MATCH" ? (
              "No match. Payment held before sending; the sender is asked to confirm the account."
            ) : (
              "Close matches and ring alerts open a case here. The agent gathers evidence and recommends; an analyst decides."
            )}
          </div>
        )}

        {modelView ? (
          <ModelView />
        ) : (
          <>
            {steps.length > 0 && <div className="label mb-1">Step log</div>}
            {steps.map((e, i) => <StepLine key={i} e={e} />)}

            {out && (
              <div className="mt-3 border-t border-rule pt-3 line-in">
                <div className="label mb-1">Narrative</div>
                <p className="text-[13px] leading-[1.55] text-ink">{out.narrative}</p>
                {out.narrative_ur && <p className="urdu mt-1 text-[14px] text-ink-2" lang="ur" style={{ lineHeight: 2.1 }}>{out.narrative_ur}</p>}

                <div className="label mb-1 mt-3">Evidence</div>
                <ul className="space-y-1.5">
                  {(out.evidence ?? []).map((ev, i) => (
                    <li key={i} className="text-[12px] leading-snug text-ink-2">
                      <span>{ev.claim}</span>
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {(ev.node_ids ?? []).map((id) => (
                          <button key={id} onClick={() => setHighlight(ev.node_ids)} className="mono rounded-[3px] border border-rule px-1 text-[10px] text-accent hover:border-accent">
                            {id.length > 14 ? "··" + id.slice(-6) : id}
                          </button>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
                {out.open_questions && out.open_questions.length > 0 && (
                  <p className="mt-2 text-[12px] italic text-muted">Open: {out.open_questions.join(" ")}</p>
                )}
                <IntegrityBlock />
              </div>
            )}
          </>
        )}
      </div>

      {out && (
        <div className="shrink-0 border-t border-rule px-4 py-3">
          <div className="flex items-baseline justify-between">
            <span className="label">Recommended action</span>
            <span className="mono text-[11px] text-muted">risk {out.risk} · conf {out.confidence.toFixed(2)}</span>
          </div>
          <div className={`mt-1 font-serif text-[16px] leading-snug ${out.recommended_action === "proceed" ? "text-match" : "text-nomatch"}`}>
            {ACTION_LABEL[out.recommended_action]}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={approve}
              disabled={status !== "ready"}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] bg-accent text-[13px] font-medium text-surface hover:opacity-90 disabled:opacity-50"
            >
              {status === "approving" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {status === "approved" ? "Approved · anchored" : "Approve"}
            </button>
            <button
              onClick={reject}
              disabled={status !== "ready"}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-rule text-[13px] font-medium text-ink-2 hover:border-nomatch hover:text-nomatch disabled:opacity-50"
            >
              <X size={14} /> {status === "rejected" ? "Rejected" : "Reject"}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
