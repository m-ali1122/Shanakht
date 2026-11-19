// Typed client for the graph explore API (docs/CONSOLE_V2.md, "Backend API").
// Same base URL and fetch style as lib/api.ts; every call throws GraphApiError on non-2xx.
import { AGENT_URL } from "./api";
import type { GraphElements, VoiceResult } from "./types";
import { normalise, adaptCy, type GData, type NodeDetail, type EdgeDetail } from "./graphAdapt";

export class GraphApiError extends Error {
  constructor(public path: string, public status: number) {
    super(`${path}: ${status}`);
  }
}

async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(AGENT_URL + path, { signal });
  if (!r.ok) throw new GraphApiError(path, r.status);
  return r.json();
}
async function postJSON<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(AGENT_URL + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!r.ok) throw new GraphApiError(path, r.status);
  return r.json();
}
const q = encodeURIComponent;

export type GrandStats = {
  total_nodes: number; total_edges: number; shown_nodes: number; shown_edges: number;
  by_kind: Record<string, number>; by_rel: Record<string, number>; by_bank: Record<string, number>;
};
export type SearchHit = { id: string; label: string; kind: string; bank?: string | null; match: string };
export type PatternInfo = { key: string; title: string; description: string };
export type PatternResult = PatternInfo & GData & { matches: string[][]; count: number };

export const graphApi = {
  async grand(limit = 2500, signal?: AbortSignal): Promise<GData & { stats?: GrandStats }> {
    const r = await getJSON<any>(`/graph/grand?limit=${limit}`, signal);
    return { ...normalise(r), stats: r.stats };
  },
  async scenario(sid: string, signal?: AbortSignal): Promise<GData> {
    const r = await getJSON<GraphElements>(`/graph/scenario/${q(sid)}`, signal);
    return adaptCy(r, sid);
  },
  node(id: string, signal?: AbortSignal): Promise<NodeDetail> {
    return getJSON<NodeDetail>(`/graph/node/${q(id)}`, signal);
  },
  edge(rel: string, source: string, target: string, signal?: AbortSignal): Promise<EdgeDetail> {
    return getJSON<EdgeDetail>(`/graph/edge?rel=${q(rel)}&source=${q(source)}&target=${q(target)}`, signal);
  },
  async search(text: string, limit = 20, signal?: AbortSignal): Promise<SearchHit[]> {
    const r = await getJSON<{ results: SearchHit[] }>(`/graph/search?q=${q(text)}&limit=${limit}`, signal);
    return r.results ?? [];
  },
  async expand(id: string, depth = 1, signal?: AbortSignal): Promise<GData> {
    return normalise(await getJSON<any>(`/graph/expand?id=${q(id)}&depth=${depth}`, signal));
  },
  async patterns(signal?: AbortSignal): Promise<PatternInfo[]> {
    const r = await getJSON<{ patterns: PatternInfo[] }>(`/graph/patterns`, signal);
    return r.patterns ?? [];
  },
  async pattern(key: string, signal?: AbortSignal): Promise<PatternResult> {
    const r = await getJSON<any>(`/graph/pattern/${q(key)}`, signal);
    return { ...r, ...normalise(r), matches: r.matches ?? [], count: r.count ?? (r.matches ?? []).length };
  },
  async path(source: string, target: string, max = 6, signal?: AbortSignal): Promise<GData> {
    return normalise(await getJSON<any>(`/graph/path?source=${q(source)}&target=${q(target)}&max=${max}`, signal));
  },
  /** Natural-language question, answered by the existing voice text endpoint. */
  ask(text: string, signal?: AbortSignal): Promise<VoiceResult & { error?: string }> {
    return postJSON(`/voice/text`, { text }, signal);
  },
};
