"use client";
/**
 * Pipeline — a horizontal, left→right line of stages with a marker that travels to the
 * current stage (console v3). Used by the Check tab (payee check / ring / voice) and may be
 * imported by Investigate for the agent pipeline.
 *
 * Props
 *   stages: PipelineStage[]
 *     id:       string
 *     label:    string                                 — short stage name ("Title fetched")
 *     state:    "pending" | "active" | "done" | "error"
 *     ms?:      number                                 — live timing shown under the label
 *     detail?:  ReactNode                              — the stage's real output, revealed beneath it
 *                                                        once the stage is not pending
 *     tone?:    string                                 — CSS colour for the node/label when reached
 *                                                        (e.g. "var(--nomatch)" on the verdict stage)
 *     emphasis?: boolean                               — the visual peak (larger label/node)
 *   variant?:   "hero" | "compact"   — hero (default): big nodes, details below each stage.
 *                                       compact: one thin line, labels only, for an edge strip.
 *   selectedId?: string               — highlighted stage (e.g. clicked agent step)
 *   onStageClick?: (id: string) => void — makes stages buttons (keyboard reachable)
 *   className?: string
 *
 * Visual: a 1px rule joins stage nodes; the done part of the rule is cobalt; a lime marker
 * (fill only) slides to the frontier (last non-pending stage). Pending = muted outline,
 * active = cobalt ring + pulse, done = cobalt dot, error = red. No boxes.
 * Reduced motion: no slide/pulse; positions jump.
 */
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

export type StageState = "pending" | "active" | "done" | "error";
export interface PipelineStage {
  id: string;
  label: string;
  state: StageState;
  ms?: number;
  detail?: ReactNode;
  tone?: string;
  emphasis?: boolean;
}
export interface PipelineProps {
  stages: PipelineStage[];
  variant?: "hero" | "compact";
  selectedId?: string;
  onStageClick?: (id: string) => void;
  className?: string;
}

export function fmtMs(ms?: number) {
  if (ms == null || !isFinite(ms)) return "";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function Pipeline({ stages, variant = "hero", selectedId, onStageClick, className = "" }: PipelineProps) {
  const reduce = useReducedMotion();
  const n = Math.max(stages.length, 1);
  let frontier = -1;
  stages.forEach((s, i) => { if (s.state !== "pending") frontier = i; });
  const anyActive = stages.some((s) => s.state === "active");
  const hero = variant === "hero";
  const node = hero ? 14 : 10;
  const top = hero ? 7 : 5; // y of the rule (centre of node)
  const half = 50 / n; // % from edge to first/last node centre
  const span = 100 - 2 * half;
  const fillPct = frontier <= 0 ? 0 : (frontier / (n - 1)) * span;
  const markerLeft = frontier < 0 ? half : half + (n > 1 ? (frontier / (n - 1)) * span : 0);
  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 140, damping: 22 };

  return (
    <div className={`relative w-full ${className}`}>
      {/* rule */}
      <div className="pointer-events-none absolute h-px bg-rule" style={{ left: `${half}%`, right: `${half}%`, top }} aria-hidden />
      <motion.div
        className="pointer-events-none absolute h-[2px] bg-main"
        style={{ left: `${half}%`, top: top - 0.5 }}
        initial={false}
        animate={{ width: `${fillPct}%` }}
        transition={spring}
        aria-hidden
      />
      {frontier >= 0 && (
        <motion.div
          className="pointer-events-none absolute z-10 rounded-full bg-accent"
          style={{ width: node + 10, height: node + 10, top: top - (node + 10) / 2, marginLeft: -(node + 10) / 2, opacity: 0.85 }}
          initial={false}
          animate={{ left: `${markerLeft}%`, scale: anyActive && !reduce ? [1, 1.25, 1] : 1 }}
          transition={{ left: spring, scale: { duration: 1.2, repeat: anyActive && !reduce ? Infinity : 0 } }}
          aria-hidden
        />
      )}
      <ol className="relative z-20 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-label="Pipeline">
        {stages.map((s, i) => {
          const reached = s.state !== "pending";
          const color = s.state === "error" ? "var(--nomatch)" : s.tone ?? "var(--main)";
          const sel = selectedId === s.id;
          const Tag = onStageClick ? "button" : "div";
          return (
            <li key={s.id} className="flex min-w-0 flex-col items-center text-center" aria-current={s.state === "active" ? "step" : undefined}>
              <Tag
                {...(onStageClick ? { type: "button" as const, onClick: () => onStageClick(s.id) } : {})}
                className={`flex flex-col items-center rounded-[4px] px-1.5 ${onStageClick ? "hover:bg-surface-2" : ""} ${sel ? "bg-main-soft" : ""}`}
              >
                <span
                  className="block shrink-0 rounded-full transition-colors"
                  style={{
                    width: s.emphasis && hero ? node + 4 : node,
                    height: s.emphasis && hero ? node + 4 : node,
                    marginTop: s.emphasis && hero ? -2 : 0,
                    background: s.state === "done" || s.state === "error" ? color : "var(--bg)",
                    border: `${s.state === "active" ? 3 : 1.5}px solid ${reached ? color : "var(--rule)"}`,
                  }}
                  aria-hidden
                />
                <span
                  className={`mt-2 leading-tight ${hero ? (s.emphasis ? "text-[14px] font-semibold" : "text-[13px] font-medium") : "text-[12px] font-medium"}`}
                  style={{ color: reached ? (s.tone && s.state === "done" ? s.tone : "var(--fg)") : "var(--muted)" }}
                >
                  {s.label}
                </span>
                <span className="mono mt-0.5 h-4 text-[11px] tabular-nums text-muted">
                  {s.state === "active" ? (s.ms != null ? fmtMs(s.ms) : "…") : reached ? fmtMs(s.ms) : ""}
                </span>
              </Tag>
              {hero && (
                <div className="mt-3 w-full min-w-0 px-2 text-left">
                  {reached && s.detail != null && (
                    <motion.div
                      initial={reduce ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: reduce ? 0 : 0.05 * (i % 2) }}
                    >
                      {s.detail}
                    </motion.div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default Pipeline;
