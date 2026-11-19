"use client";
import { useCallback, useMemo } from "react";
import { PanelLeftClose, RotateCcw } from "lucide-react";
import { useGraphStore, type ColourBy, type Filters as F } from "@/lib/graphStore";
import { endId, type GData, type GLink, type GNode } from "@/lib/graphAdapt";
import { BANK, BANK_NAME, KIND_LABEL, KINDS, REL_COLOR, relLabel, type Kind } from "@/lib/palette";
import { KindGlyph } from "./Legend";

// ---- predicates, split by dimension so each facet can count "as if this facet were open"
const passKind = (n: GNode, f: F) => !f.hiddenKinds.includes(n.kind);
const passBank = (n: GNode, f: F) => !n.bank || !f.hiddenBanks.includes(n.bank);
const passRest = (n: GNode, f: F) =>
  !(f.hidePartnerFp && n.kind === "fingerprint" && n.bank !== "MRGL") && (!f.onlyScenario || !!n.scenarios?.length);
const passLinkOwn = (l: GLink, f: F) => !f.hiddenRels.includes(l.rel) && (l.rel !== "RESOLVES_TO" || l.score == null || l.score >= f.minScore);

export function useVisibility(data: GData) {
  const filters = useGraphStore((s) => s.filters);
  const nodeVisible = useCallback((n: GNode) => passKind(n, filters) && passBank(n, filters) && passRest(n, filters), [filters]);
  const linkVisible = useCallback((l: GLink) => passLinkOwn(l, filters), [filters]);
  const counts = useMemo(() => {
    const kinds: Record<string, number> = {}, banks: Record<string, number> = {}, rels: Record<string, number> = {};
    let shownNodes = 0, shownLinks = 0;
    const vis = new Set<string>();
    for (const n of data.nodes) {
      const k = passKind(n, filters), b = passBank(n, filters), r = passRest(n, filters);
      if (b && r) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
      if (k && r && n.bank) banks[n.bank] = (banks[n.bank] ?? 0) + 1;
      if (k && b && r) { shownNodes++; vis.add(n.id); }
    }
    for (const l of data.links) {
      if (!vis.has(endId(l.source)) || !vis.has(endId(l.target))) continue;
      const scoreOk = l.rel !== "RESOLVES_TO" || l.score == null || l.score >= filters.minScore;
      if (scoreOk) rels[l.rel] = (rels[l.rel] ?? 0) + 1;
      if (passLinkOwn(l, filters)) shownLinks++;
    }
    return { kinds, banks, rels, shownNodes, shownLinks };
  }, [data, filters]);
  return { nodeVisible, linkVisible, counts };
}

