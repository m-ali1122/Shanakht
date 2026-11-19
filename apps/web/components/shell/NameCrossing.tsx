"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { AlignmentItem } from "@/lib/types";
import { reasonText } from "@/lib/guide";
import { BAND_FILL, BAND_INK, BAND_WORD, tint } from "./bits";

/** Plain words for a line between a typed token and a title token. */
function pairWord(it: AlignmentItem & { urdu_token?: string }): string | null {
  if (it.relation === "exact") return null;
  if (it.relation === "initial") return "short form";
  if (it.relation === "transliterated") return it.urdu_token ? "spelling, via Urdu" : "spelling";
  if (it.relation === "variant") return "spelling";
  return it.relation;
}
/** Plain words for a token with no partner on the other side. */
function loneWord(it: AlignmentItem): string {
  switch (it.reason) {
    case "PATRONYMIC_DROPPED": return "father’s name, dropped";
    case "TITLE_DROPPED": return "honorific, not typed";
    case "TITLE_ADDED": return "honorific";
    case "SURNAME_MISSING": return "no partner";
    default: return it.typed_token !== null ? "no partner" : "not typed";
  }
}

type Line = { x1: number; y1: number; x2: number; y2: number; kind: "exact" | "near" | "lone"; label?: string | null; urdu?: string; dot?: number; ly?: number };

export interface CrossingData {
  typed: string;
  title: string | null;
  urdu?: string | null;
  alignment: AlignmentItem[] | null;
  band?: string | null;
  score?: number | null;
  reasons: string[];
  banner?: string | null;
  explain?: { en?: string; ur?: string } | null;
  bank: string;
  looking: boolean; // title lookup in flight
}

const GAP = 112;

