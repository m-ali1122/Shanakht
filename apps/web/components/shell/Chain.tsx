"use client";
import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import type { LedgerBlock } from "@/lib/types";
import { BAND_FILL, BAND_WORD } from "./bits";

export function blockFace(b: LedgerBlock): { kind: string; title: string; sub: string; color: string } {
  const fp = b.fp ? b.fp.slice(0, 8) : "";
  if (b.kind === "registry_hit") return { kind: "Registry hit", title: `${b.bank ?? ""} flagged`, sub: `${b.fpKind ?? ""} ${fp}`, color: "var(--nomatch)" };
  if (b.kind === "publish") return { kind: "Registry entry", title: `${b.fpKind === "phone" ? "Phone" : b.fpKind === "device" ? "Device" : "Fingerprint"} published`, sub: `${fp} · ${b.bank ?? ""}`, color: "var(--main-ink)" };
  if (b.kind === "commit") {
    const n = b.detail?.nodes;
    return { kind: "Graph root", title: b.epoch != null ? `Epoch ${b.epoch}` : "Committed", sub: n ? `${Number(n).toLocaleString("en-US")} nodes` : (b.hash ?? "").slice(0, 10), color: "var(--fg-2)" };
  }
  const action = String(b.action ?? "").replaceAll("_", " ");
  return { kind: b.kind === "auto" ? "Auto decision" : "Decision", title: `${BAND_WORD[b.band ?? ""] ?? b.band ?? "Decision"}`, sub: action, color: BAND_FILL[b.band ?? ""] ?? "var(--muted)" };
}

const STEP = 132;

/** The local chain, oldest to newest, as marks on one rule. Newest carries the lime halo; click opens a block. */
export default function Chain() {
  const blocks = useStore((s) => s.blocks);
  const sel = useStore((s) => s.explorer);
  const open = useStore((s) => s.openExplorer);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ left: ref.current.scrollWidth, behavior: "smooth" });
  }, [blocks.length]);
  const newest = blocks[blocks.length - 1];
  if (blocks.length === 0) return <p className="py-8 text-[14px] text-muted">No blocks yet. Graph roots are committed when the services start.</p>;
  return (
    <div ref={ref} className="scroll-thin overflow-x-auto pb-2" aria-label="Chain, oldest to newest">
      <ol className="relative flex w-max py-1">
        <span className="pointer-events-none absolute left-0 right-0 top-[41px] h-px bg-rule" aria-hidden />
        {blocks.map((b) => {
          const f = blockFace(b);
          const isNew = b === newest;
          const isSel = !!sel && b.id === sel.id && b.tx === sel.tx;
          const hit = b.kind === "registry_hit";
          return (
            <li key={b.id + b.tx} style={{ width: STEP }} className="slide-in shrink-0">
              <button
                onClick={() => open(isSel ? null : b)}
                aria-pressed={isSel}
                className={`group flex w-full flex-col items-start rounded-[4px] px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-2 ${isSel ? "bg-main-soft" : ""}`}
              >
                <span className="h-[18px] truncate text-[11px] font-medium text-muted">{f.kind}</span>
                <span className="relative my-[7px] flex h-[12px] items-center">
                  {isNew && <span className="absolute -left-[5px] h-[22px] w-[22px] rounded-full bg-accent/70" aria-hidden />}
                  <span className="relative block h-[12px] w-[12px]" style={{ background: f.color, borderRadius: b.kind === "commit" ? 0 : 999 }} />
                </span>
                <span className={`mt-1 max-w-full truncate text-[13px] font-semibold ${hit ? "text-nomatch-ink" : "text-fg"}`}>{f.title}</span>
                <span className="max-w-full truncate text-[12px] text-fg-2">{f.sub}</span>
                <span className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">#{b.id} · {b.ts}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
