"use client";
import { useStore } from "@/lib/store";
import { VOICE_QUERIES } from "@/lib/scenarios";
import { MicButton, MicLevel } from "./mic";
import { useUI } from "./ui";

function Answer({ text, lang, big }: { text: string; lang: "ur" | "en"; big?: boolean }) {
  return lang === "ur" ? (
    <p className={`urdu text-fg ${big ? "text-[24px]" : "text-[17px]"}`} lang="ur" style={{ lineHeight: 2.1 }}>{text}</p>
  ) : (
    <p className={`text-fg ${big ? "text-[20px] font-medium leading-snug" : "text-[14px] leading-snug"}`}>{text}</p>
  );
}

/** Case 6: the crossing becomes a place to ask the graph out loud. */
export default function AskSurface() {
  const mic = useStore((s) => s.mic);
  const voice = useStore((s) => s.voice);
  const pending = useStore((s) => s.transcriptPending);
  const voiceIdx = useStore((s) => s.voiceIdx);
  const ask = useStore((s) => s.askVoice);
  const asked = useUI((s) => s.asked);
  const transcript = voice?.transcript ?? pending;
  const earlier = voice ? asked.slice(1) : asked;

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col">
      <div className="flex items-center gap-4">
        <MicButton big />
        <div className="min-w-0 flex-1">
          {transcript ? (
            <p className="text-[22px] font-medium leading-snug text-fg line-in" key={transcript}>&ldquo;{transcript}&rdquo;</p>
          ) : (
            <p className="text-[18px] text-fg-2">
              {mic === "listening" ? "Listening…" : <>Ask in Urdu or English. <kbd className="key">V</kbd> to speak, <kbd className="key">Shift V</kbd> plays a recorded question.</>}
            </p>
          )}
        </div>
        {mic === "listening" && <MicLevel bars={9} height={28} />}
      </div>

      <div className="mt-5 min-h-[96px] rounded-[var(--radius)] border border-rule bg-surface px-5 py-4">
        {voice ? (
          <div className="line-in" key={voice.answer}>
            <div className="mb-1 flex items-center gap-2 text-[12px] text-muted">
              Answer · {voice.language === "ur" ? "Urdu" : "English"} · {voice.rows} row{voice.rows === 1 ? "" : "s"} from the graph
            </div>
            <Answer text={voice.answer} lang={voice.language} big />
          </div>
        ) : (
          <p className="text-[14px] text-muted">{mic === "thinking" ? "Querying the graph…" : "The answer appears here, in the language you asked in."}</p>
        )}
      </div>

      {earlier.length > 0 && (
        <ol className="mt-4 space-y-1.5">
          {earlier.map((a, i) => (
            <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-baseline gap-4 border-b border-rule pb-1.5 text-[13px]">
              <span className="truncate text-fg-2">&ldquo;{a.q}&rdquo;</span>
              <span className="min-w-0 truncate">{a.lang === "ur" ? <span className="urdu text-[15px] text-fg" lang="ur">{a.a}</span> : <span className="text-fg">{a.a}</span>}</span>
              <span className="text-[12px] tabular-nums text-muted">{a.rows} rows</span>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-6">
        <div className="mb-2 text-[13px] font-medium text-fg-2">Questions to try</div>
        <ol className="grid gap-2">
          {VOICE_QUERIES.map((q, i) => (
            <li key={i}>
              <button
                onClick={() => ask(i)}
                disabled={mic === "thinking"}
                className={`flex w-full items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-left text-[14px] transition-colors duration-150 disabled:opacity-60 ${
                  i === voiceIdx ? "border-main/60 bg-main-soft text-fg" : "border-rule text-fg-2 hover:border-fg-2/40 hover:text-fg"
                }`}
              >
                <span className={`w-14 shrink-0 text-[12px] font-medium ${i === voiceIdx ? "text-main-ink" : "text-muted"}`}>{q.lang === "ur" ? "Urdu" : "English"}</span>
                <span className="min-w-0 flex-1">{q.text}</span>
                {i === voiceIdx && <span className="shrink-0 text-[12px] text-main-ink">next</span>}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
