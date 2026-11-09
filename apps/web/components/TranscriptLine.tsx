"use client";
import { useStore } from "@/lib/store";

/** Sits under the top bar; transcript in the language spoken, answer beside it. */
export default function TranscriptLine() {
  const voice = useStore((s) => s.voice);
  const pending = useStore((s) => s.transcriptPending);
  const mic = useStore((s) => s.mic);
  const transcript = voice?.transcript ?? pending;
  return (
    <div className="flex h-11 shrink-0 items-center gap-4 border-b border-rule bg-paper px-4">
      <span className="label shrink-0">Ask the graph</span>
      {transcript ? (
        <>
          <span className="truncate text-[14px] text-ink-2 line-in" key={transcript}>
            &ldquo;{transcript}&rdquo;
          </span>
          {voice ? (
            <span className="ml-auto flex min-w-0 items-center gap-3 line-in" key={voice.answer}>
              <span className="label shrink-0">{voice.language === "ur" ? "Answer · Urdu" : "Answer"}</span>
              {voice.language === "ur" ? (
                <span className="urdu truncate text-[17px] text-ink" style={{ lineHeight: 2.1 }} lang="ur">
                  {voice.answer}
                </span>
              ) : (
                <span className="truncate text-[14px] text-ink">{voice.answer}</span>
              )}
              <span className="mono shrink-0 text-[11px] text-muted">{voice.rows} rows</span>
            </span>
          ) : (
            <span className="mono ml-auto text-[12px] text-muted">{mic === "thinking" ? "querying graph…" : ""}</span>
          )}
        </>
      ) : (
        <span className="text-[13px] text-muted">{mic === "listening" ? "Listening…" : "Press V or the mic to ask in Urdu or English."}</span>
      )}
    </div>
  );
}
