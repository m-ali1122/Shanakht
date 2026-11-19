"use client";
import Link from "next/link";
import { WifiOff } from "lucide-react";
import { useStore, VIEW_LABEL, type View } from "@/lib/store";
import { BankDot, BANK_NAME } from "./bits";
import { MicButton, MicLevel } from "./mic";
import { useUI } from "./ui";

/** Tabs in order, with the second key of the G-chord shown inline (recognition over recall). */
export const TABS: { view: View; key: string }[] = [
  { view: "inbound", key: "C" },
  { view: "investigate", key: "I" },
  { view: "graph", key: "G" },
  { view: "audit", key: "L" },
];

const BANKS = ["MRGL", "RAVI", "CHNB", "INDS"] as const;

/** Small status dot on a tab when something waits there. */
function useBadges(): Partial<Record<View, string>> {
  const caseStatus = useStore((s) => s.caseStatus);
  const registryHit = useStore((s) => s.registryHit);
  const integrity = useStore((s) => s.integrity);
  const broken = !!integrity && integrity.items?.some((i) => i.status !== "verified");
  return {
    ...(caseStatus === "running" ? { investigate: "var(--main)" } : caseStatus === "ready" ? { investigate: "var(--close)" } : {}),
    ...(registryHit || broken ? { audit: "var(--nomatch)" } : {}),
  };
}

function Tabs() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const chord = useUI((s) => s.chord);
  const badges = useBadges();
  return (
    <nav className="flex h-full items-stretch gap-1" aria-label="Workspaces">
      {TABS.map(({ view: v, key }) => {
        const on = v === view;
        return (
          <button
            key={v}
            onClick={() => setView(v)}
            aria-current={on ? "page" : undefined}
            title={`${VIEW_LABEL[v]} (G then ${key})`}
            className={`relative flex items-center gap-1.5 px-3 text-[14px] transition-colors duration-150 ${on ? "font-semibold text-fg" : "font-medium text-muted hover:text-fg"}`}
          >
            {VIEW_LABEL[v]}
            {badges[v] && <span className="h-1.5 w-1.5 rounded-full" style={{ background: badges[v] }} aria-label="needs attention" />}
            {chord && <kbd className="key !border-accent !bg-accent !text-accent-ink">{key}</kbd>}
            <span className={`absolute inset-x-3 bottom-0 h-[2px] transition-colors duration-150 ${on ? "bg-main" : "bg-transparent"}`} aria-hidden />
          </button>
        );
      })}
    </nav>
  );
}

function Status() {
  const c = useStore((s) => s.counter);
  const flash = useStore((s) => s.flash);
  const hit = useStore((s) => s.registryHit);
  const offline = useStore((s) => s.offlineDot);
  const mic = useStore((s) => s.mic);
  const clean = c.identifiers === 0;
  return (
    <div className="flex items-center gap-5 text-[13px]">
      <span title={`Pseudonymization gateway: ${c.tokens} identifiers replaced by tokens before any model call`} className="text-fg-2">
        <span className={`font-semibold tabular-nums ${clean ? "text-match-ink" : "text-nomatch-ink"}`}>{c.identifiers}</span> raw IDs sent to model
      </span>
      <span className="flex items-center gap-3" aria-label="Partner banks">
        {BANKS.map((b) => {
          const isHit = hit?.bank === b;
          return (
            <span
              key={b + (flash[b] ?? "")}
              title={`${BANK_NAME[b]}${b === "MRGL" ? " (this desk)" : ""}${isHit ? ": registry hit" : ""}`}
              className={`flex items-center gap-1.5 rounded-[4px] px-0.5 text-[12px] font-medium ${isHit ? "text-nomatch-ink" : "text-fg-2"} ${flash[b] ? "chip-flash" : ""}`}
            >
              <BankDot code={b} size={7} />
              {b}
              {isHit && <span className="font-semibold">hit</span>}
            </span>
          );
        })}
      </span>
      {offline && (
        <span className="flex items-center gap-1 text-[12px] font-medium text-close-ink" title="Offline mode: answers come from the recorded cache">
          <WifiOff size={14} /> Offline
        </span>
      )}
      <span className="flex items-center gap-2">
        {mic !== "idle" && <MicLevel bars={5} height={14} />}
        <MicButton />
      </span>
    </div>
  );
}

/** One line: wordmark, the four tabs, plain-text status. */
export default function TopBar() {
  return (
    <header className="flex h-[52px] shrink-0 items-stretch gap-8 border-b border-rule bg-bg px-6">
      <Link href="/" className="flex items-center text-[16px] font-semibold tracking-[-0.01em] text-fg" title="Shanakht home">
        Shanakht
      </Link>
      <Tabs />
      <div className="flex-1" />
      <Status />
    </header>
  );
}