export default function NameCrossing({ d }: { d: CrossingData }) {
  const wrap = useRef<HTMLDivElement>(null);
  const top = useRef<(HTMLSpanElement | null)[]>([]);
  const bot = useRef<(HTMLSpanElement | null)[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // Top row: typed order. Bottom row: account-title order (so swapped names visibly cross).
  const items = d.alignment ?? [];
  const typedItems = items.length ? items.filter((i) => i.typed_token !== null) : d.typed.split(/\s+/).map((t) => ({ typed_token: t, title_token: null, relation: "extra" as const }));
  const titleWords = (d.title ?? "").split(/\s+/).filter(Boolean);
  const titleItems = items.length
    ? items.filter((i) => i.title_token !== null).sort((a, b) => titleWords.indexOf(a.title_token!.toUpperCase()) - titleWords.indexOf(b.title_token!.toUpperCase()))
    : titleWords.map((t) => ({ typed_token: null, title_token: t, relation: "extra" as const }));
  const aligned = items.length > 0;
  const anyPair = items.some((i) => i.typed_token !== null && i.title_token !== null);
  const scriptAnchor = d.reasons.includes("SCRIPT_CONVERTED");

  useLayoutEffect(() => {
    const measure = () => {
      const b = wrap.current?.getBoundingClientRect();
      if (!b) return;
      setBox({ w: b.width, h: b.height });
      if (!aligned) { setLines([]); return; }
      const out: Line[] = [];
      const rel = (r: DOMRect) => ({ cx: r.left + r.width / 2 - b.left, top: r.top - b.top, bottom: r.bottom - b.top });
      items.forEach((it) => {
        const ti = typedItems.indexOf(it as never);
        const bi = titleItems.indexOf(it as never);
        const a = ti >= 0 ? top.current[ti]?.getBoundingClientRect() : undefined;
        const c = bi >= 0 ? bot.current[bi]?.getBoundingClientRect() : undefined;
        if (a && c) {
          const A = rel(a), C = rel(c);
          out.push({ x1: A.cx, y1: A.bottom + 6, x2: C.cx, y2: C.top - 6, kind: it.relation === "exact" ? "exact" : "near", label: pairWord(it), urdu: (it as { urdu_token?: string }).urdu_token });
        } else if (a && anyPair) {
          const A = rel(a);
          out.push({ x1: A.cx, y1: A.bottom + 6, x2: A.cx, y2: A.bottom + 34, kind: "lone", label: loneWord(it), dot: A.bottom + 34, ly: A.bottom + 50 });
        } else if (c && anyPair) {
          const C = rel(c);
          out.push({ x1: C.cx, y1: C.top - 34, x2: C.cx, y2: C.top - 6, kind: "lone", label: loneWord(it), dot: C.top - 34, ly: C.bottom + 14 });
        }
      });
      setLines(out);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.alignment, d.title, d.typed]);

  const band = d.band ?? null;
  const typedClass = (it: AlignmentItem) =>
    aligned && it.title_token === null ? (anyPair ? "text-muted line-through decoration-2 decoration-[var(--muted)]" : "text-fg") : "text-fg";

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-center gap-4">
      {/* the verdict column mirrors on the left so the names stay centred */}
      <div className="w-[168px] shrink-0 max-[1500px]:hidden" aria-hidden />
      <div ref={wrap} className="relative min-w-0 max-w-[640px] flex-1 select-none">
        {/* lines */}
        <svg width={box.w} height={box.h} className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
          {lines.map((l, i) => (
            <g key={i} className="line-in" style={{ animationDelay: `${i * 70}ms` }}>
              <line
                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                stroke={l.kind === "exact" ? "var(--match)" : l.kind === "near" ? "var(--close)" : "var(--muted)"}
                strokeWidth={l.kind === "lone" ? 1.5 : 2}
                strokeDasharray={l.kind === "exact" ? undefined : l.kind === "near" ? "5 5" : "2 4"}
                strokeLinecap="round"
              />
              {l.dot != null && <circle cx={l.x2} cy={l.dot} r={2.5} fill="var(--muted)" />}
            </g>
          ))}
        </svg>
        {lines.map((l, i) =>
          l.label ? (
            <span
              key={"l" + i}
              className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium line-in ${
                l.kind === "near" ? "border-close/40 bg-bg text-close-ink" : "border-rule bg-bg text-muted"
              }`}
              style={{ left: (l.x1 + l.x2) / 2, top: l.ly ?? (l.y1 + l.y2) / 2, animationDelay: `${i * 70 + 120}ms` }}
            >
              {l.label}
              {l.urdu && <span className="urdu ml-1.5 text-[13px] text-fg" lang="ur" style={{ lineHeight: 1 }}>{l.urdu}</span>}
            </span>
          ) : null,
        )}

        {/* typed name */}
        <div className="mb-1 text-center text-[12px] text-muted">Sent as</div>
        <div className="flex flex-wrap items-baseline justify-center gap-x-12 gap-y-2">
          {typedItems.map((it, i) => (
            <span key={"t" + i} ref={(el) => { top.current[i] = el; }} className={`text-[30px] font-semibold leading-tight tracking-[-0.01em] ${typedClass(it)}`}>
              {it.typed_token}
            </span>
          ))}
        </div>

        <div style={{ height: GAP }} className="relative flex items-center justify-center">
          {aligned && !anyPair && (
            <span className="rounded-full border border-nomatch/50 bg-bg px-3 py-1 text-[13px] font-medium text-nomatch-ink line-in">No name in common</span>
          )}
        </div>

        {/* account title */}
        <div className="flex min-h-[40px] flex-wrap items-baseline justify-center gap-x-12 gap-y-2">
          {d.title ? (
            titleItems.map((it, i) => (
              <span
                key={"b" + i}
                ref={(el) => { bot.current[i] = el; }}
                className={`text-[26px] font-medium uppercase leading-tight tracking-[0.03em] ${aligned && it.typed_token === null && anyPair ? "text-muted" : "text-fg"}`}
              >
                {it.title_token}
              </span>
            ))
          ) : (
            <span className="flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-rule px-4 text-[14px] text-muted">
              {d.looking && <Loader2 size={14} className="animate-spin" />}
              {d.looking ? `Looking up the title at ${d.bank}…` : `Title at ${d.bank} not looked up yet`}
            </span>
          )}
        </div>
        <div className={`${lines.some((l) => l.kind === "lone" && l.dot === l.y1) ? "mt-8" : "mt-1"} text-center text-[12px] text-muted`}>Account title at {d.bank}</div>

        {d.urdu && (
          <div className={`mx-auto mt-4 flex w-fit items-center gap-4 rounded-[var(--radius)] px-4 py-1 ${scriptAnchor ? "border border-close/40" : ""}`} style={scriptAnchor ? { background: tint("var(--close)", 8) } : undefined}>
            <span className="text-[12px] text-muted">{scriptAnchor ? "Both spellings resolve to the KYC name" : "KYC name"}</span>
            <span className="urdu text-[26px] text-fg" lang="ur" style={{ lineHeight: 2 }}>{d.urdu}</span>
          </div>
        )}
      </div>
      <div className="w-[168px] shrink-0" style={{ paddingTop: 18 + 40 + GAP / 2 - 28 }}>
        {band && (
          <div
            key={band}
            className="stamp-in flex w-fit flex-col items-center rounded-[8px] border-2 px-4 py-2"
            style={{ borderColor: BAND_FILL[band], color: BAND_INK[band], background: tint(BAND_FILL[band], 8) }}
          >
            <span className="whitespace-nowrap text-[17px] font-bold uppercase leading-none tracking-[0.06em]">{BAND_WORD[band]}</span>
            {d.score != null && <span className="mt-1 font-mono text-[12px] leading-none opacity-90">score {d.score.toFixed(2)}</span>}
          </div>
        )}
      </div>
      </div>

      {(d.banner || d.reasons.length > 0 || d.explain?.en) && band && (
        <div className="mx-auto mt-6 w-full max-w-[640px] line-in">
          {d.banner && (
            <div className="mb-3 flex gap-2.5 rounded-[var(--radius-sm)] border border-nomatch/50 px-3 py-2 text-[14px] font-medium leading-snug text-nomatch-ink" style={{ background: tint("var(--nomatch)", 8) }}>
              <AlertTriangle size={16} className="mt-[2px] shrink-0" />
              {d.banner}
            </div>
          )}
          {d.reasons.length > 0 && (
            <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1">
              {d.reasons.map((c) => (
                <li key={c} className="flex items-center gap-2 text-[14px] text-fg-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: BAND_FILL[band] }} />
                  {reasonText(c)}
                </li>
              ))}
            </ul>
          )}
          {d.explain?.en && <p className="mt-3 text-center text-[14px] leading-snug text-fg-2">{d.explain.en}</p>}
          {d.explain?.ur && <p className="urdu mt-1 text-center text-[16px] text-fg-2" lang="ur" style={{ lineHeight: 2.1, direction: "rtl" }}>{d.explain.ur}</p>}
        </div>
      )}
    </div>
  );
}
