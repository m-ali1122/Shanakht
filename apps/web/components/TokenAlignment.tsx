"use client";
import { useLayoutEffect, useRef, useState } from "react";
import type { AlignmentItem } from "@/lib/types";

/**
 * Typed tokens on top, title tokens below, thin connecting lines.
 * exact = solid; variant/initial/transliterated = dotted + reason label;
 * dropped = struck through in muted; extra = muted title token.
 */
export default function TokenAlignment({ items, urdu }: { items: AlignmentItem[]; urdu?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const top = useRef<(HTMLSpanElement | null)[]>([]);
  const bot = useRef<(HTMLSpanElement | null)[]>([]);
  const [lines, setLines] = useState<{ x1: number; x2: number; dotted: boolean; label?: string }[]>([]);
  const [w, setW] = useState(0);

  const typed = items.filter((i) => i.typed_token !== null);
  const titled = items.filter((i) => i.title_token !== null);

  useLayoutEffect(() => {
    const measure = () => {
      const box = wrap.current?.getBoundingClientRect();
      if (!box) return;
      setW(box.width);
      const out: typeof lines = [];
      items.forEach((it) => {
        if (it.typed_token === null || it.title_token === null) return;
        const ti = typed.indexOf(it);
        const bi = titled.indexOf(it);
        const a = top.current[ti]?.getBoundingClientRect();
        const b = bot.current[bi]?.getBoundingClientRect();
        if (!a || !b) return;
        out.push({
          x1: a.left + a.width / 2 - box.left,
          x2: b.left + b.width / 2 - box.left,
          dotted: it.relation !== "exact",
          label: it.relation !== "exact" ? it.reason : undefined,
        });
      });
      setLines(out);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const H = 40;
  return (
    <div ref={wrap} className="relative select-none">
      <div className="label mb-1">Typed</div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-1">
        {typed.map((it, i) => (
          <span
            key={"t" + i}
            ref={(el) => { top.current[i] = el; }}
            className={`text-[15px] ${it.relation === "dropped" ? "text-muted line-through decoration-1" : "text-ink"}`}
            title={it.relation === "dropped" ? it.reason ?? "dropped" : undefined}
          >
            {it.typed_token}
          </span>
        ))}
      </div>
      <svg width={w} height={H} className="block overflow-visible" aria-hidden>
        {lines.map((l, i) => (
          <g key={i}>
            <line x1={l.x1} y1={2} x2={l.x2} y2={H - 2} stroke={l.dotted ? "var(--close)" : "var(--ink-2)"} strokeWidth={1} strokeDasharray={l.dotted ? "2 3" : undefined} />
            {l.label && (
              <text x={(l.x1 + l.x2) / 2 + 6} y={H / 2 + 4} fontSize={10} letterSpacing="0.06em" fill="var(--close)" style={{ fontFamily: "var(--font-plex-mono)" }}>
                {l.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-2.5 gap-y-1">
        {titled.map((it, i) => (
          <span
            key={"b" + i}
            ref={(el) => { bot.current[i] = el; }}
            className={`mono text-[13px] tracking-[0.02em] ${it.relation === "extra" ? "text-muted" : "text-ink"}`}
            title={it.relation === "extra" ? it.reason ?? "not in typed name" : undefined}
          >
            {it.title_token}
            {it.relation === "extra" && it.reason && <span className="ml-1 text-[10px] uppercase text-muted">({it.reason})</span>}
          </span>
        ))}
      </div>
      <div className="label mt-1">Account title</div>
      {urdu && (
        <div className="mt-2 border-t border-rule pt-2">
          <div className="label">KYC name (as on CNIC)</div>
          <div className="urdu text-[20px] text-ink" lang="ur" style={{ lineHeight: 2.2, textAlign: "left" }}>
            {urdu}
          </div>
          <div className="mono text-[11px] text-close">SCRIPT_CONVERTED · both spellings map here</div>
        </div>
      )}
    </div>
  );
}
