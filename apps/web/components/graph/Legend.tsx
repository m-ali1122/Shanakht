"use client";
// Tiny plain-text key for the 2D graph, collapsible, with the colour-by switch.
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ColourBy } from "@/lib/graphStore";
import { ACCENT, BANK, BANK_NAME, KIND_COLOR, KIND_LABEL, MUTED, NOMATCH, SCENARIO_COLOR, type Kind } from "@/lib/palette";

/** Small SVG stand-in for each node mark drawn on the graph canvas. */
export function KindGlyph({ kind, color, size = 11 }: { kind: Kind | string; color?: string; size?: number }) {
  const c = color ?? KIND_COLOR[kind as Kind] ?? MUTED;
  const s = size;
  const common = { width: s, height: s, viewBox: "0 0 10 10", "aria-hidden": true } as const;
  switch (kind) {
    case "remitter": return <svg {...common}><path d="M5 0.4 L9.6 5 L5 9.6 L0.4 5Z" fill={c} /></svg>;
    case "account": return <svg {...common}><rect x="1.2" y="1.2" width="7.6" height="7.6" fill={c} /></svg>;
    case "person": return <svg {...common}><circle cx="5" cy="5" r="4.6" fill={c} /></svg>;
    case "record": return <svg {...common}><circle cx="5" cy="5" r="3.2" fill={c} /></svg>;
    case "phone": return <svg {...common}><path d="M5 1.6 L8.6 8 H1.4Z" fill={c} /></svg>;
    case "device": return <svg {...common}><path d="M5 8.4 L8.6 2 H1.4Z" fill={c} /></svg>;
    case "fingerprint": return <svg {...common}><circle cx="5" cy="5" r="3.4" fill="none" stroke={c} strokeWidth="1.8" /></svg>;
    case "decision": return <svg {...common}><path d="M5 0.6 L9.4 3.8 L7.7 9 H2.3 L0.6 3.8Z" fill={c} /></svg>;
    default: return <svg {...common}><circle cx="5" cy="5" r="3" fill={c} /></svg>;
  }
}

const KINDS_SHOWN: Kind[] = ["remitter", "account", "record", "person", "phone", "device", "fingerprint"];
const KEY = "shanakht.legend.open";

export default function Legend({ colourBy, setColourBy, modes = ["kind", "bank", "scenario"] }: { colourBy: ColourBy; setColourBy?: (c: ColourBy) => void; modes?: ColourBy[] }) {
  const [open, setOpen] = useState(true);
  useEffect(() => { try { if (localStorage.getItem(KEY) === "0") setOpen(false); } catch {} }, []);
  const toggle = () => { setOpen((o) => { try { localStorage.setItem(KEY, o ? "0" : "1"); } catch {} return !o; }); };

  return (
    <div className="pointer-events-auto max-w-[300px] bg-bg/85 text-[12px] text-fg-2">
      <div className="flex items-center gap-3">
        <button type="button" onClick={toggle} aria-expanded={open} className="flex h-7 items-center gap-1 rounded-[4px] pr-1 text-[12px] font-medium text-fg-2 hover:text-fg">
          Key {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
        {setColourBy && (
          <span className="flex items-center gap-0.5" role="radiogroup" aria-label="Colour by">
            <span className="mr-1 text-muted">Colour</span>
            {modes.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={colourBy === c} onClick={() => setColourBy(c)}
                className={`h-6 rounded-[3px] px-1.5 text-[12px] ${colourBy === c ? "bg-surface-2 font-medium text-fg" : "text-muted hover:text-fg"}`}>
                {c === "scenario" ? "Case" : c === "kind" ? "Kind" : "Bank"}
              </button>
            ))}
          </span>
        )}
      </div>
      {open && (
        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-[3px] pb-0.5">
          {KINDS_SHOWN.map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <KindGlyph kind={k} color={colourBy === "kind" ? undefined : MUTED} size={10} />
              {KIND_LABEL[k]}
            </span>
          ))}
          {colourBy === "bank" && Object.entries(BANK).map(([b, c]) => (
            <span key={b} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: c }} />
              {BANK_NAME[b]?.split(" ")[0] ?? b}
            </span>
          ))}
          {colourBy === "scenario" && Object.entries(SCENARIO_COLOR).slice(0, 5).map(([s, c]) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: c }} />
              Case {s.slice(1)}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: ACCENT }} />
            In focus
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border-[1.5px]" style={{ borderColor: NOMATCH }} />
            Ring / changed
          </span>
          <span className="col-span-2 mt-0.5 text-muted">Links take colour on hover. Drag to move; right-click releases a pinned node.</span>
        </div>
      )}
    </div>
  );
}
