"use client";
import { useStore } from "@/lib/store";
import { SCENARIOS, S5_RING, IBAN } from "@/lib/scenarios";
import { BankDot, shortIban, tint } from "./bits";

const ROW = 46;
const FAN_W = 200;

/**
 * Case 5's crossing: one sender, many beneficiaries. Before the scan only the transfer in hand is drawn;
 * the scan fans out to the whole star, and the partner bank's catch joins it in red.
 */
export default function RingFan() {
  const ring = useStore((s) => s.ringAlert);
  const hit = useStore((s) => s.registryHit);
  const revealed = useStore((s) => s.revealed);
  const t = SCENARIOS[4].transfer;
  const accts: { iban: string; name?: string; hit?: boolean }[] = ring
    ? S5_RING.map((iban) => ({ iban, name: iban === t.iban ? t.typed_name : undefined }))
    : [{ iban: t.iban, name: t.typed_name }];
  if (revealed.includes(IBAN.S5_6)) accts.push({ iban: IBAN.S5_6, name: "Hamza Kh.", hit: !!hit });
  const H = accts.length * ROW;
  const mid = H / 2;

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center">
        <div className="w-[180px] text-right">
          <div className="text-[12px] text-muted">Sender</div>
          <div className="text-[26px] font-semibold leading-tight text-fg">{t.sender}</div>
          <div className="text-[13px] text-fg-2">{t.exchange_name} · {t.country}</div>
        </div>
        <svg width={FAN_W} height={H} className="shrink-0 overflow-visible" aria-hidden>
          <circle cx={10} cy={mid} r={4} fill={ring ? "var(--nomatch)" : "var(--fg-2)"} />
          {accts.map((a, i) => {
            const y = i * ROW + ROW / 2;
            const stroke = a.hit ? "var(--nomatch)" : ring ? "var(--close)" : "var(--muted)";
            return (
              <path
                key={a.iban}
                d={`M10 ${mid} C ${FAN_W * 0.55} ${mid}, ${FAN_W * 0.45} ${y}, ${FAN_W - 6} ${y}`}
                fill="none"
                stroke={stroke}
                strokeWidth={a.hit ? 2 : 1.5}
                strokeDasharray={a.hit ? "5 4" : undefined}
                className="line-in"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            );
          })}
        </svg>
        <ol className="w-[260px]" style={{ height: H }}>
          {accts.map((a, i) => (
            <li
              key={a.iban}
              className="flex items-center gap-2.5 rounded-[var(--radius-sm)] border px-3 line-in"
              style={{
                height: ROW - 8,
                marginBottom: 8,
                animationDelay: `${i * 80}ms`,
                borderColor: a.hit ? "var(--nomatch)" : "var(--rule)",
                background: a.hit ? tint("var(--nomatch)", 10) : "var(--surface)",
              }}
            >
              <BankDot code={a.iban.slice(4, 8)} />
              <span className="font-mono text-[13px] text-fg">{shortIban(a.iban)}</span>
              {a.name && <span className="truncate text-[13px] text-fg-2">{a.name}</span>}
              {a.hit && <span className="ml-auto shrink-0 text-[12px] font-semibold text-nomatch-ink">registry hit</span>}
            </li>
          ))}
        </ol>
      </div>

      {ring ? (
        <div className="mt-6 flex flex-col items-center line-in">
          <div className="stamp-in rounded-[8px] border-2 px-4 py-2 text-center" style={{ borderColor: "var(--nomatch)", color: "var(--nomatch-ink)", background: tint("var(--nomatch)", 8) }}>
            <span className="text-[18px] font-bold uppercase leading-none tracking-[0.06em]">Ring alert</span>
          </div>
          <p className="mt-3 text-center text-[14px] text-fg-2">
            {ring.beneficiaries} beneficiaries at {ring.banks} banks
            {ring.phones > 0 && <> · {ring.phones} shared phone{ring.phones > 1 ? "s" : ""}</>}
            {ring.devices > 0 && <> · {ring.devices} shared device{ring.devices > 1 ? "s" : ""}</>}
          </p>
          <p className="mt-1 max-w-[520px] text-center text-[13px] text-muted">
            No single bank sees this star. Partner banks contribute keyed fingerprints, never raw numbers.
          </p>
        </div>
      ) : (
        <p className="mt-6 text-[14px] text-fg-2">One transfer in hand. Scan the graph for everything else this sender paid.</p>
      )}
    </div>
  );
}
