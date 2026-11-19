"use client";
import { useEffect } from "react";
import { useStore, type View } from "@/lib/store";
import { MOCK } from "@/lib/api";
import { micToggle } from "@/components/shell/mic";
import { useUI } from "@/components/shell/ui";

/** Demo-director keys (spec 6.3), plus the workspace chord: G then I / V / G / A. */
async function playClip() {
  const st = useStore.getState();
  const i = st.voiceIdx;
  if (MOCK) return st.askVoice(i);
  try {
    const r = await fetch(`/audio/voice-${i}.wav`);
    if (!r.ok) throw new Error("no clip");
    const blob = await r.blob();
    new Audio(URL.createObjectURL(blob)).play().catch(() => {});
    return st.voiceFromAudio(blob);
  } catch {
    return st.askVoice(i);
  }
}

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

const CHORD: Record<string, View> = { i: "inbound", v: "investigate", g: "graph", a: "audit" };
let chordTimer: ReturnType<typeof setTimeout> | null = null;

export default function Director() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing) return;
      if (isTyping(e.target) || isTyping(document.activeElement)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useStore.getState();
      const ui = useUI.getState();
      const k = e.key;
      const lk = k.toLowerCase();

      // Second key of the workspace chord wins over the single-key shortcuts.
      if (ui.chord) {
        if (chordTimer) clearTimeout(chordTimer);
        ui.setChord(false);
        if (CHORD[lk] && !e.shiftKey) { e.preventDefault(); st.setView(CHORD[lk]); return; }
        if (k === "Escape") return;
      } else if (lk === "g" && !e.shiftKey) {
        e.preventDefault();
        ui.setChord(true);
        chordTimer = setTimeout(() => useUI.getState().setChord(false), 1500);
        return;
      }

      if (k === "?") { e.preventDefault(); ui.setHelp(!ui.help); return; }
      if (k.length === 1 && k >= "1" && k <= "6") { st.setScenario(Number(k) - 1); return; }
      if (k === " " || e.code === "Space") {
        e.preventDefault(); st.next(); return;
      }
      if (lk === "v") { e.preventDefault(); if (e.shiftKey) playClip(); else micToggle(); return; }
      if (lk === "t") { st.tamper(); return; }
      if (lk === "r") { ui.clearOutcomes(); st.reset(); return; }
      if (lk === "o") { st.toggleOffline(); return; }
      if (k === "Escape") { if (ui.help) ui.setHelp(false); else st.openExplorer(null); return; }
    };
    // Capture phase on window: survives focus changes and hot reloads (listener is removed on unmount).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return null;
}
