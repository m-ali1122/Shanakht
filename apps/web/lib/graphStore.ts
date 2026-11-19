"use client";
// Graph workspace state (grand graph + inspector + query + filters). Separate from lib/store.ts,
// which owns the demo flow; the Investigate view reads that store for its case graph.
import { create } from "zustand";
import { graphApi, GraphApiError, type GrandStats, type PatternInfo, type SearchHit } from "./graphApi";
import {
  edgeFallback, endId, mergeData, nodeFallback, pathLocal, patternLocal, PATTERNS_LOCAL, searchLocal, finalise,
  type EdgeDetail, type GData, type GLink, type NodeDetail,
} from "./graphAdapt";
import type { Kind } from "./palette";

export type ColourBy = "kind" | "bank" | "scenario";
export type Scope = "grand" | "case";
export type Selection = { type: "node"; id: string } | { type: "link"; id: string; rel: string; source: string; target: string } | null;
export type QueryMode = "find" | "ask" | "patterns";

export type Filters = {
  hiddenKinds: Kind[];
  hiddenBanks: string[];
  hiddenRels: string[];
  minScore: number;
  hidePartnerFp: boolean;
  /** case neighbourhoods to bring forward (empty = all); entities outside them fade, they do not vanish */
  cases: string[];
};
export const DEFAULT_FILTERS: Filters = { hiddenKinds: [], hiddenBanks: [], hiddenRels: [], minScore: 0, hidePartnerFp: false, cases: [] };

type Highlight = { nodes: string[]; links: string[]; label: string } | null;

interface GState {
  data: GData;
  stats: GrandStats | null;
  loading: boolean;
  error: string | null;
  /** Set when the explore API is not live and the grand graph was assembled from scenario graphs. */
  fallback: boolean;

  filters: Filters;
  colourBy: ColourBy;
  selection: Selection;
  selScope: Scope;
  inspector: { loading: boolean; node?: NodeDetail; edge?: EdgeDetail; error?: string };
  focus: { id: string; nonce: number } | null;
  highlight: Highlight;
  pathFrom: string | null;
  caseExtra: GData;

  mode: QueryMode;
  busy: boolean;
  hits: SearchHit[];
  answer: { text: string; transcript: string; rows: number; cypher?: string; error?: string } | null;
  patterns: PatternInfo[];
  activePattern: { key: string; title: string; description: string; count: number; matches: string[][]; local: boolean } | null;
  qerror: string | null;

  loadGrand: () => Promise<void>;
  setFilters: (f: Partial<Filters>) => void;
  resetFilters: () => void;
  setColourBy: (c: ColourBy) => void;
  select: (sel: Selection, data: GData, scope: Scope) => void;
  clearSelection: () => void;
  focusOn: (id: string) => void;
  setHighlight: (h: Highlight) => void;
  expand: (id: string, scope: Scope) => Promise<void>;
  startPath: (id: string | null) => void;
  pathTo: (target: string, data: GData, scope: Scope) => Promise<void>;
  setMode: (m: QueryMode) => void;
  find: (text: string) => Promise<void>;
  ask: (text: string) => Promise<void>;
  loadPatterns: () => Promise<void>;
  runPattern: (key: string) => Promise<void>;
  clearQuery: () => void;
  resetCase: () => void;
}

const EMPTY: GData = { nodes: [], links: [] };
let inspectorSeq = 0;

function linkFor(data: GData, id: string): GLink | undefined {
  return data.links.find((l) => l.id === id);
}

