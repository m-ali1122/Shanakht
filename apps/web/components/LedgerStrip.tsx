"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useStore } from "@/lib/store";
import type { LedgerBlock } from "@/lib/types";

const BAND_COLOR: Record<string, string> = { MATCH: "var(--match)", CLOSE: "var(--close)", NO_MATCH: "var(--nomatch)", RING: "var(--nomatch)" };

function BlockCard({ b }: { b: LedgerBlock }) {
  const open = useStore((s) => s.openExplorer);
  const hit = b.kind === "registry_hit";
  const pub = b.kind === "publish";
  return (
    <button
      onClick={() => open(b)}
      className={`slide-in flex h-[72px] w-[208px] shrink-0 flex-col justify-between rounded-[var(--radius)] border px-2.5 py-2 text-left transition-colors duration-150 hover:border-muted ${
        hit ? "border-nomatch bg-[color-mix(in_srgb,var(--nomatch)_10%,var(--surface))]" : "border-rule bg-surface"
      }`}
    >
      <div className="mono flex items-baseline gap-1.5 text-[11px]">
        <span className="text-ink">#{b.id}</span>
        <span className="text-muted">{b.hash.slice(0, 8)}…</span>
        <span className="ml-auto text-muted">{b.ts}</span>
      </div>
      {hit ? (
        <div className="text-[12px] leading-tight">
          <div className="font-medium uppercase tracking-[0.06em] text-nomatch">Registry hit · {b.bank}</div>
          <div className="mono text-[11px] text-ink-2">{b.fpKind} fp {b.fp?.slice(0, 4)}…</div>
        </div>
      ) : pub ? (
        <div className="text-[12px] leading-tight">
          <div className="font-medium text-ink">Registry publish</div>
          <div className="mono text-[11px] text-ink-2">{b.fpKind} fp {b.fp?.slice(0, 4)}… · MRGL</div>
        </div>
      ) : b.kind === "commit" ? (
        <div className="text-[12px] leading-tight">
          <div className="font-medium text-ink-2">Graph root committed</div>
          <div className="mono text-[11px] text-muted">epoch {b.epoch}</div>
        </div>
      ) : (
        <div className="text-[12px] leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: BAND_COLOR[b.band ?? ""] ?? "var(--muted)" }} />
            <span className="font-medium text-ink">{b.band === "NO_MATCH" ? "NO MATCH" : b.band === "CLOSE" ? "CLOSE" : b.band}</span>
            <span className="text-ink-2">· {String(b.action).replaceAll("_", " ")}</span>
          </div>
          <div className="mono text-[11px] text-muted">{b.approver}</div>
        </div>
      )}
    </button>
  );
}

export function MiniExplorer() {
  const b = useStore((s) => s.explorer);
  const close = useStore((s) => s.openExplorer);
  if (!b) return null;
  const rows: [string, string][] = [
    ["block", `#${b.id}`],
    ["kind", b.kind],
    ["tx", b.tx],
    ["hash", b.hash],
    ["time", b.ts],
    ...(b.band ? ([["band", b.band]] as [string, string][]) : []),
    ...(b.action ? ([["action", String(b.action)]] as [string, string][]) : []),
    ...(b.approver ? ([["approver", b.approver]] as [string, string][]) : []),
    ...(b.epoch ? ([["epoch", String(b.epoch)]] as [string, string][]) : []),
    ...Object.entries(b.detail ?? {}).map(([k, v]) => [k, String(v)] as [string, string]),
  ];
  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col border-l border-rule bg-surface slide-in" role="dialog" aria-label="Block explorer">
      <div className="flex h-12 items-center border-b border-rule px-4">
        <span className="font-serif text-[18px] text-ink">Block #{b.id}</span>
        <span className="label ml-3">local chain · mini explorer</span>
        <button onClick={() => close(null)} className="ml-auto text-ink-2 hover:text-ink" aria-label="Close explorer">
          <X size={16} />
        </button>
      </div>
      <dl className="scroll-thin flex-1 overflow-y-auto px-4 py-3">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[96px_1fr] gap-2 border-b border-rule py-1.5">
            <dt className="label">{k}</dt>
            <dd className="mono break-all text-[12px] text-ink">{v}</dd>
          </div>
        ))}
        <p className="mt-3 text-[12px] text-muted">On-chain data holds only hashes, Merkle roots and keyed fingerprints. No names or identifiers.</p>
      </dl>
    </div>
  );
}

export default function LedgerStrip() {
  const blocks = useStore((s) => s.blocks);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ left: ref.current.scrollWidth, behavior: "smooth" });
  }, [blocks.length]);
  return (
    <footer className="flex h-[112px] shrink-0 flex-col border-t border-rule bg-surface">
      <div className="flex h-7 items-center gap-3 px-4">
        <span className="label">Ledger</span>
        <span className="text-[11px] text-muted">GraphRootLog · DecisionLog · MuleRegistry</span>
      </div>
      <div ref={ref} className="scroll-thin flex flex-1 items-start gap-2 overflow-x-auto px-4 pb-2">
        {blocks.map((b) => <BlockCard key={b.id + b.tx} b={b} />)}
      </div>
    </footer>
  );
}
