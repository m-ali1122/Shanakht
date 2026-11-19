"use client";
import { useEffect, useRef } from "react";
import { Mic, Loader2, Square } from "lucide-react";
import { useStore } from "@/lib/store";
import { MOCK } from "@/lib/api";

/**
 * Mic controller. Real mode records webm via MediaRecorder and posts to /voice.
 * Mock mode simulates the level meter and answers the current scripted query.
 */
function useMicController() {
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const raf = useRef<number | null>(null);
  const stream = useRef<MediaStream | null>(null);

  const stopMeter = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  const start = async () => {
    const st = useStore.getState();
    if (st.mic !== "idle") return;
    if (MOCK) {
      st.setMic("listening", 0.2);
      const t0 = performance.now();
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        useStore.getState().setMic("listening", 0.25 + 0.55 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 2.1)));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream.current);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        useStore.getState().setMic("listening", Math.min(1, Math.sqrt(sum / buf.length) * 4));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
      chunks.current = [];
      const rec = new MediaRecorder(stream.current, { mimeType: "audio/webm" });
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stopMeter();
        stream.current?.getTracks().forEach((t) => t.stop());
        ctx.close();
        useStore.getState().voiceFromAudio(new Blob(chunks.current, { type: "audio/webm" }));
      };
      rec.start();
      recRef.current = rec;
      useStore.getState().setMic("listening", 0);
    } catch {
      useStore.getState().setMic("idle");
    }
  };

  const stop = () => {
    const st = useStore.getState();
    if (st.mic !== "listening") return;
    if (MOCK) {
      stopMeter();
      st.askVoice();
      return;
    }
    recRef.current?.stop();
    recRef.current = null;
  };

  const toggle = () => (useStore.getState().mic === "listening" ? stop() : start());

  useEffect(() => () => stopMeter(), []);
  return { toggle };
}

// Kept on globalThis so the director key keeps working across dev hot reloads.
const G = globalThis as unknown as { __shanakhtMic?: { toggle: () => void } };
export const micToggle = () => G.__shanakhtMic?.toggle();

/** Always mounted by the console so V works in every workspace. Renders nothing. */
export function MicHost() {
  const c = useMicController();
  G.__shanakhtMic = c;
  return null;
}

/** Level bars, driven by the store. */
export function MicLevel({ bars = 5, height = 16 }: { bars?: number; height?: number }) {
  const mic = useStore((s) => s.mic);
  const level = useStore((s) => s.level);
  const k = [0.6, 1, 0.8, 0.5, 0.9, 0.7, 1, 0.55, 0.85];
  return (
    <div className="flex items-center gap-[3px]" style={{ height }} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-sm transition-[height] duration-75 ${mic === "listening" ? "bg-main-ink" : "bg-rule"}`}
          style={{ height: `${mic === "listening" ? Math.max(3, level * k[i % k.length] * height) : 3}px` }}
        />
      ))}
    </div>
  );
}

/** The mic itself. `big` is the ask surface's button; the small one sits in the top bar. */
export function MicButton({ big = false }: { big?: boolean }) {
  const mic = useStore((s) => s.mic);
  const listening = mic === "listening";
  const size = big ? "h-12 w-12" : "h-8 w-8";
  const icon = big ? 22 : 14;
  return (
    <button
      onClick={() => micToggle()}
      aria-pressed={listening}
      aria-label={listening ? "Stop listening (V)" : "Ask by voice (V)"}
      title={listening ? "Stop listening (V)" : "Ask by voice (V)"}
      className={`flex shrink-0 items-center justify-center rounded-[4px] transition-colors duration-150 ${size} ${
        listening ? "bg-main text-white" : big ? "bg-main-soft text-main-ink hover:bg-main hover:text-white" : "text-fg-2 hover:bg-surface-2 hover:text-fg"
      }`}
    >
      {mic === "thinking" ? <Loader2 size={icon} className="animate-spin" /> : listening ? <Square size={icon - 4} fill="currentColor" /> : <Mic size={icon} strokeWidth={1.75} />}
    </button>
  );
}
