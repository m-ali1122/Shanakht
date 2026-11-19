"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { ArrowRight, Mic } from "lucide-react";
import { useStore, sharedIdentifiers } from "@/lib/store";
import { SCENARIOS, S5_RING, IBAN, VOICE_QUERIES } from "@/lib/scenarios";
import type { AlignmentItem, StepEvent } from "@/lib/types";
import { reasonText } from "@/lib/guide";
import { Pipeline, type PipelineStage } from "@/components/shell/Pipeline";
import { BankDot, BANK_NAME, BAND_INK, BAND_WORD, OutcomeGlyph, outcomeWord, shortIban } from "@/components/shell/bits";
import { MicButton, MicLevel } from "@/components/shell/mic";
import { useUI, liveOutcome, type Outcome } from "@/components/shell/ui";

/* ------------------------------------------------------------------ helpers */

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (d?: string | null) => (d ? `${MONTH[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : "");
const isUrdu = (s?: string | null) => !!s && /[؀-ۿ]/.test(s);

const ACTION: Record<string, { text: string; tone: string }> = {
  auto_pass: { text: "Release automatically", tone: "var(--match-ink)" },
  review: { text: "Hold and open a case", tone: "var(--close-ink)" },
  hold: { text: "Hold before sending", tone: "var(--nomatch-ink)" },
};

/**
 * The displayed frontier walks toward the real one a stage at a time, so stages that arrive together
 * (one SSE event feeds two stages; the ring scan is instant) still read left to right. Reduced motion: jump.
 */
function useStepper(target: number, gap = 420) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(target);
  useEffect(() => {
    if (reduce || target < shown) { setShown(target); return; }
    if (target === shown) return;
    const id = setTimeout(() => setShown((s) => Math.min(target, s + 1)), gap);
    return () => clearTimeout(id);
  }, [target, shown, reduce, gap]);
  return Math.min(shown, target);
}

/** Elapsed ms since `key` became non-null (ticks while it is set). */
function useElapsed(key: string | null) {
  const t0 = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });
  const [now, setNow] = useState(0);
  if (t0.current.key !== key) t0.current = { key, at: typeof performance !== "undefined" ? performance.now() : 0 };
  useEffect(() => {
    if (!key) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [key]);
  return key ? Math.max(0, Math.round(now - t0.current.at)) : undefined;
}

/** Turn real flags into stage states with a stepped frontier. `real[i]` = stage i finished. */
function useStates(real: boolean[], running: boolean, failed: boolean) {
  let realF = -1;
  for (let i = 0; i < real.length; i++) { if (real[i]) realF = i; else break; }
  const f = useStepper(realF);
  const states = real.map((_, i): PipelineStage["state"] => {
    if (i <= f) return "done";
    if (i === f + 1 && (running || f < realF)) return failed && f === realF ? "error" : "active";
    return "pending";
  });
  const activeIdx = states.findIndex((s) => s === "active");
  return { states, activeIdx, frontier: f };
}

const Small = ({ children, className = "" }: { children: ReactNode; className?: string }) => <div className={`text-[12px] leading-snug text-muted ${className}`}>{children}</div>;

/* ---------------------------------------------------------------- case picker */

function CasePicker() {
  const idx = useStore((s) => s.scenarioIdx);
  const setScenario = useStore((s) => s.setScenario);
  const live = useStore(liveOutcome);
  const outcomes = useUI((s) => s.outcomes);
  return (
    <nav className="flex h-11 shrink-0 items-stretch gap-1 border-b border-rule px-6" aria-label="Cases">
      {SCENARIOS.map((sc, i) => {
        const on = i === idx;
        const stored = outcomes[sc.key];
        const o: Outcome = sc.key === "S6" ? "ask" : on ? live ?? "pending" : stored && stored !== "checking" ? stored : "pending";
        return (
          <button
            key={sc.key}
            onClick={() => setScenario(i)}
            aria-current={on ? "true" : undefined}
            title={`${outcomeWord(o)} (press ${i + 1})`}
            className={`relative flex items-center gap-2 px-3 text-[13px] transition-colors duration-150 ${on ? "font-semibold text-fg" : "text-fg-2 hover:text-fg"}`}
          >
            <span className="font-mono text-[11px] text-muted">{i + 1}</span>
            {sc.key === "S6" ? "Ask the graph" : sc.transfer.typed_name}
            <OutcomeGlyph o={o} size={14} />
            <span className={`absolute inset-x-3 bottom-0 h-[2px] ${on ? "bg-fg" : "bg-transparent"}`} aria-hidden />
          </button>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------ payee pipeline */

const TF: Record<string, (v: string) => string> = {
  patronymic_split: (v) => `father’s name (${v}) set aside`,
  initial_expanded: (v) => v.replace("->", " → "),
  title_stripped: (v) => `honorific “${v}” removed`,
  script_converted: (v) => v.replace("->", " → "),
  variant: (v) => `${v.replace("->", " → ")} (spelling)`,
};
function transformations(p: any): string[] {
  return ((p?.transformations ?? []) as string[]).map((t) => {
    const [k, ...rest] = t.split(":");
    const v = rest.join(":");
    return TF[k] ? TF[k](v) : t.replaceAll("_", " ");
  });
}

const REL: Record<string, { word: string; color: string }> = {
  exact: { word: "same", color: "var(--match-ink)" },
  initial: { word: "short form", color: "var(--close-ink)" },
  variant: { word: "spelling", color: "var(--close-ink)" },
  transliterated: { word: "spelling, via Urdu", color: "var(--close-ink)" },
  dropped: { word: "no partner", color: "var(--muted)" },
  extra: { word: "not typed", color: "var(--muted)" },
};

function Alignment({ items, anyPair }: { items: (AlignmentItem & { urdu_token?: string })[]; anyPair: boolean }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => {
        const r = REL[it.relation] ?? REL.extra;
        const lone = it.typed_token === null || it.title_token === null;
        const word = lone
          ? it.reason && it.reason !== "DIFFERENT_PERSON" ? reasonText(it.reason).toLowerCase() : it.typed_token !== null ? "no partner on the account" : "not typed"
          : r.word;
        return (
          <li key={i} className="text-[13px] leading-tight">
            <span className={`font-medium ${lone && anyPair ? "text-muted line-through" : "text-fg"}`}>{it.typed_token ?? "—"}</span>
            <span className="mx-1 text-muted">→</span>
            <span className={`uppercase tracking-[0.02em] ${it.title_token ? "text-fg" : "text-muted"}`}>{it.title_token ?? "—"}</span>
            <div className="mt-0.5 flex items-baseline gap-1.5 text-[12px]" style={{ color: r.color }}>
              {word}
              {it.urdu_token && <span className="urdu text-[14px] text-fg" lang="ur" style={{ lineHeight: 1.4 }}>{it.urdu_token}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function PayeePipeline() {
  const idx = useStore((s) => s.scenarioIdx);
  const steps = useStore((s) => s.payeeSteps);
  const phase = useStore((s) => s.payeePhase);
  const payee = useStore((s) => s.payee);
  const t = SCENARIOS[idx].transfer;
  const ev = (n: string): StepEvent | undefined => [...steps].reverse().find((e) => e.step === n && e.status !== "running");
  const tf = ev("title_fetch"), cp = ev("compare"), hs = ev("history"), dc = ev("decision"), ph = ev("phrase"), lg = ev("ledger");
  const p = payee as any;

  const real = [true, !!tf, !!cp, !!cp, !!hs, !!dc, !!ph];
  const { states, activeIdx } = useStates(real, phase === "running", phase === "error");
  const ids = ["received", "title", "parsed", "aligned", "history", "decision", "explained"];
  const elapsed = useElapsed(activeIdx >= 0 ? ids[activeIdx] + phase : null);

  const title: string | null = p?.title ?? tf?.data?.title ?? null;
  const urdu: string | null = p?.urdu_name ?? tf?.data?.urdu_name ?? null;
  const c = cp?.data ?? {};
  const alignment = (p?.alignment ?? c.alignment ?? []) as AlignmentItem[];
  const band: string | null = p?.band ?? c.band ?? null;
  const score: number | null = p?.score ?? c.score ?? null;
  const reasons: string[] = p?.reasons ?? c.reasons ?? [];
  const anyPair = alignment.some((a) => a.typed_token !== null && a.title_token !== null);
  const action = dc?.data?.action as string | undefined;
  const banner: string | null = dc?.data?.banner ?? p?.banner ?? null;
  const h = hs?.data ?? {};
  const phr = ph?.data ?? p?.phrase ?? p?.explain ?? {};

  const stages: PipelineStage[] = [
    {
      id: "received", label: "Received", state: states[0],
      detail: (
        <>
          <div className="text-[17px] font-semibold leading-tight text-fg">{t.typed_name}</div>
          <Small className="mt-1">typed by {t.sender}<br />via {t.exchange_name}, {t.country}</Small>
          <div className="mt-1.5 text-[13px] tabular-nums text-fg-2">{t.currency} {t.amount_fx.toLocaleString("en-US")} <span className="text-muted">· PKR {t.amount_pkr.toLocaleString("en-US")}</span></div>
        </>
      ),
    },
    {
      id: "title", label: "Title fetched", state: states[1], ms: states[1] === "active" ? elapsed : tf?.ms,
      detail: tf ? (
        title ? (
          <>
            <div className="text-[15px] font-semibold uppercase leading-tight tracking-[0.02em] text-fg">{title}</div>
            <div className="mt-1 flex items-center gap-1.5 text-[12px] text-fg-2"><BankDot code={t.bank} size={6} />{BANK_NAME[t.bank] ?? t.bank}</div>
            {urdu && <div className="urdu mt-0.5 text-[18px] text-fg" lang="ur" style={{ lineHeight: 1.9, textAlign: "left" }}>{urdu}</div>}
          </>
        ) : <div className="text-[13px] font-medium text-nomatch-ink">Account not found</div>
      ) : null,
    },
    {
      id: "parsed", label: "Names parsed", state: states[2],
      detail: cp ? (
        <>
          <Small>typed</Small>
          <div className="mono text-fg">{(c.typed_parsed?.tokens_canonical ?? []).join(" ") || "—"}</div>
          <Small className="mt-1.5">account</Small>
          <div className="mono text-fg">{(c.title_parsed?.tokens_canonical ?? []).join(" ") || "—"}</div>
          {[...transformations(c.typed_parsed), ...transformations(c.title_parsed)].length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[12px] text-fg-2">
              {[...transformations(c.typed_parsed), ...transformations(c.title_parsed)].map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          )}
        </>
      ) : null,
    },
    {
      id: "aligned", label: "Tokens aligned", state: states[3], ms: states[3] === "active" ? elapsed : cp?.ms,
      detail: cp ? (
        <>
          {alignment.length ? <Alignment items={alignment} anyPair={anyPair} /> : null}
          {!anyPair && <div className="mt-1 text-[12px] font-medium text-nomatch-ink">No name in common</div>}
          {reasons.includes("SCRIPT_CONVERTED") && urdu && (
            <div className="mt-3 text-[12px] text-fg-2">Matched through the KYC name<div className="urdu text-[17px] text-fg" lang="ur" style={{ lineHeight: 1.9, textAlign: "left" }}>{urdu}</div></div>
          )}
        </>
      ) : null,
    },
    {
      id: "history", label: "History checked", state: states[4], ms: states[4] === "active" ? elapsed : hs?.ms,
      detail: hs ? (
        h.prior_transfers ? (
          <><div className="text-[15px] font-semibold tabular-nums text-fg">{h.prior_transfers} earlier</div><Small>transfers from this sender since {month(h.first)}</Small></>
        ) : <><div className="text-[15px] font-semibold text-fg">None</div><Small>No earlier transfers to this account</Small></>
      ) : null,
    },
    {
      id: "decision", label: "Decision", state: states[5], emphasis: true, ms: states[5] === "active" ? elapsed : dc?.ms,
      tone: band ? BAND_INK[band] : undefined,
      detail: dc && band ? (
        <>
          <div key={band} className="stamp-in text-[24px] font-bold leading-none tracking-[-0.01em]" style={{ color: BAND_INK[band] }}>{BAND_WORD[band]}</div>
          {score != null && <div className="mono mt-1.5 text-fg-2">score {Number(score).toFixed(2)}</div>}
          {action && ACTION[action] && <div className="mt-2 text-[13px] font-semibold" style={{ color: ACTION[action].tone }}>{ACTION[action].text}</div>}
          {banner && <p className="mt-2 text-[13px] leading-snug text-nomatch-ink">{banner}</p>}
          {lg?.data?.block != null && <Small className="mt-2">Anchored on chain, block <span className="font-mono">#{lg.data.block}</span></Small>}
        </>
      ) : null,
    },
    {
      id: "explained", label: "Explained", state: states[6], ms: states[6] === "active" ? elapsed : ph?.ms,
      detail: ph ? (
        <>
          {phr.en && <p className="text-[13px] leading-snug text-fg">{phr.en}</p>}
          {phr.ur && <p className="urdu mt-1 text-[15px] text-fg-2" lang="ur" style={{ lineHeight: 2, textAlign: "left" }}>{phr.ur}</p>}
          <Small className="mt-1">{ph.data?.source === "llm" ? "Written by the model through the masking gateway" : "Template wording, no model call"}</Small>
        </>
      ) : null,
    },
  ];

  const done = phase === "done" && states.every((s) => s === "done");
  const total = [tf, cp, hs, dc, ph, lg].reduce((a, e) => a + (e?.ms ?? 0), 0);
  return (
    <>
      <Pipeline stages={stages} />
      <Footer>
        {phase === "idle" && <span className="text-[14px] text-fg-2">The transfer is in. Press <kbd className="key">Space</kbd> to check the payee before any money moves.</span>}
        {phase === "running" && <span className="text-[14px] text-fg-2">Checking… each stage lights up as the bank answers.</span>}
        {phase === "error" && <span className="text-[14px] text-nomatch-ink">The check stopped. Press <kbd className="key">R</kbd> to reset.</span>}
        {done && (
          <span className="text-[14px] text-fg-2">
            Checked in <span className="font-mono tabular-nums text-fg">{(total / 1000).toFixed(1)} s</span>
            {action === "auto_pass" && <> · <span className="font-medium text-match-ink">Released to the beneficiary</span></>}
            {action === "hold" && <> · <span className="font-medium text-nomatch-ink">Held before sending</span></>}
          </span>
        )}
        {done && (action === "review" || payee?.case_id) && <OpenCase />}
      </Footer>
    </>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="mt-10 flex min-h-10 items-center justify-between gap-6 border-t border-rule pt-5">{children}</div>;
}

function OpenCase() {
  const caseId = useStore((s) => s.caseId);
  const caseStatus = useStore((s) => s.caseStatus);
  const runCase = useStore((s) => s.runCase);
  const setView = useStore((s) => s.setView);
  const busy = useStore((s) => s.busy);
  if (!caseId) return null;
  const fresh = caseStatus === "idle";
  return (
    <button
      onClick={() => (fresh ? runCase() : setView("investigate"))}
      disabled={busy && fresh}
      className="flex h-10 shrink-0 items-center gap-2 rounded-[4px] px-3 text-[15px] font-semibold text-main-ink transition-colors duration-150 hover:bg-main-soft disabled:opacity-60"
    >
      Open investigation <span className="font-mono text-[12px] font-normal text-muted">{caseId}</span> <ArrowRight size={16} />
    </button>
  );
}

/* ------------------------------------------------------------- ring pipeline */

function RingPipeline() {
  const ring = useStore((s) => s.ringAlert);
  const hit = useStore((s) => s.registryHit);
  const revealed = useStore((s) => s.revealed);
  const caseStatus = useStore((s) => s.caseStatus);
  const caseOut = useStore((s) => s.caseOut);
  const blocks = useStore((s) => s.blocks);
  const graph = useStore((s) => s.graph);
  const shared = useMemo(() => sharedIdentifiers(graph), [graph]);
  const t = SCENARIOS[4].transfer;
  const r = !!ring;
  const { states } = useStates([r, r, r, r, r], false, false);
  const banks = [...new Set(S5_RING.map((i) => i.slice(4, 8)))];
  const published = blocks.filter((b) => b.kind === "publish").length;
  const accts = [...S5_RING.map((iban) => ({ iban, hit: false })), ...(revealed.includes(IBAN.S5_6) ? [{ iban: IBAN.S5_6, hit: !!hit }] : [])];

  const phones = Math.max(ring?.phones ?? 0, shared.phones);
  const devices = Math.max(ring?.devices ?? 0, shared.devices);
  const stages: PipelineStage[] = [
    { id: "scan", label: "Scan", state: states[0], detail: <><div className="text-[15px] font-semibold text-fg">{t.sender}</div><Small>Everything this sender paid, across all partner banks</Small></> },
    {
      id: "shared", label: "Shared phone/device", state: states[1],
      detail: ring ? (
        <>
          <div className="text-[15px] font-semibold tabular-nums text-fg">{phones} phone{phones === 1 ? "" : "s"} · {devices} device{devices === 1 ? "" : "s"}</div>
          <Small>linked to 2+ beneficiaries; seen only as keyed fingerprints</Small>
        </>
      ) : null,
    },
    {
      id: "accounts", label: "Accounts", state: states[2],
      detail: (
        <ul className="space-y-1">
          {accts.map((a) => (
            <li key={a.iban} className={`flex items-center gap-1.5 text-[13px] ${a.hit ? "font-semibold text-nomatch-ink" : "text-fg"}`}>
              <BankDot code={a.iban.slice(4, 8)} size={6} />
              <span className="font-mono text-[12px]">{shortIban(a.iban)}</span>
              {a.hit && <span className="text-[12px]">hit</span>}
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "banks", label: "Banks", state: states[3],
      detail: (
        <ul className="space-y-1">
          {banks.map((b) => <li key={b} className="flex items-center gap-1.5 text-[13px] text-fg"><BankDot code={b} size={6} />{BANK_NAME[b] ?? b}</li>)}
          <li><Small className="pt-1">No single bank sees this star</Small></li>
        </ul>
      ),
    },
    {
      id: "alert", label: "Ring alert", state: states[4], emphasis: true, tone: "var(--nomatch-ink)",
      detail: ring ? (
        <>
          <div className="stamp-in text-[24px] font-bold leading-none text-nomatch-ink">Ring alert</div>
          <div className="mt-1.5 text-[13px] text-fg-2">{ring.beneficiaries} beneficiaries at {ring.banks} banks</div>
          <ul className="mt-2 space-y-0.5 text-[12px] text-fg-2">
            {caseStatus === "running" && <li>Case agent investigating…</li>}
            {caseOut && <li>Agent recommends <span className="font-medium text-fg">{caseOut.recommended_action.replaceAll("_", " ")}</span></li>}
            {caseStatus === "approved" && <li>{published} fingerprint{published === 1 ? "" : "s"} published to the registry</li>}
            {hit && <li className="font-semibold text-nomatch-ink">{hit.bank} stopped the next transfer</li>}
          </ul>
        </>
      ) : null,
    },
  ];
  return (
    <>
      <Pipeline stages={stages} />
      <Footer>
        {!ring ? (
          <span className="text-[14px] text-fg-2">One transfer in hand: {t.sender} to {t.typed_name}. Press <kbd className="key">Space</kbd> to scan the graph for everything else this sender paid.</span>
        ) : (
          <span className="text-[14px] text-fg-2">Partner banks contribute keyed fingerprints, never raw numbers.</span>
        )}
        {ring && <OpenCase />}
      </Footer>
    </>
  );
}

/* ------------------------------------------------------------ voice pipeline */

function VoicePipeline() {
  const mic = useStore((s) => s.mic);
  const voice = useStore((s) => s.voice);
  const pending = useStore((s) => s.transcriptPending);
  const voiceIdx = useStore((s) => s.voiceIdx);
  const ask = useStore((s) => s.askVoice);
  const asked = useUI((s) => s.asked);
  const transcript = voice?.transcript ?? pending;
  const thinking = mic === "thinking";
  const heard = !!transcript || thinking || !!voice;
  const { states, activeIdx } = useStates([heard, !!transcript, !!voice, !!voice], mic !== "idle", false);
  const elapsed = useElapsed(activeIdx >= 0 ? `v${activeIdx}${mic}` : null);
  const earlier = voice ? asked.slice(1) : asked;
  const known = VOICE_QUERIES.find((q) => q.text === transcript);
  const lang = voice ? (voice.language === "ur" ? "Urdu" : "English") : known ? (known.lang === "ur" ? "Urdu" : "English") : isUrdu(transcript) ? "Urdu" : transcript ? "English" : null;

  const stages: PipelineStage[] = [
    {
      id: "heard", label: "Heard", state: mic === "listening" ? "active" : states[0], ms: activeIdx === 0 ? elapsed : undefined,
      detail: mic === "listening" ? <MicLevel bars={9} height={24} /> : lang ? <div className="text-[13px] text-fg-2">Heard in {lang}</div> : null,
    },
    {
      id: "transcribed", label: "Transcribed", state: states[1],
      detail: transcript ? (
        isUrdu(transcript)
          ? <p className="urdu text-[18px] text-fg" lang="ur" style={{ lineHeight: 1.9 }}>{transcript}</p>
          : <p className="text-[15px] font-medium leading-snug text-fg">&ldquo;{transcript}&rdquo;</p>
      ) : null,
    },
    {
      id: "query", label: "Graph query", state: states[2], ms: activeIdx === 2 ? elapsed : undefined,
      detail: voice ? (
        <ul className="space-y-2">
          {voice.cypher_attempts.map((c, i) => (
            <li key={i}>
              <div className="text-[12px] font-medium" style={{ color: c.status === "ok" ? "var(--match-ink)" : c.status === "repaired" ? "var(--close-ink)" : "var(--nomatch-ink)" }}>Query {i + 1} · {c.status}</div>
              <pre className="scroll-thin mt-0.5 max-h-[132px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-fg-2">{c.query}</pre>
              {c.error && <div className="font-mono text-[11px] text-nomatch-ink">{c.error}</div>}
            </li>
          ))}
          <li><Small>{voice.rows} row{voice.rows === 1 ? "" : "s"} · {voice.highlight_ids?.length ?? 0} node{(voice.highlight_ids?.length ?? 0) === 1 ? "" : "s"} lit on the graph</Small></li>
        </ul>
      ) : null,
    },
    {
      id: "answer", label: "Answer", state: states[3], emphasis: true,
      detail: voice ? (
        voice.language === "ur"
          ? <p className="urdu text-[24px] text-fg" lang="ur" style={{ lineHeight: 2 }}>{voice.answer}</p>
          : <p className="text-[20px] font-semibold leading-snug text-fg">{voice.answer}</p>
      ) : null,
    },
  ];

  return (
    <>
      <div className="mb-10 flex items-center gap-4">
        <MicButton big />
        <p className="text-[15px] text-fg-2">
          {mic === "listening" ? "Listening…" : <>Ask in Urdu or English. <kbd className="key">V</kbd> to speak, <kbd className="key">Shift V</kbd> plays a recorded question, <kbd className="key">Space</kbd> asks the next one below.</>}
        </p>
      </div>
      <Pipeline stages={stages} />
      <div className="mt-10 grid grid-cols-2 gap-12 border-t border-rule pt-5">
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-fg">Questions to try</h3>
          <ol>
            {VOICE_QUERIES.map((q, i) => (
              <li key={i} className="border-b border-rule last:border-b-0">
                <button
                  onClick={() => ask(i)}
                  disabled={thinking}
                  className={`flex w-full items-baseline gap-3 rounded-[4px] px-2 py-2 text-left text-[14px] transition-colors duration-150 hover:bg-surface-2 disabled:opacity-60 ${i === voiceIdx ? "text-fg" : "text-fg-2"}`}
                >
                  <span className="w-14 shrink-0 text-[12px] text-muted">{q.lang === "ur" ? "Urdu" : "English"}</span>
                  <span className={`min-w-0 flex-1 ${isUrdu(q.text) ? "urdu text-right text-[16px]" : ""}`} lang={q.lang}>{q.text}</span>
                  {i === voiceIdx && <span className="shrink-0 text-[12px] font-medium text-main-ink">next</span>}
                </button>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-fg">Asked so far</h3>
          {earlier.length === 0 ? <p className="text-[13px] text-muted">Nothing yet.</p> : (
            <ol>
              {earlier.map((a, i) => (
                <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-baseline gap-4 border-b border-rule py-2 text-[13px] last:border-b-0">
                  <span className="truncate text-fg-2">&ldquo;{a.q}&rdquo;</span>
                  <span className="min-w-0 truncate">{a.lang === "ur" ? <span className="urdu text-[15px] text-fg" lang="ur">{a.a}</span> : <span className="text-fg">{a.a}</span>}</span>
                  <span className="text-[12px] tabular-nums text-muted">{a.rows} rows</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

/** A voice question asked outside case 6 still gets its answer, as one plain line. */
function VoiceAside() {
  const voice = useStore((s) => s.voice);
  const pending = useStore((s) => s.transcriptPending);
  const mic = useStore((s) => s.mic);
  if (!voice && !pending && mic === "idle") return null;
  return (
    <div className="mb-8 flex items-baseline gap-3 text-[13px] line-in">
      <Mic size={14} className="shrink-0 self-center text-main-ink" />
      <span className="min-w-0 truncate text-fg-2">{voice?.transcript ?? pending ?? ""}{mic === "listening" && !pending ? "Listening…" : ""}</span>
      <span className="text-muted">→</span>
      <span className="min-w-0 truncate font-medium text-fg">{voice ? voice.answer : mic === "thinking" ? "Querying the graph…" : ""}</span>
    </div>
  );
}

/* --------------------------------------------------------------------- view */

export default function InboundView() {
  const idx = useStore((s) => s.scenarioIdx);
  const key = SCENARIOS[idx].key;
  const t = SCENARIOS[idx].transfer;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <CasePicker />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1480px] px-10 pb-12 pt-[9vh]">
          <div className="mb-10 flex items-baseline gap-4">
            <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-fg">
              {key === "S6" ? "Ask the graph" : key === "S5" ? "Ring scan" : "Payee check"}
            </h1>
            {key !== "S6" && (
              <span className="text-[13px] text-muted">
                {t.sender} → {t.typed_name} · <span className="font-mono text-[12px]">{t.iban}</span> · {BANK_NAME[t.bank] ?? t.bank}
              </span>
            )}
          </div>
          {key !== "S6" && <VoiceAside />}
          {key === "S6" ? <VoicePipeline /> : key === "S5" ? <RingPipeline /> : <PayeePipeline key={key} />}
        </div>
      </div>
    </div>
  );
}
