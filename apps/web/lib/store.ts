"use client";
import { create } from "zustand";
import type { CaseOutput, EgressItem, GraphElements, Integrity, LedgerBlock, PayeeResult, StepEvent, VoiceResult } from "./types";
import { SCENARIOS, VOICE_QUERIES, FP, S5_RING, IBAN } from "./scenarios";
import { api, MOCK } from "./api";
import { caseForPayee } from "./mock";

type Phase = "idle" | "running" | "done" | "error";
type CaseStatus = "idle" | "running" | "ready" | "approving" | "approved" | "rejected";

interface State {
  scenarioIdx: number; // 0..5
  stepPtr: number;
  graph: GraphElements | null;
  focus: string[];
  highlight: string[];
  pulse: string[];
  pulseNonce: number;
  revealed: string[];

  payeePhase: Phase;
  payeeSteps: StepEvent[];
  payee: PayeeResult | null;
  ringAlert: { beneficiaries: number; banks: number; phones: number; devices: number } | null;

  caseId: string | null;
  caseStatus: CaseStatus;
  caseSteps: StepEvent[];
  caseOut: CaseOutput | null;
  integrity: Integrity | null;
  modelView: boolean;
  egress: EgressItem[];

  blocks: LedgerBlock[];
  explorer: LedgerBlock | null;
  flash: Record<string, number>;
  registryHit: { bank: string; fp: string; kind: string } | null;

  counter: { identifiers: number; tokens: number };
  mic: "idle" | "listening" | "thinking";
  level: number;
  voiceIdx: number;
  voice: VoiceResult | null;
  transcriptPending: string;
  offlineDot: boolean;
  error: string | null;
  busy: boolean;

  init: () => Promise<void>;
  setScenario: (idx: number) => Promise<void>;
  next: () => Promise<void>;
  runPayee: () => Promise<void>;
  runRing: () => void;
  runCase: () => Promise<void>;
  approve: () => Promise<void>;
  reject: () => Promise<void>;
  tamper: () => Promise<void>;
  reverify: () => Promise<void>;
  incoming: () => Promise<void>;
  setHighlight: (ids: string[]) => void;
  toggleModelView: () => Promise<void>;
  toggleOffline: () => void;
  openExplorer: (b: LedgerBlock | null) => void;
  askVoice: (idx?: number) => Promise<void>;
  voiceFromAudio: (blob: Blob) => Promise<void>;
  setMic: (m: State["mic"], level?: number) => void;
  reset: () => Promise<void>;
}

const APPROVER = "analyst-02";
let abort: AbortController | null = null;
let blockSeq = 1042;

function nowHM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function randHex(n: number) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return "0x" + Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function mkBlock(b: Omit<LedgerBlock, "id" | "hash" | "tx" | "ts"> & Partial<LedgerBlock>): LedgerBlock {
  return { id: blockSeq++, hash: randHex(8), tx: randHex(32), ts: nowHM(), ...b };
}

/** Live mode: scenario focus / ring highlight come from the real graph payload, never from fixtures. */
function liveFocus(g: GraphElements | null): string[] {
  const f = (g as any)?.focus_ids as string[] | undefined;
  return f && f.length ? f : [];
}
function liveRingIds(g: GraphElements | null): string[] {
  if (!g) return [];
  const kinds = new Set(["phone", "device", "fingerprint"]);
  const ids = g.nodes.filter((n) => kinds.has(n.data.kind) && !n.data.hollow || (n.data.kind === "phone" || n.data.kind === "device")).map((n) => n.data.id);
  return [...liveFocus(g), ...S5_RING, ...ids];
}
/** Map bare 64-hex fingerprint ids (as cited by the case agent) to graph node ids (fp:/ph:/dv: prefixed). */
function resolveIds(g: GraphElements | null, ids: string[]): string[] {
  if (!g) return ids;
  const have = new Set(g.nodes.map((n) => n.data.id));
  return ids.flatMap((id) => {
    if (have.has(id)) return [id];
    const c = ["ph:", "fp:", "dv:"].map((p) => p + id).filter((x) => have.has(x));
    return c.length ? c : [id];
  });
}
async function refreshBlocks(set: (f: (st: State) => Partial<State>) => void) {
  try {
    const fresh = await api.blocks();
    set((st) => {
      const seen = new Set(st.blocks.map((b) => b.id));
      return { blocks: [...st.blocks, ...fresh.filter((b) => !seen.has(b.id))] };
    });
  } catch { /* ledger poll is best effort */ }
}