function Row({ on, onToggle, glyph, label, count }: { on: boolean; onToggle: () => void; glyph: React.ReactNode; label: string; count?: number }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-[5px] text-left text-[13px] transition-colors hover:bg-surface-2 ${on ? "text-fg" : "text-muted line-through decoration-muted/50"}`}
    >
      <span className={`flex w-3.5 justify-center ${on ? "" : "opacity-30"}`}>{glyph}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-[11.5px] tabular-nums text-muted">{(count ?? 0).toLocaleString()}</span>
    </button>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 px-2 py-[5px] text-[13px] text-fg-2">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${on ? "bg-main" : "bg-surface-2 ring-1 ring-rule"}`}
      >
        <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-fg transition-[left] ${on ? "left-[16px]" : "left-[2px]"}`} />
      </button>
    </label>
  );
}

const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export default function Filters({ data, counts, onClose }: { data: GData; counts: ReturnType<typeof useVisibility>["counts"]; onClose?: () => void }) {
  const f = useGraphStore((s) => s.filters);
  const set = useGraphStore((s) => s.setFilters);
  const reset = useGraphStore((s) => s.resetFilters);
  const colourBy = useGraphStore((s) => s.colourBy);
  const setColourBy = useGraphStore((s) => s.setColourBy);

  const present = useMemo(() => {
    const k = new Set<string>(), b = new Set<string>(), r = new Set<string>();
    data.nodes.forEach((n) => { k.add(n.kind); if (n.bank) b.add(n.bank); });
    data.links.forEach((l) => r.add(l.rel));
    return {
      kinds: KINDS.filter((x) => k.has(x)),
      banks: [...Object.keys(BANK).filter((x) => b.has(x)), ...[...b].filter((x) => !BANK[x])],
      rels: [...Object.keys(REL_COLOR).filter((x) => r.has(x)), ...[...r].filter((x) => !REL_COLOR[x])],
    };
  }, [data]);
  const dirty = JSON.stringify(f) !== JSON.stringify({ hiddenKinds: [], hiddenBanks: [], hiddenRels: [], minScore: 0, hidePartnerFp: false, onlyScenario: false });

  return (
    <aside className="flex h-full w-[256px] flex-col border-r border-rule bg-surface/92 backdrop-blur-md">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-rule pl-4 pr-2">
        <span className="text-[13px] font-semibold text-fg">Filters</span>
        <span className="font-mono text-[11.5px] tabular-nums text-muted">
          {counts.shownNodes.toLocaleString()}/{data.nodes.length.toLocaleString()}
        </span>
        {dirty && (
          <button onClick={reset} className="ml-auto flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[12px] text-fg-2 hover:bg-surface-2" title="Reset filters">
            <RotateCcw size={12} /> Reset
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className={`${dirty ? "" : "ml-auto"} rounded-[var(--radius-sm)] p-1.5 text-muted hover:bg-surface-2 hover:text-fg`} aria-label="Hide filters">
            <PanelLeftClose size={15} />
          </button>
        )}
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-3">
        <section>
          <div className="label px-2 pb-1">Colour by</div>
          <div className="mx-2 grid grid-cols-3 rounded-[var(--radius-sm)] bg-surface-2 p-0.5">
            {(["kind", "bank", "scenario"] as ColourBy[]).map((c) => (
              <button
                key={c}
                onClick={() => setColourBy(c)}
                aria-pressed={colourBy === c}
                className={`rounded-[5px] py-1 text-[12.5px] capitalize ${colourBy === c ? "bg-surface text-fg shadow-sm" : "text-fg-2 hover:text-fg"}`}
              >
                {c === "scenario" ? "Case" : c}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="label px-2 pb-1">Entities</div>
          {present.kinds.map((k) => (
            <Row key={k} on={!f.hiddenKinds.includes(k)} onToggle={() => set({ hiddenKinds: toggleIn(f.hiddenKinds, k as Kind) })}
              glyph={<KindGlyph kind={k} />} label={KIND_LABEL[k]} count={counts.kinds[k]} />
          ))}
        </section>

        {present.banks.length > 0 && (
          <section>
            <div className="label px-2 pb-1">Banks</div>
            {present.banks.map((b) => (
              <Row key={b} on={!f.hiddenBanks.includes(b)} onToggle={() => set({ hiddenBanks: toggleIn(f.hiddenBanks, b) })}
                glyph={<span className="h-2.5 w-2.5 rounded-full" style={{ background: BANK[b] ?? "#5C627C" }} />} label={BANK_NAME[b] ?? b} count={counts.banks[b]} />
            ))}
          </section>
        )}

        <section>
          <div className="label px-2 pb-1">Relationships</div>
          {present.rels.map((r) => (
            <Row key={r} on={!f.hiddenRels.includes(r)} onToggle={() => set({ hiddenRels: toggleIn(f.hiddenRels, r) })}
              glyph={<span className="h-[3px] w-3.5 rounded" style={{ background: REL_COLOR[r] ?? "#4A5170" }} />} label={relLabel(r)} count={counts.rels[r]} />
          ))}
        </section>

        <section className="px-2">
          <div className="flex items-baseline justify-between pb-1">
            <span className="label">Min resolver score</span>
            <span className="font-mono text-[12px] tabular-nums text-fg-2">{f.minScore.toFixed(2)}</span>
          </div>
          <input
            type="range" min={0} max={1} step={0.05} value={f.minScore}
            onChange={(e) => set({ minScore: Number(e.target.value) })}
            className="w-full accent-[var(--main)]"
            aria-label="Minimum resolver score for same-person links"
          />
        </section>

        <section>
          <Toggle on={f.hidePartnerFp} onChange={(v) => set({ hidePartnerFp: v })} label="Hide partner fingerprints" />
          <Toggle on={f.onlyScenario} onChange={(v) => set({ onlyScenario: v })} label="Only case neighbourhoods" />
        </section>
      </div>
    </aside>
  );
}
