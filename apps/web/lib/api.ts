import type { EgressItem, GraphElements, LedgerBlock, StepEvent, TransferInfo, VoiceResult } from "./types";
import { postSSE, replay, sleep } from "./sse";
import * as mock from "./mock";
import { MOCK_GRAPH } from "./mockGraph";

export const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8103";
// Mock mode replays scripted fixtures; default ON until the services exist.
export const MOCK = (process.env.NEXT_PUBLIC_MOCK ?? "1") === "1";
export const OFFLINE = process.env.NEXT_PUBLIC_DEMO_OFFLINE === "1";

type On = (e: StepEvent) => void;

// ---- live-mode adapters: real agent responses -> UI shapes (derived only from real fields) ----
function hm(ts: unknown): string {
  if (typeof ts !== "string") return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function adaptBlock(b: any): LedgerBlock {
  return { ...b, ts: hm(b.ts), hash: b.hash ?? "", tx: b.tx ?? "" };
}
/** The log panel renders `data.text`; real events carry structured data, so derive a one-line summary from it. */
export function adaptEvent(e: StepEvent): StepEvent {
  const d: any = e.data ?? {};
  let status: StepEvent["status"] = e.status;
  const raw = e.status as string;
  if (raw === "warn") status = "excluded";
  else if (raw === "unavailable") status = "info";
  let text: string | undefined = d.text;
  if (!text) {
    switch (e.step) {
      case "start": text = `case ${d.case_id} opened, max ${d.max_tool_calls} tool calls`; break;
      case "model": text = d.fallback ? `LLM unavailable; ${d.fallback}` : undefined; break;
      case "cypher": if (typeof d.row_count === "number") text = `${d.row_count} row${d.row_count === 1 ? "" : "s"} returned`; break;
      case "integrity": if (typeof d.verified === "number") text = `${d.verified} of ${d.total} evidence items verified against epoch ${d.epoch}` + (d.note ? `; ${d.note}` : ""); break;
      case "evidence": text = `${d.items} cited claim${d.items === 1 ? "" : "s"} kept` + (d.stripped?.length ? `, ${d.stripped.length} stripped` : ""); break;
    }
  }
  if (e.step === "cypher" && d.error) status = "error";
  return { ...e, status, data: text !== undefined ? { ...d, text } : d };
}
const wrap = (on: On): On => (e) => on(adaptEvent(e));

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(AGENT_URL + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(AGENT_URL + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const api = {
  async graph(scenarioKey: string): Promise<GraphElements> {
    if (MOCK) return MOCK_GRAPH;
    // S6 has no graph of its own on the server (empty); it queries the S5 ring graph.
    return getJSON<GraphElements>(`/graph/scenario/${scenarioKey === "S6" ? "S5" : scenarioKey}`);
  },

  async payeeCheck(scenarioKey: string, t: TransferInfo, on: On, signal?: AbortSignal) {
    if (MOCK) return replay(mock.payeeEvents(scenarioKey), on, signal);
    return postSSE(`${AGENT_URL}/payee-check`, {
      scenario: scenarioKey, exchange_house: t.exchange_house, remitter_id: t.remitter_id,
      typed_name: t.typed_name, iban: t.iban, amount: t.amount_pkr,
    }, on, signal);
  },

  async runCase(trigger: { type: "close_match" | "ring_alert"; ref_ids: string[]; case_id?: string }, on: On, signal?: AbortSignal) {
    if (MOCK) return replay(mock.caseEvents(trigger.case_id ?? "CASE-S5"), on, signal);
    return postSSE(`${AGENT_URL}/case`, { trigger: { type: trigger.type, ref_ids: trigger.ref_ids } }, wrap(on), signal);
  },

  async approve(caseId: string, approver: string): Promise<{ blocks: LedgerBlock[] }> {
    if (MOCK) { await sleep(500); return { blocks: [] }; } // store composes mock blocks
    const r = await postJSON<{ blocks: any[] }>(`/case/${caseId}/approve`, { approver_id: approver });
    return { ...r, blocks: (r.blocks ?? []).map(adaptBlock) };
  },

  async reject(caseId: string, approver: string): Promise<{ blocks: LedgerBlock[] }> {
    if (MOCK) { await sleep(300); return { blocks: [] }; }
    return postJSON(`/case/${caseId}/reject`, { approver_id: approver });
  },

  /** Insider edit on one evidence node, then re-verify and re-run the agent. */
  async tamper(caseId: string, elementId: string, on: On, signal?: AbortSignal) {
    if (MOCK) return replay(mock.caseRerunEvents(caseId, elementId), on, signal);
    await postJSON(`/integrity/tamper`, { element_id: elementId });
    return postSSE(`${AGENT_URL}/case/${caseId}/reverify`, {}, wrap(on), signal);
  },

  async reverify(caseId: string, on: On, signal?: AbortSignal) {
    if (MOCK) return;
    return postSSE(`${AGENT_URL}/case/${caseId}/reverify`, {}, wrap(on), signal);
  },

  async egress(caseId: string): Promise<EgressItem[]> {
    if (MOCK) {
      const raw = mock.egressFor(caseId);
      return Promise.all(raw.map(async (r) => ({ ...r, sha256: await sha256Hex(r.payload) })));
    }
    const r = await getJSON<{ items: any[] }>(`/gateway/egress?case_id=${encodeURIComponent(caseId)}`);
    return (r.items ?? []).map((i) => ({
      call: i.purpose ?? "model call",
      provider: i.provider, model: i.model,
      payload: JSON.stringify(i.payload?.request?.messages ?? i.payload, null, 2),
      sha256: i.sha256,
      tokens: (i.prompt_tokens ?? 0) + (i.completion_tokens ?? 0),
      ts: new Date((i.ts ?? 0) * 1000).toISOString(),
    }));
  },

  async counter(): Promise<{ identifiers_sent: number; tokens_substituted: number }> {
    if (MOCK) return { identifiers_sent: 0, tokens_substituted: 0 };
    const c = await getJSON<any>(`/gateway/counter`);
    return { identifiers_sent: c.identifiers_sent_to_model ?? 0, tokens_substituted: c.tokens_substituted ?? 0 };
  },

  async blocks(): Promise<LedgerBlock[]> {
    if (MOCK) return mock.SEED_BLOCKS;
    const r = await getJSON<any[]>(`/ledger/blocks?limit=20`);
    return r.map(adaptBlock).sort((a, b) => a.id - b.id);
  },

  async voiceText(text: string, mockIndex?: number): Promise<VoiceResult> {
    if (MOCK) { await sleep(900); return mock.voiceResult(mockIndex ?? 0); }
    return postJSON<VoiceResult>(`/voice/text`, { text });
  },

  async voiceAudio(blob: Blob, mockIndex?: number): Promise<VoiceResult> {
    if (MOCK) { await sleep(1100); return mock.voiceResult(mockIndex ?? 0); }
    const fd = new FormData();
    fd.append("audio", blob, "query.webm");
    const r = await fetch(`${AGENT_URL}/voice`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`/voice: ${r.status}`);
    return r.json();
  },

  /** S5 multi-bank moment: a partner bank receives a transfer and checks the registry. */
  async incoming(bank: string, payload: Record<string, unknown>): Promise<{ registry_check: "HIT" | "CLEAR"; fingerprint: string; kind?: string; block?: LedgerBlock }> {
    if (MOCK) { await sleep(700); return { registry_check: "HIT", fingerprint: "7be14c02d9a6e35f", kind: "device" }; }
    const r = await postJSON<any>(`/banks/${bank}/incoming`, payload);
    return { ...r, block: r.block ? adaptBlock(r.block) : undefined };
  },

  async reset(): Promise<void> {
    if (MOCK) return;
    try { await postJSON(`/demo/reset`, {}); } catch { /* best effort */ }
  },
};