const blank = {
  stepPtr: 0,
  highlight: [] as string[],
  pulse: [] as string[],
  payeePhase: "idle" as Phase,
  payeeSteps: [] as StepEvent[],
  payee: null,
  ringAlert: null,
  caseId: null,
  caseStatus: "idle" as CaseStatus,
  caseSteps: [] as StepEvent[],
  caseOut: null,
  integrity: null,
  modelView: false,
  egress: [] as EgressItem[],
  voice: null,
  transcriptPending: "",
  error: null,
  busy: false,
};

function mergeStep(steps: StepEvent[], e: StepEvent): StepEvent[] {
  // A "running" line is replaced by the next terminal event of the same step.
  const last = steps[steps.length - 1];
  if (last && last.status === "running" && last.step === e.step && e.status !== "running") {
    return [...steps.slice(0, -1), e];
  }
  return [...steps, e];
}

export const useStore = create<State>((set, get) => {
  // Keep the Space pointer in sync when an action is triggered by a button.
  const sync = (name: string) => {
    const st = get();
    const i = SCENARIOS[st.scenarioIdx].steps.indexOf(name as never);
    if (i >= 0 && st.stepPtr <= i) set({ stepPtr: i + 1 });
  };
  return {
  scenarioIdx: 0,
  graph: null,
  focus: SCENARIOS[0].focus,
  revealed: [],
  pulseNonce: 0,
  blocks: [],
  explorer: null,
  flash: {},
  registryHit: null,
  counter: { identifiers: 0, tokens: 0 },
  mic: "idle",
  level: 0,
  voiceIdx: 0,
  offlineDot: false,
  ...blank,

  async init() {
    try {
      const idx0 = get().scenarioIdx;
      const [graph, blocks] = await Promise.all([api.graph(SCENARIOS[idx0].key), api.blocks()]);
      if (get().scenarioIdx !== idx0) { set({ blocks }); return; } // user already switched scenario
      set({ graph, blocks, ...(MOCK ? {} : { focus: liveFocus(graph) }) });
    } catch (e: any) {
      set({ error: `Agent service unreachable (${e?.message ?? e})` });
    }
  },

  async setScenario(idx) {
    abort?.abort();
    abort = null;
    const sc = SCENARIOS[idx];
    set({ scenarioIdx: idx, focus: sc.focus, voiceIdx: 0, ...blank });
    if (!MOCK) {
      try { const graph = await api.graph(sc.key); set({ graph, focus: liveFocus(graph) }); } catch (e: any) { set({ error: String(e?.message ?? e) }); }
    }
  },

  async next() {
    const s = get();
    if (s.busy) return;
    const sc = SCENARIOS[s.scenarioIdx];
    const step = sc.steps[s.stepPtr];
    if (!step) return;
    set({ stepPtr: s.stepPtr + 1 });
    switch (step) {
      case "payee": return get().runPayee();
      case "ring": return get().runRing();
      case "case": return get().runCase();
      case "approve": return get().approve();
      case "incoming": return get().incoming();
      case "voice0": return get().askVoice(0);
      case "voice1": return get().askVoice(1);
      case "voice2": return get().askVoice(2);
    }
  },

  async runPayee() {
    const sc = SCENARIOS[get().scenarioIdx];
    abort?.abort();
    abort = new AbortController();
    set({ payeePhase: "running", payeeSteps: [], payee: null, busy: true, highlight: [] });
    sync("payee");
    try {
      await api.payeeCheck(sc.key, sc.transfer, (e) => {
        set((st) => ({ payeeSteps: mergeStep(st.payeeSteps, e) }));
        if (e.step === "final") {
          const r = e.data as PayeeResult;
          const caseId = r.case_id ?? (MOCK ? caseForPayee(sc.key) : undefined) ?? null;
          set({ payee: r, payeePhase: "done", caseId, highlight: MOCK ? sc.focus : liveFocus(get().graph) });
          if (!MOCK) { if (r.band !== "CLOSE") setTimeout(() => refreshBlocks(set), 300); }
          else if (r.band === "MATCH") {
            set((st) => ({ blocks: [...st.blocks, mkBlock({ kind: "auto", band: "MATCH", action: "auto_pass", approver: "auto", detail: { event: "DecisionLog.Anchored", transfer: sc.transfer.iban, score: r.score } })] }));
          } else if (r.band === "NO_MATCH") {
            set((st) => ({ blocks: [...st.blocks, mkBlock({ kind: "auto", band: "NO_MATCH", action: "hold", approver: "system", detail: { event: "DecisionLog.Anchored", transfer: sc.transfer.iban, score: r.score, note: "held before send" } })] }));
          }
        }
      }, abort.signal);
      if (!MOCK) api.counter().then((c) => set({ counter: { identifiers: c.identifiers_sent, tokens: c.tokens_substituted } })).catch(() => {});
    } catch (e: any) {
      if (e?.name !== "AbortError") set({ payeePhase: "error", error: String(e?.message ?? e) });
    } finally {
      set({ busy: false });
    }
  },

  runRing() {
    sync("ring");
    // Motif detector result: highlight the star and pulse ring members once.
    const live = !MOCK;
    const ids = live ? liveRingIds(get().graph) : ["RM-S5", ...S5_RING, "ph:" + FP.S5_PHONE, "fp:" + FP.S5_PHONE, "fp:" + FP.S5_DEVICE, "R-MRGL-S5-1", "R-MRGL-S5-2"];
    set((st) => ({
      ringAlert: { beneficiaries: S5_RING.length, banks: new Set(S5_RING.map((i) => i.slice(4, 8))).size, phones: 1, devices: 1 },
      caseId: "CASE-S5",
      highlight: ids,
      pulse: S5_RING,
      pulseNonce: st.pulseNonce + 1,
      payeePhase: "done",
    }));
  },

  async runCase() {
    const s = get();
    const sc = SCENARIOS[s.scenarioIdx];
    const caseId = s.caseId ?? (sc.key === "S5" ? "CASE-S5" : null);
    if (!caseId) return;
    if (sc.key === "S5" && !s.ringAlert) get().runRing();
    sync("case");
    abort?.abort();
    abort = new AbortController();
    set({ caseStatus: "running", caseSteps: [], caseOut: null, integrity: null, busy: true, caseId, egress: [], modelView: false });
    const trigger = sc.key === "S5"
      ? { type: "ring_alert" as const, ref_ids: ["RM-S5", ...S5_RING], case_id: caseId }
      : { type: "close_match" as const, ref_ids: [sc.transfer.remitter_id, sc.transfer.iban], case_id: caseId };
    try {
      await api.runCase(trigger, (e) => {
        set((st) => ({ caseSteps: mergeStep(st.caseSteps, e) }));
        if (e.step === "gateway" && MOCK) {
          const m = /(\d+) tokens/.exec(e.data?.text ?? "");
          if (m) set((st) => ({ counter: { ...st.counter, tokens: st.counter.tokens + Number(m[1]) } }));
        }
        if (e.step === "final") {
          const c = e.data as CaseOutput;
          set({ caseOut: c, integrity: c.integrity ?? null, caseStatus: "ready", caseId: c.id ?? caseId });
        }
      }, abort.signal);
      if (!MOCK) api.counter().then((c) => set({ counter: { identifiers: c.identifiers_sent, tokens: c.tokens_substituted } })).catch(() => {});
    } catch (e: any) {
      if (e?.name !== "AbortError") set({ caseStatus: "idle", error: String(e?.message ?? e) });
    } finally {
      set({ busy: false });
    }
  },

  async approve() {
    const s = get();
    if (!s.caseOut || !s.caseId || s.caseStatus !== "ready") return;
    if (s.integrity && s.integrity.items.some((i) => i.status !== "verified") && !MOCK) {
      // server refuses too; surface early
    }
    sync("approve");
    set({ caseStatus: "approving" });
    try {
      const res = await api.approve(s.caseId, APPROVER);
      let newBlocks = res.blocks ?? [];
      if (MOCK || newBlocks.length === 0) {
        const c = s.caseOut;
        const band = s.ringAlert ? "RING" : s.payee?.band;
        newBlocks = [mkBlock({ kind: "decision", band, action: c.recommended_action, approver: APPROVER, epoch: s.integrity?.epoch, detail: { event: "DecisionLog.Anchored", case: c.id, graphRoot: s.integrity?.root, epoch: s.integrity?.epoch, evidence_items: s.integrity?.verified, approverHash: "sha256(analyst-02)" } })];
        if (c.recommended_action === "hold_and_publish") {
          for (const fp of c.fingerprints_to_publish ?? []) {
            const kind = fp === FP.S5_DEVICE ? "device" : "phone";
            newBlocks.push(mkBlock({ kind: "publish", fp, fpKind: kind, bank: "MRGL", detail: { event: "MuleRegistry.Published", fp: "0x" + fp + "…", kind, publisherBank: 1 } }));
          }
        }
        newBlocks.push(mkBlock({ kind: "commit", epoch: (s.integrity?.epoch ?? 214) + 1, detail: { event: "GraphRootLog.Committed", note: "post-decision epoch" } }));
      }
      // ledger blocks slide in one by one
      for (const b of newBlocks) {
        set((st) => ({ blocks: [...st.blocks, b] }));
        await new Promise((r) => setTimeout(r, 220));
      }
      set({ caseStatus: "approved" });
      if (newBlocks.some((b) => b.kind === "publish")) {
        set((st) => ({ flash: { ...st.flash, Registry: Date.now() } }));
      }
    } catch (e: any) {
      set({ caseStatus: "ready", error: String(e?.message ?? e) });
    }
  },

  async reject() {
    const s = get();
    if (!s.caseId || s.caseStatus !== "ready") return;
    await api.reject(s.caseId, APPROVER);
    set((st) => ({ caseStatus: "rejected", blocks: [...st.blocks, mkBlock({ kind: "decision", band: st.ringAlert ? "RING" : st.payee?.band, action: "rejected", approver: APPROVER, detail: { event: "DecisionLog.Anchored", case: s.caseId, action: "rejected" } })] }));
  },

  async tamper() {
    const s = get();
    if (!s.caseId || !s.caseOut || s.busy) return;
    const target = s.caseOut.evidence[0]?.node_ids[0];
    if (!target) return;
    abort?.abort();
    abort = new AbortController();
    set({ busy: true, caseStatus: "running" });
    // immediate visual: re-verify marks the item red
    set((st) => ({
      caseSteps: [...st.caseSteps, { step: "tamper", status: "error", data: { text: `insider edit on ${target} (direct Neo4j write)` } }],
      integrity: MOCK && st.integrity ? { ...st.integrity, verified: st.integrity.verified - 1, items: st.integrity.items.map((i) => (i.id === target ? { ...i, status: "changed" } : i)) } : st.integrity,
    }));
    try {
      await api.tamper(s.caseId, target, (e) => {
        set((st) => ({ caseSteps: mergeStep(st.caseSteps, e) }));
        if (e.step === "integrity" && e.data?.items) set((st) => ({ integrity: { ...(st.integrity ?? e.data), ...e.data } }));
        if (e.step === "final") {
          const c = e.data as CaseOutput;
          set({ caseOut: c, integrity: c.integrity ?? get().integrity, caseStatus: "ready" });
        }
      }, abort.signal);
    } catch (e: any) {
      if (e?.name !== "AbortError") set({ error: String(e?.message ?? e), caseStatus: "ready" });
    } finally {
      set({ busy: false });
    }
  },

  async reverify() {
    const s = get();
    if (!s.caseId) return;
    if (MOCK) {
      set((st) => ({ caseSteps: [...st.caseSteps, { step: "integrity", status: st.integrity && st.integrity.verified < st.integrity.total ? "excluded" : "ok", data: { text: st.integrity ? `${st.integrity.verified} of ${st.integrity.total} evidence items verified against epoch ${st.integrity.epoch}` : "nothing to verify" } }] }));
      return;
    }
    await api.reverify(s.caseId, (e) => {
      set((st) => ({ caseSteps: mergeStep(st.caseSteps, e) }));
      if (e.step === "final") set({ caseOut: e.data, integrity: e.data.integrity ?? get().integrity });
      if (e.step === "integrity" && e.data?.items) set((st) => ({ integrity: st.integrity ? { ...st.integrity, ...e.data } : e.data }));
    });
  },

  async incoming() {
    const s = get();
    if (s.busy) return;
    sync("incoming");
    set((st) => ({ busy: true, revealed: [...st.revealed, IBAN.S5_6] }));
    try {
      const res = await api.incoming("INDS", { iban: IBAN.S5_6, typed_name: "Hamza Kh.", remitter: "RM-S5", amount: 190000 });
      if (res.registry_check === "HIT") {
        const fp = res.fingerprint;
        const kind = res.kind ?? "device";
        const block = res.block ?? mkBlock({ kind: "registry_hit", bank: "INDS", fp, fpKind: kind as any, detail: { event: "MuleRegistry.isFlagged", bank: "INDS", account: IBAN.S5_6, fp: "0x" + fp + "…", publisherBank: "MRGL (1)", shared: "fingerprint only; no name or number" } });
        set((st) => ({
          registryHit: { bank: "INDS", fp, kind },
          flash: { ...st.flash, INDS: Date.now(), Registry: Date.now() },
          blocks: [...st.blocks, block],
          highlight: [...st.highlight, IBAN.S5_6, "fp:" + FP.S5_DEVICE],
          pulse: [IBAN.S5_6],
          pulseNonce: st.pulseNonce + 1,
        }));
      }
    } catch (e: any) {
      set({ error: String(e?.message ?? e) });
    } finally {
      set({ busy: false });
    }
  },

  setHighlight(ids) { set({ highlight: MOCK ? ids : resolveIds(get().graph, ids) }); },

  async toggleModelView() {
    const s = get();
    if (!s.modelView && s.caseId) {
      try { set({ egress: await api.egress(s.caseId) }); } catch (e: any) { set({ error: String(e?.message ?? e) }); }
    }
    set({ modelView: !s.modelView });
  },

  toggleOffline() { set((s) => ({ offlineDot: !s.offlineDot })); },
  openExplorer(b) { set({ explorer: b }); },

  async askVoice(idx) {
    const i = idx ?? get().voiceIdx;
    const q = VOICE_QUERIES[i % VOICE_QUERIES.length];
    set({ mic: "thinking", transcriptPending: q.text, voice: null, voiceIdx: (i + 1) % VOICE_QUERIES.length });
    try {
      const r = await api.voiceText(q.text, i);
      set({ voice: r, highlight: MOCK ? r.highlight_ids : resolveIds(get().graph, r.highlight_ids ?? []), mic: "idle", transcriptPending: "" });
      if (MOCK) set((st) => ({ counter: { ...st.counter, tokens: st.counter.tokens + 1 } }));
    } catch (e: any) {
      set({ mic: "idle", error: String(e?.message ?? e) });
    }
  },

  async voiceFromAudio(blob) {
    const i = get().voiceIdx;
    set({ mic: "thinking", voice: null });
    try {
      const r = await api.voiceAudio(blob, i);
      set({ voice: r, highlight: MOCK ? r.highlight_ids : resolveIds(get().graph, r.highlight_ids ?? []), mic: "idle", voiceIdx: (i + 1) % VOICE_QUERIES.length });
    } catch (e: any) {
      set({ mic: "idle", error: String(e?.message ?? e) });
    }
  },

  setMic(m, level) { set({ mic: m, level: level ?? 0 }); },

  async reset() {
    abort?.abort();
    abort = null;
    blockSeq = 1042;
    await api.reset();
    const blocks = await api.blocks().catch(() => []);
    set({ scenarioIdx: 0, focus: MOCK ? SCENARIOS[0].focus : [], revealed: [], blocks, flash: {}, registryHit: null, counter: { identifiers: 0, tokens: 0 }, mic: "idle", voiceIdx: 0, explorer: null, ...blank });
    if (!MOCK) { const g = await api.graph(SCENARIOS[0].key).catch(() => get().graph); set({ graph: g, focus: liveFocus(g) }); }
  },
  };
});
