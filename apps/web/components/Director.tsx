"use client";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { MOCK } from "@/lib/api";
import { micToggle } from "./MicButton";

/** Hidden demo-director keys (spec 6.3). */
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

export default function Director() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useStore.getState();
      const k = e.key;
      if (k >= "1" && k <= "6") { st.setScenario(Number(k) - 1); return; }
      if (k === " ") { e.preventDefault(); st.next(); return; }
      if (k === "V" && e.shiftKey) { e.preventDefault(); playClip(); return; }
      if (k === "v") { micToggle(); return; }
      if (k === "t" || k === "T") { st.tamper(); return; }
      if (k === "r" || k === "R") { st.reset(); return; }
      if (k === "o" || k === "O") { st.toggleOffline(); return; }
      if (k === "Escape") { st.openExplorer(null); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
