"use client";
import { Loader2, AlertTriangle } from "lucide-react";
import { useStore } from "@/lib/store";
import { SCENARIOS, VOICE_QUERIES } from "@/lib/scenarios";
import TokenAlignment from "./TokenAlignment";

const BANK_COLOR: Record<string, string> = { MRGL: "var(--bank-mrgl)", RAVI: "var(--bank-ravi)", CHNB: "var(--bank-chnb)", INDS: "var(--bank-inds)" };
const BAND_COLOR: Record<string, string> = { MATCH: "var(--match)", CLOSE: "var(--close)", NO_MATCH: "var(--nomatch)", RING: "var(--nomatch)" };
const BAND_WORD: Record<string, string> = { MATCH: "MATCH", CLOSE: "CLOSE MATCH", NO_MATCH: "NO MATCH" };

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-baseline gap-2 py-[5px]">
      <span className="label">{k}</span>
      <span className="min-w-0 text-[14px] text-ink">{children}</span>
    </div>
  );
}

export function BankChip({ code }: { code: string }) {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-[var(--radius)] border px-1.5 py-[1px] text-[11px] font-medium" style={{ borderColor: BANK_COLOR[code], color: BANK_COLOR[code] }}>
      {code}
    </span>
  );
}

function StepTicks() {
  const steps = useStore((s) => s.payeeSteps);
  const phase = useStore((s) => s.payeePhase);
  const ring = useStore((s) => s.ringAlert);
  const names = ["title_fetch", "compare", "history", "decision", "phrase"];
  if (phase === "idle" || ring) return null;
  return (
    <div className="mono mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
      {names.map((n) => {
        const e = [...steps].reverse().find((x) => x.step === n);
        const st = e?.status;
        return (
          <span key={n} className={st === "ok" ? "text-ink-2" : st === "running" ? "text-accent" : ""}>
            {n.replace("_", " ")} {st === "ok" ? `${e?.ms ?? ""}ms` : st === "running" ? "…" : ""}
          </span>
        );
      })}
    </div>
  );
}

function ResultBand() {
  const r = useStore((s) => s.payee);
  const ring = useStore((s) => s.ringAlert);
  if (ring) {
    return (
      <div className="band-tint-RING mt-4 rounded-r-[var(--radius)] px-4 py-3 line-in">
        <div className="label" style={{ color: "var(--nomatch)" }}>Motif detector</div>
        <div className="font-serif text-[28px] leading-tight" style={{ color: BAND_COLOR.RING }}>RING ALERT</div>
        <div className="mt-1 text-[13px] text-ink-2">
          {ring.beneficiaries} beneficiaries · {ring.banks} banks · {ring.phones} shared phone · {ring.devices} shared device
        </div>
        <div className="mono mt-1 text-[11px] text-muted">transfers within 48 h · partner records are fingerprints only</div>
      </div>
    );
  }
  if (!r) return null;
  return (
    <div className="mt-4 line-in">
      <div className={`band-tint-${r.band} rounded-r-[var(--radius)] px-4 py-3`}>
        <div className="flex items-baseline justify-between">
          <span className="font-serif text-[28px] leading-tight" style={{ color: BAND_COLOR[r.band] }}>{BAND_WORD[r.band]}</span>
          <span className="mono text-[15px] text-ink">{r.score.toFixed(2)}</span>
        </div>
        {r.banner && (
          <div className="mt-2 flex gap-2 text-[13px] font-medium leading-snug text-nomatch">
            <AlertTriangle size={15} strokeWidth={1.75} className="mt-[2px] shrink-0" />
            <span>{r.banner}</span>
          </div>
        )}
        {r.explain && (
          <div className="mt-2 space-y-1">
            <p className="text-[13px] leading-snug text-ink-2">{r.explain.en}</p>
            <p className="urdu text-[14px] text-ink-2" lang="ur" style={{ lineHeight: 2.1 }}>{r.explain.ur}</p>
          </div>
        )}
      </div>
      <div className="mt-4">
        <TokenAlignment items={r.alignment} urdu={r.urdu_name} />
      </div>
      {r.reasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {r.reasons.map((c) => (
            <span key={c} className="rounded-[var(--radius)] border border-rule bg-surface px-1.5 py-[2px] text-[11px] font-medium uppercase tracking-[0.06em] text-ink-2">
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function VoiceList() {
  const voiceIdx = useStore((s) => s.voiceIdx);
  const ask = useStore((s) => s.askVoice);
  return (
    <div className="mt-4">
      <div className="label mb-2">Voice queries</div>
      <ol className="space-y-2">
        {VOICE_QUERIES.map((q, i) => (
          <li key={i}>
            <button onClick={() => ask(i)} className={`w-full rounded-[var(--radius)] border px-3 py-2 text-left text-[13px] leading-snug transition-colors duration-150 ${i === voiceIdx ? "border-accent text-ink" : "border-rule text-ink-2 hover:border-muted"}`}>
              <span className="label mr-2">{q.lang}</span>
              {q.text}
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[12px] text-muted">V to speak · Shift+V plays the recorded clip</p>
    </div>
  );
}

export default function TransferPanel() {
  const idx = useStore((s) => s.scenarioIdx);
  const phase = useStore((s) => s.payeePhase);
  const runPayee = useStore((s) => s.runPayee);
  const runRing = useStore((s) => s.runRing);
  const busy = useStore((s) => s.busy);
  const sc = SCENARIOS[idx];
  const t = sc.transfer;
  const isRing = sc.key === "S5";
  return (
    <aside className="scroll-thin flex w-[340px] shrink-0 flex-col overflow-y-auto border-r border-rule bg-surface px-4 py-4">
      <div className="label mb-2">Incoming transfer</div>
      <div className="mb-2 font-serif text-[18px] text-ink">
        {t.exchange_name} <span className="text-muted">({t.country})</span>
      </div>
      <Row k="Sender">{t.sender}</Row>
      <Row k="Typed name">{t.typed_name}</Row>
      <Row k="IBAN">
        <span className="mono text-[12px]">{t.iban}</span>
        <BankChip code={t.bank} />
      </Row>
      <Row k="Amount">
        PKR {t.amount_pkr.toLocaleString("en-US")} <span className="text-muted">· {t.currency} {t.amount_fx.toLocaleString("en-US")}</span>
      </Row>

      {sc.key === "S6" ? (
        <VoiceList />
      ) : (
        <button
          onClick={() => (isRing ? runRing() : runPayee())}
          disabled={busy || phase === "running"}
          className="mt-4 flex h-9 items-center justify-center gap-2 rounded-[var(--radius)] bg-accent text-[13px] font-medium text-surface transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {phase === "running" && <Loader2 size={14} className="animate-spin" />}
          {isRing ? "Run motif detector" : "Run payee check"}
        </button>
      )}
      <StepTicks />
      {sc.key !== "S6" && <ResultBand />}
    </aside>
  );
}
