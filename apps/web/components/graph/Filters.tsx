"use client";
// Filter chips for the grand graph: one chip per facet (opens a small checklist), plus the
// active filters as removable chips and a plain-text count. Every toggle filters instantly.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { DEFAULT_FILTERS, useGraphStore, type Filters as F } from "@/lib/graphStore";
import { endId, type GData, type GLink, type GNode } from "@/lib/graphAdapt";
import { BANK, BANK_NAME, KIND_LABEL, KINDS, NO_BANK, REL_COLOR, REL_DEFAULT, SCENARIO_COLOR, relLabel, type Kind } from "@/lib/palette";
import { KindGlyph } from "./Legend";

// ---- predicates, split by dimension so each facet can count "as if this facet were open"
const passKind = (n: GNode, f: F) => !f.hiddenKinds.includes(n.kind);
const passBank = (n: GNode, f: F) => !n.bank || !f.hiddenBanks.includes(n.bank);
const passRest = (n: GNode, f: F) => !(f.hidePartnerFp && n.kind === "fingerprint" && n.bank !== "MRGL");
const passLinkOwn = (l: GLink, f: F) => !f.hiddenRels.includes(l.rel) && (l.rel !== "RESOLVES_TO" || l.score == null || l.score >= f.minScore);
const inCases = (n: GNode, f: F) => !f.cases.length || !!n.scenarios?.some((s) => f.cases.includes(s));

export function useVisibility(data: GData) {
  const filters = useGraphStore((s) => s.filters);
  const nodeVisible = useCallback((n: GNode) => passKind(n, filters) && passBank(n, filters) && passRest(n, filters), [filters]);
  const linkVisible = useCallback((l: GLink) => passLinkOwn(l, filters), [filters]);
  const nodeFaded = useMemo(() => (filters.cases.length ? (n: GNode) => !inCases(n, filters) : undefined), [filters]);
  const counts = useMemo(() => {
    const kinds: Record<string, number> = {}, banks: Record<string, number> = {}, rels: Record<string, number> = {}, cases: Record<string, number> = {};
    let shownNodes = 0, matchNodes = 0, shownLinks = 0;
    const vis = new Set<string>();
    for (const n of data.nodes) {
      const k = passKind(n, filters), b = passBank(n, filters), r = passRest(n, filters);
      if (b && r) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
      if (k && r && n.bank) banks[n.bank] = (banks[n.bank] ?? 0) + 1;
      if (k && b && r) {
        shownNodes++;
        vis.add(n.id);
        for (const s of n.scenarios ?? []) cases[s] = (cases[s] ?? 0) + 1;
        if (inCases(n, filters)) matchNodes++;
      }
    }
    for (const l of data.links) {
      if (!vis.has(endId(l.source)) || !vis.has(endId(l.target))) continue;
      const scoreOk = l.rel !== "RESOLVES_TO" || l.score == null || l.score >= filters.minScore;
      if (scoreOk) rels[l.rel] = (rels[l.rel] ?? 0) + 1;
      if (passLinkOwn(l, filters)) shownLinks++;
    }
    return { kinds, banks, rels, cases, shownNodes, matchNodes, shownLinks };
  }, [data, filters]);
  return { nodeVisible, linkVisible, nodeFaded, counts };
}

const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
const chip = "flex h-8 items-center gap-1.5 rounded-[4px] border px-2.5 text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-main";

/** A facet chip that opens a small checklist under it. */
function Facet({ label, summary, active, children }: { label: string; summary?: string; active: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); setOpen(false); } };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("pointerdown", down); window.removeEventListener("keydown", key, true); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`${chip} ${active ? "border-main/40 bg-main-soft text-main-ink" : "border-rule bg-bg text-fg-2 hover:border-fg-2/40 hover:text-fg"}`}
      >
        {label}
        {summary && <span className={active ? "text-main-ink" : "text-muted"}>{summary}</span>}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-30 min-w-[232px] rounded-[4px] border border-rule bg-bg py-1">
          {children}
        </div>
      )}
    </div>
  );
}