export const useGraphStore = create<GState>((set, get) => ({
  data: EMPTY,
  stats: null,
  loading: false,
  error: null,
  fallback: false,

  filters: DEFAULT_FILTERS,
  colourBy: "kind",
  selection: null,
  selScope: "grand",
  inspector: { loading: false },
  focus: null,
  highlight: null,
  pathFrom: null,
  caseExtra: EMPTY,

  mode: "find",
  busy: false,
  hits: [],
  answer: null,
  patterns: [],
  activePattern: null,
  qerror: null,

  async loadGrand() {
    if (get().loading || get().data.nodes.length) return;
    set({ loading: true, error: null });
    try {
      const g = await graphApi.grand(2500);
      set({ data: { nodes: g.nodes, links: g.links }, stats: g.stats ?? null, fallback: false, loading: false });
    } catch {
      // Explore API not live yet: assemble the grand graph from the six scenario neighbourhoods.
      const parts = await Promise.all(["S1", "S2", "S3", "S4", "S5"].map((s) => graphApi.scenario(s).catch(() => EMPTY)));
      const merged = finalise(parts.flatMap((p) => p.nodes.map((n) => ({ ...n }))), parts.flatMap((p) => p.links.map((l) => ({ ...l }))));
      if (!merged.nodes.length) set({ loading: false, error: "The agent service is not answering, so there is no graph to show." });
      else set({ data: merged, stats: null, fallback: true, loading: false });
    }
  },

  setFilters(f) { set((s) => ({ filters: { ...s.filters, ...f } })); },
  resetFilters() { set({ filters: DEFAULT_FILTERS }); },
  setColourBy(c) { set({ colourBy: c }); },

  select(sel, data, scope) {
    const seq = ++inspectorSeq;
    set({ selection: sel, selScope: scope, inspector: { loading: !!sel } });
    if (!sel) return;
    const done = (p: Partial<GState["inspector"]>) => { if (seq === inspectorSeq) set({ inspector: { loading: false, ...p } }); };
    if (sel.type === "node") {
      const local = nodeFallback(data, sel.id);
      if (local) set({ inspector: { loading: true, node: local } });
      graphApi.node(sel.id)
        .then((n) => done({ node: { ...local, ...n, degree: { ...(local?.degree ?? {}), ...(n.degree ?? {}) } } }))
        .catch(() => done(local ? { node: local } : { error: "No details for this entity." }));
    } else {
      const l = linkFor(data, sel.id) ?? ({ id: sel.id, rel: sel.rel, source: sel.source, target: sel.target } as GLink);
      const local = edgeFallback(data, l);
      set({ inspector: { loading: true, edge: local } });
      graphApi.edge(sel.rel, sel.source, sel.target)
        .then((e) => done({ edge: e }))
        .catch(() => done({ edge: local }));
    }
  },
  clearSelection() { inspectorSeq++; set({ selection: null, inspector: { loading: false }, pathFrom: null }); },
  focusOn(id) { set((s) => ({ focus: { id, nonce: (s.focus?.nonce ?? 0) + 1 } })); },
  setHighlight(h) { set({ highlight: h }); },

  async expand(id, scope) {
    set({ busy: true, qerror: null });
    try {
      const add = await graphApi.expand(id, 1);
      if (scope === "grand") set((s) => ({ data: mergeData(s.data, add) }));
      else set((s) => ({ caseExtra: mergeData(s.caseExtra, add) }));
      set({ highlight: { nodes: add.nodes.map((n) => n.id), links: add.links.map((l) => l.id), label: "Neighbours" } });
    } catch (e) {
      set({ qerror: e instanceof GraphApiError && e.status === 404 ? "Expanding needs the explore API; showing the neighbours already loaded." : "Could not expand this entity." });
      // still highlight the loaded neighbourhood
      const data = scope === "grand" ? get().data : null;
      if (data) {
        const ls = data.links.filter((l) => endId(l.source) === id || endId(l.target) === id);
        set({ highlight: { nodes: [id, ...ls.map((l) => (endId(l.source) === id ? endId(l.target) : endId(l.source)))], links: ls.map((l) => l.id), label: "Neighbours" } });
      }
    } finally {
      set({ busy: false });
    }
  },

  startPath(id) { set({ pathFrom: id }); },
  async pathTo(target, data, scope) {
    const from = get().pathFrom;
    set({ pathFrom: null });
    if (!from || from === target) return;
    set({ busy: true, qerror: null });
    let p: GData | null = null;
    try { p = await graphApi.path(from, target, 6); } catch { p = pathLocal(data, from, target, 6); }
    set({ busy: false });
    if (!p || !p.nodes.length) { set({ qerror: "No path within 6 hops." }); return; }
    if (scope === "grand") set((s) => ({ data: mergeData(s.data, p!) }));
    else set((s) => ({ caseExtra: mergeData(s.caseExtra, p!) }));
    set({ highlight: { nodes: p.nodes.map((n) => n.id), links: p.links.map((l) => l.id), label: `Path, ${p.links.length} hop${p.links.length === 1 ? "" : "s"}` } });
  },

  setMode(m) { set({ mode: m, qerror: null }); if (m === "patterns" && !get().patterns.length) get().loadPatterns(); },

  async find(text) {
    const t = text.trim();
    if (!t) { set({ hits: [] }); return; }
    set({ busy: true, qerror: null });
    let hits: SearchHit[];
    try { hits = await graphApi.search(t, 20); } catch { hits = searchLocal(get().data, t, 20); }
    set({ hits, busy: false, qerror: hits.length ? null : "Nothing in the graph matches that." });
    if (hits.length) {
      const have = new Set(get().data.nodes.map((n) => n.id));
      const shown = hits.filter((h) => have.has(h.id));
      set({ highlight: { nodes: shown.map((h) => h.id), links: [], label: `${hits.length} match${hits.length === 1 ? "" : "es"}` } });
    }
  },

  async ask(text) {
    const t = text.trim();
    if (!t) return;
    set({ busy: true, qerror: null, answer: null });
    try {
      const r = await graphApi.ask(t);
      const cy = r.cypher_attempts?.length ? r.cypher_attempts[r.cypher_attempts.length - 1].query : undefined;
      set({ answer: { text: r.answer ?? "", transcript: r.transcript ?? t, rows: typeof r.rows === "number" ? r.rows : Array.isArray(r.rows) ? (r.rows as any[]).length : 0, cypher: cy, error: r.error } });
      // Map answer ids to graph ids: direct, prefixed hashes, then search for anything still missing.
      const data = get().data;
      const have = new Set(data.nodes.map((n) => n.id));
      const found = new Set<string>(), missing: string[] = [];
      for (const id of r.highlight_ids ?? []) {
        const c = [id, "ph:" + id, "dv:" + id, "fp:" + id].filter((x) => have.has(x));
        if (c.length) c.forEach((x) => found.add(x)); else missing.push(id);
      }
      for (const id of missing.slice(0, 8)) {
        try { (await graphApi.search(id, 3)).forEach((h) => have.has(h.id) && found.add(h.id)); }
        catch { searchLocal(data, id, 3).forEach((h) => found.add(h.id)); }
      }
      if (found.size) set({ highlight: { nodes: [...found], links: [], label: "Named in the answer" } });
      if (found.size === 1) get().focusOn([...found][0]);
    } catch (e) {
      set({ qerror: `The question could not be answered (${e instanceof Error ? e.message : String(e)}).` });
    } finally {
      set({ busy: false });
    }
  },

  async loadPatterns() {
    try { set({ patterns: await graphApi.patterns() }); } catch { set({ patterns: PATTERNS_LOCAL }); }
  },
  async runPattern(key) {
    set({ busy: true, qerror: null });
    const info = get().patterns.find((p) => p.key === key) ?? PATTERNS_LOCAL.find((p) => p.key === key);
    try {
      const r = await graphApi.pattern(key);
      set((s) => ({ data: mergeData(s.data, r) }));
      const ids = r.nodes.map((n) => n.id);
      set({ activePattern: { key, title: r.title ?? info?.title ?? key, description: r.description ?? info?.description ?? "", count: r.count, matches: r.matches, local: false }, highlight: { nodes: ids, links: r.links.map((l) => l.id), label: r.title ?? key } });
    } catch {
      const r = patternLocal(get().data, key);
      set({ activePattern: { key, title: info?.title ?? key, description: info?.description ?? "", count: r.matches.length, matches: r.matches, local: true }, highlight: r.nodes.length ? { nodes: r.nodes, links: r.links, label: info?.title ?? key } : null });
    } finally {
      set({ busy: false });
    }
  },
  clearQuery() { set({ hits: [], answer: null, activePattern: null, highlight: null, qerror: null }); },
  resetCase() { set({ caseExtra: EMPTY, selection: null, inspector: { loading: false }, pathFrom: null, highlight: null }); },
}));
