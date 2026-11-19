"use client";
import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import type { LedgerBlock } from "@/lib/types";
import { BAND_FILL, BAND_WORD, tint } from "./bits";

export function blockFace(b: LedgerBlock): { kind: string; title: string; sub: string; color: string } {
  const fp = b.fp ? b.fp.slice(0, 8) : "";
  if (b.kind === "registry_hit") return { kind: "Registry hit", title: `${b.bank ?? ""} flagged`, sub: `${b.fpKind ?? ""} ${fp}`, color: "var(--nomatch)" };
  if (b.kind === "publish") return { kind: "Registry entry", title: `${b.fpKind === "phone" ? "Phone" : b.fpKind === "device" ? "Device" : "Fingerprint"} published`, sub: `${fp} · ${b.bank ?? ""}`, color: "var(--main-ink)" };
  if (b.kind === "commit") {
    const n = b.detail?.nodes;
    return { kind: "Graph root", title: b.epoch != null ? `Epoch ${b.epoch}` : "Committed", sub: n ? `${Number(n).toLocaleString("en-US")} nodes` : (b.hash ?? "").slice(0, 10), color: "var(--main)" };
  }
  const action = String(b.action ?? "").replaceAll("_", " ");
  return { kind: b.kind === "auto" ? "Auto decision" : "Decision", title: `${BAND_WORD[b.band ?? ""] ?? b.band ?? "Decision"}`, sub: action, color: BAND_FILL[b.band ?? ""] ?? "var(--muted)" };
}

/** The local chain, oldest to newest, left to right. Newest carries the focus halo; click opens a block. */
export default function Chain() {
  const blocks = useStore((s) => s.blocks);
  const sel = useStore((s) => s.explorer);
  const open = useStore((s) => s.openExplorer);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ left: ref.current.scrollWidth, behavior: "smooth" });
  }, [blocks.length]);
  const newest = blocks[blocks.length - 1];
  const selected = sel ?? newest;
  return (
    <div ref={ref} className="scroll-thin overflow-x-auto px-5 pb-3 pt-1" aria-label="Chain">
      {blocks.length === 0 ? (
        <div className="flex h-[96px] items-center text-[14px] text-muted">No blocks yet. Graph roots are committed when the services start.</div>
      ) : (
        <ol className="flex w-max items-center py-2">
          {blocks.map((b, i) => {
            const f = blockFace(b);
            const isNew = b === newest;
            const isSel = selected && b.id === selected.id && b.tx === selected.tx;
            return (
              <li key={b.id + b.tx} className="flex items-center">
                {i > 0 && (
                  <span className="flex w-7 items-center" aria-hidden>
                    <span className="h-px flex-1 bg-rule" />
                    <span className="h-1.5 w-1.5 rotate-45 border-r border-t border-rule" />
                  </span>
                )}
                <button
                  onClick={() => open(isSel && sel ? null : b)}
                  aria-pressed={!!isSel}
                  className={`slide-in relative flex h-[92px] w-[164px] flex-col rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-colors duration-150 ${
                    isSel ? "border-main bg-surface-2" : "border-rule bg-surface hover:border-fg-2/40"
                  } ${isNew ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : ""}`}
                  style={b.kind === "registry_hit" ? { background: tint("var(--nomatch)", 12), borderColor: "var(--nomatch)" } : undefined}
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                    <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: f.color }} />
                    {f.kind}
                    <span className="ml-auto font-mono text-fg-2">#{b.id}</span>
                  </span>
                  <span className={`mt-1.5 truncate text-[14px] font-semibold ${b.kind === "registry_hit" ? "text-nomatch-ink" : "text-fg"}`}>{f.title}</span>
                  <span className="truncate text-[12px] text-fg-2">{f.sub}</span>
                  <span className="mt-auto text-[11px] tabular-nums text-muted">{b.ts}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