function CheckRow({ on, onToggle, glyph, label, count }: { on: boolean; onToggle: () => void; glyph?: React.ReactNode; label: string; count?: number }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      onClick={onToggle}
      className="flex h-8 w-full items-center gap-2.5 px-3 text-left text-[13px] hover:bg-surface-2"
    >
      <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border ${on ? "border-main bg-main text-white" : "border-fg-2/40"}`}>
        {on && <Check size={10} strokeWidth={3} />}
      </span>
      {glyph && <span className={`flex w-3.5 justify-center ${on ? "" : "opacity-40"}`}>{glyph}</span>}
      <span className={`min-w-0 flex-1 truncate ${on ? "text-fg" : "text-muted"}`}>{label}</span>
      <span className="font-mono text-[11.5px] tabular-nums text-muted">{(count ?? 0).toLocaleString()}</span>
    </button>
  );
}

function Removable({ children, onRemove, label }: { children: React.ReactNode; onRemove: () => void; label: string }) {
  return (
    <span className="flex h-7 items-center gap-1 rounded-[4px] bg-surface-2 pl-2.5 pr-1 text-[12.5px] text-fg">
      {children}
      <button type="button" onClick={onRemove} className="grid h-5 w-5 place-items-center rounded-[3px] text-muted hover:bg-rule hover:text-fg" aria-label={`Remove filter: ${label}`}>
        <X size={12} />
      </button>
    </span>
  );
}

export default function FilterChips({ data, counts }: { data: GData; counts: ReturnType<typeof useVisibility>["counts"] }) {
  const f = useGraphStore((s) => s.filters);
  const set = useGraphStore((s) => s.setFilters);
  const reset = useGraphStore((s) => s.resetFilters);

  const present = useMemo(() => {
    const k = new Set<string>(), b = new Set<string>(), r = new Set<string>(), c = new Set<string>();
    data.nodes.forEach((n) => { k.add(n.kind); if (n.bank) b.add(n.bank); n.scenarios?.forEach((s) => c.add(s)); });
    data.links.forEach((l) => r.add(l.rel));
    return {
      kinds: KINDS.filter((x) => k.has(x)),
      banks: [...Object.keys(BANK).filter((x) => b.has(x)), ...[...b].filter((x) => !BANK[x])],
      rels: [...Object.keys(REL_COLOR).filter((x) => r.has(x)), ...[...r].filter((x) => !REL_COLOR[x])],
      cases: [...c].sort(),
      hasScore: data.links.some((l) => l.rel === "RESOLVES_TO" && l.score != null),
      hasPartnerFp: data.nodes.some((n) => n.kind === "fingerprint" && n.bank !== "MRGL"),
    };
  }, [data]);
  const dirty = JSON.stringify(f) !== JSON.stringify(DEFAULT_FILTERS);
  const shownKinds = present.kinds.filter((k) => !f.hiddenKinds.includes(k)).length;
  const shownBanks = present.banks.filter((b) => !f.hiddenBanks.includes(b)).length;
  const shownRels = present.rels.filter((r) => !f.hiddenRels.includes(r)).length;
  const total = data.nodes.length;
  const n = f.cases.length ? counts.matchNodes : counts.shownNodes;

  return (
    <div className="pointer-events-auto flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Facet label="Entities" summary={shownKinds < present.kinds.length ? `${shownKinds}/${present.kinds.length}` : undefined} active={shownKinds < present.kinds.length}>
          {present.kinds.map((k) => (
            <CheckRow key={k} on={!f.hiddenKinds.includes(k)} onToggle={() => set({ hiddenKinds: toggleIn(f.hiddenKinds, k as Kind) })}
              glyph={<KindGlyph kind={k} />} label={KIND_LABEL[k]} count={counts.kinds[k]} />
          ))}
        </Facet>
        {present.banks.length > 0 && (
          <Facet label="Banks" summary={shownBanks < present.banks.length ? `${shownBanks}/${present.banks.length}` : undefined} active={shownBanks < present.banks.length}>
            {present.banks.map((b) => (
              <CheckRow key={b} on={!f.hiddenBanks.includes(b)} onToggle={() => set({ hiddenBanks: toggleIn(f.hiddenBanks, b) })}
                glyph={<span className="h-2.5 w-2.5 rounded-full" style={{ background: BANK[b] ?? NO_BANK }} />} label={BANK_NAME[b] ?? b} count={counts.banks[b]} />
            ))}
          </Facet>
        )}
        <Facet label="Links" summary={shownRels < present.rels.length ? `${shownRels}/${present.rels.length}` : undefined} active={shownRels < present.rels.length}>
          {present.rels.map((r) => (
            <CheckRow key={r} on={!f.hiddenRels.includes(r)} onToggle={() => set({ hiddenRels: toggleIn(f.hiddenRels, r) })}
              glyph={<span className="h-[2px] w-3.5" style={{ background: REL_COLOR[r] ?? REL_DEFAULT }} />} label={relLabel(r)} count={counts.rels[r]} />
          ))}
        </Facet>
        {present.hasScore && (
          <Facet label="Resolver score" summary={f.minScore > 0 ? `≥ ${f.minScore.toFixed(2)}` : undefined} active={f.minScore > 0}>
            <div className="w-[248px] px-3 py-2">
              <div className="flex items-baseline justify-between text-[12.5px]">
                <span className="text-fg-2">Hide same-person links below</span>
                <span className="font-mono tabular-nums text-fg">{f.minScore.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.05} value={f.minScore}
                onChange={(e) => set({ minScore: Number(e.target.value) })}
                className="mt-2 w-full accent-[var(--main)]"
                aria-label="Minimum resolver score for same-person links"
              />
              <div className="mt-1 flex gap-1">
                {[0, 0.6, 0.8, 0.9].map((v) => (
                  <button key={v} type="button" onClick={() => set({ minScore: v })}
                    className={`h-6 flex-1 rounded-[3px] text-[12px] tabular-nums ${f.minScore === v ? "bg-main-soft text-main-ink" : "text-fg-2 hover:bg-surface-2"}`}>
                    {v === 0 ? "Any" : v.toFixed(1)}
                  </button>
                ))}
              </div>
            </div>
          </Facet>
        )}
        {present.cases.length > 0 && (
          <Facet label="Cases" summary={f.cases.length ? f.cases.map((s) => s.slice(1)).join(", ") : undefined} active={f.cases.length > 0}>
            <p className="px-3 pb-1 pt-1.5 text-[12px] leading-snug text-muted">Bring a case neighbourhood forward; the rest fades.</p>
            {present.cases.map((s) => (
              <CheckRow key={s} on={f.cases.includes(s)} onToggle={() => set({ cases: toggleIn(f.cases, s) })}
                glyph={<span className="h-2.5 w-2.5 rounded-full" style={{ background: SCENARIO_COLOR[s] ?? NO_BANK }} />} label={`Case ${s.slice(1)}`} count={counts.cases[s]} />
            ))}
          </Facet>
        )}
        {present.hasPartnerFp && (
          <button
            type="button"
            aria-pressed={f.hidePartnerFp}
            onClick={() => set({ hidePartnerFp: !f.hidePartnerFp })}
            className={`${chip} ${f.hidePartnerFp ? "border-main/40 bg-main-soft text-main-ink" : "border-rule bg-bg text-fg-2 hover:border-fg-2/40 hover:text-fg"}`}
          >
            {f.hidePartnerFp && <Check size={13} />} Hide partner fingerprints
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <span className="mr-1 bg-bg/80 tabular-nums text-fg-2" aria-live="polite">
          <span className="font-medium text-fg">{n.toLocaleString()}</span> of {total.toLocaleString()} entities
          <span className="text-muted"> · {counts.shownLinks.toLocaleString()} links</span>
        </span>
        {f.hiddenKinds.map((k) => (
          <Removable key={"k" + k} label={KIND_LABEL[k]} onRemove={() => set({ hiddenKinds: f.hiddenKinds.filter((x) => x !== k) })}>No {KIND_LABEL[k].toLowerCase()}s</Removable>
        ))}
        {f.hiddenBanks.map((b) => (
          <Removable key={"b" + b} label={BANK_NAME[b] ?? b} onRemove={() => set({ hiddenBanks: f.hiddenBanks.filter((x) => x !== b) })}>Not {BANK_NAME[b]?.replace(" (host)", "") ?? b}</Removable>
        ))}
        {f.hiddenRels.map((r) => (
          <Removable key={"r" + r} label={relLabel(r)} onRemove={() => set({ hiddenRels: f.hiddenRels.filter((x) => x !== r) })}>No “{relLabel(r).toLowerCase()}” links</Removable>
        ))}
        {f.minScore > 0 && <Removable label="resolver score" onRemove={() => set({ minScore: 0 })}>Score ≥ {f.minScore.toFixed(2)}</Removable>}
        {f.cases.length > 0 && <Removable label="cases" onRemove={() => set({ cases: [] })}>Case {f.cases.map((s) => s.slice(1)).join(", ")}</Removable>}
        {f.hidePartnerFp && <Removable label="partner fingerprints" onRemove={() => set({ hidePartnerFp: false })}>No partner fingerprints</Removable>}
        {dirty && (
          <button type="button" onClick={reset} className="h-7 rounded-[4px] px-2 text-[12.5px] text-main-ink hover:bg-main-soft">Clear all</button>
        )}
      </div>
    </div>
  );
}
