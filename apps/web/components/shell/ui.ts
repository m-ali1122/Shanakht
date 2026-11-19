"use client";
import { create } from "zustand";
import { useStore } from "@/lib/store";
import { SCENARIOS } from "@/lib/scenarios";

/** Shell-only UI state: shortcut help, the G-chord, and what each queued transfer ended as. */
export type Outcome = "pending" | "checking" | "pass" | "review" | "stop" | "ask";
export interface Asked { q: string; a: string; lang: "ur" | "en"; rows: number }

interface UI {
  help: boolean;
  chord: boolean; // "G" pressed, waiting for I / V / G / A
  outcomes: Record<string, Outcome>;
  asked: Asked[]; // voice questions answered so far, newest first
  setHelp: (v: boolean) => void;
  setChord: (v: boolean) => void;
  clearOutcomes: () => void;
}

export const useUI = create<UI>((set) => ({
  help: false,
  chord: false,
  outcomes: {},
  asked: [],
  setHelp: (help) => set({ help }),
  setChord: (chord) => set({ chord }),
  clearOutcomes: () => set({ outcomes: {}, asked: [] }),
}));

/** Outcome of the scenario that is open right now, from the main store. */
export function liveOutcome(st: ReturnType<typeof useStore.getState>): Outcome | null {
  const sc = SCENARIOS[st.scenarioIdx];
  if (sc.key === "S6") return "ask";
  if (st.ringAlert) return "stop";
  if (st.payeePhase === "running") return "checking";
  if (st.payee) {
    if (st.caseStatus === "approved" && st.caseOut?.recommended_action === "proceed") return "pass";
    if (st.caseStatus === "rejected") return "stop";
    return st.payee.band === "MATCH" ? "pass" : st.payee.band === "CLOSE" ? "review" : "stop";
  }
  return null;
}

// Remember each scenario's last outcome so the queue keeps its glyphs after switching cases.
if (typeof window !== "undefined") {
  useStore.subscribe((st) => {
    const o = liveOutcome(st);
    if (!o || o === "ask") return;
    const key = SCENARIOS[st.scenarioIdx].key;
    const cur = useUI.getState().outcomes;
    if (cur[key] !== o) useUI.setState({ outcomes: { ...cur, [key]: o } });
  });
  useStore.subscribe((st, prev) => {
    const v = st.voice;
    if (!v || v === prev.voice) return;
    useUI.setState((u) => ({ asked: [{ q: v.transcript, a: v.answer, lang: v.language, rows: v.rows }, ...u.asked].slice(0, 6) }));
  });
}
