"use client";
import { useEffect, useRef } from "react";
import { Mic, Loader2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { MOCK } from "@/lib/api";

/**
 * Mic: idle = outline circle; listening = filled accent circle + level meter.
 * Real mode records webm via MediaRecorder and posts to /voice.
 * Mock mode simulates the level meter and answers the current scripted query.
 */
export function useMicController() {
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

let controller: { toggle: () => void } | null = null;
export const micToggle = () => controller?.toggle();

export default function MicButton() {
  const mic = useStore((s) => s.mic);
  const level = useStore((s) => s.level);
  const c = useMicController();
  controller = c;
  const listening = mic === "listening";
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-4 w-10 items-center gap-[2px]" aria-hidden>
        {listening &&
          [0.6, 1, 0.8, 0.5, 0.9].map((k, i) => (
            <span key={i} className="w-[3px] rounded-sm bg-accent transition-[height] duration-75" style={{ height: `${Math.max(2, level * k * 16)}px` }} />
          ))}
      </div>
      <button
        onClick={c.toggle}
        aria-pressed={listening}
        aria-label={listening ? "Stop listening" : "Ask by voice (V)"}
        title="Ask by voice (V)"
        className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors duration-150 ${
          listening ? "border-accent bg-accent text-surface" : "border-ink-2 text-ink-2 hover:border-accent hover:text-accent"
        }`}
      >
        {mic === "thinking" ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} strokeWidth={1.75} />}
      </button>
    </div>
  );
}
