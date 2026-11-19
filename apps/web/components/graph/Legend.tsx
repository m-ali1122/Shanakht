"use client";
import type { ColourBy } from "@/lib/graphStore";
import { ACCENT, BANK, BANK_NAME, KIND_COLOR, KIND_LABEL, NOMATCH, REL_COLOR, REL_LABEL, SCENARIO_COLOR, type Kind } from "@/lib/palette";

/** Small SVG stand-in for each node shape used in the 3D graph. */
export function KindGlyph({ kind, color, size = 11 }: { kind: Kind | string; color?: string; size?: number }) {
  const c = color ?? KIND_COLOR[kind as Kind] ?? "#888";
  const s = size;
  const common = { width: s, height: s, viewBox: "0 0 10 10", "aria-hidden": true } as const;
  switch (kind) {
    case "remitter": return <svg {...common}><path d="M5 0.4 L9.6 5 L5 9.6 L0.4 5Z" fill={c} /></svg>;
    case "account": return <svg {...common}><rect x="1" y="1" width="8" height="8" rx="1.2" fill={c} /></svg>;
    case "person": return <svg {...common}><circle cx="5" cy="5" r="4.6" fill={c} /></svg>;
    case "record": return <svg {...common}><circle cx="5" cy="5" r="3.2" fill={c} /></svg>;
    case "phone": return <svg {...common}><path d="M5 1 L9 8.6 H1Z" fill={c} /></svg>;
    case "device": return <svg {...common}><path d="M5 9 L9 1.4 H1Z" fill={c} /></svg>;
    case "fingerprint": return <svg {...common}><path d="M5 0.8 L9 3.2 V6.8 L5 9.2 L1 6.8 V3.2Z" fill="none" stroke={c} strokeWidth="1.2" /></svg>;
    case "decision": return <svg {...common}><path d="M5 0.6 L9.4 3.8 L7.7 9 H2.3 L0.6 3.8Z" fill={c} /></svg>;
    default: return <svg {...common}><circle cx="5" cy="5" r="3" fill={c} /></svg>;
  }
}

const KINDS_SHOWN: Kind[] = ["remitter", "account", "record", "person", "phone", "device", "fingerprint"];

export default function Legend({ colourBy, rels = true }: { colourBy: ColourBy; rels?: boolean }) {
  return (
    <div className="pointer-events-none flex max-w-[560px] flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-sm)] border border-rule bg-surface/85 px-2.5 py-1.5 text-[11.5px] text-fg-2 backdrop-blur-sm">
      {KINDS_SHOWN.map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <KindGlyph kind={k} color={colourBy === "kind" ? undefined : "#8A90AA"} />
          {KIND_LABEL[k]}
        </span>
      ))}
      {colourBy === "bank" &&
        Object.entries(BANK).map(([b, c]) => (
          <span key={b} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: c }} />
            {BANK_NAME[b]?.split(" ")[0] ?? b}
          </span>
        ))}
      {colourBy === "scenario" &&
        Object.entries(SCENARIO_COLOR).slice(0, 5).map(([s, c]) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: c }} />
            Case {s.slice(1)}
          </span>
        ))}
      {rels && (
        <span className="flex items-center gap-2">
          {(["SENT", "RESOLVES_TO", "USES_PHONE", "HAS_FP", "SAME_AS"] as const).map((r) => (
            <span key={r} className="flex items-center gap-1">
              <span className="h-[2px] w-3 rounded" style={{ background: REL_COLOR[r] }} />
              {REL_LABEL[r]}
            </span>
          ))}
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: ACCENT, opacity: 0.85 }} />
        In focus
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: NOMATCH }} />
        Ring / changed
      </span>
    </div>
  );
}
