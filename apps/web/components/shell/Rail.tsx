"use client";
import Link from "next/link";
import { Inbox, ScanSearch, Waypoints, Link2 } from "lucide-react";
import { useStore, type View } from "@/lib/store";
import { useUI } from "./ui";

export const WORKSPACES: { view: View; word: string; key: string; Icon: typeof Inbox }[] = [
  { view: "inbound", word: "Inbound", key: "I", Icon: Inbox },
  { view: "investigate", word: "Investigate", key: "V", Icon: ScanSearch },
  { view: "graph", word: "Graph", key: "G", Icon: Waypoints },
  { view: "audit", word: "Audit", key: "A", Icon: Link2 },
];

/** A small dot on a rail item when that workspace has something waiting. */
function useBadges(): Partial<Record<View, string>> {
  const caseStatus = useStore((s) => s.caseStatus);
  const registryHit = useStore((s) => s.registryHit);
  const integrity = useStore((s) => s.integrity);
  const broken = !!integrity && integrity.items?.some((i) => i.status !== "verified");
  return {
    ...(caseStatus === "running" ? { investigate: "var(--main-ink)" } : caseStatus === "ready" ? { investigate: "var(--close)" } : {}),
    ...(registryHit || broken ? { audit: "var(--nomatch)" } : {}),
  };
}

export default function Rail() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const chord = useUI((s) => s.chord);
  const badges = useBadges();
  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center border-r border-rule bg-bg py-3" aria-label="Workspaces">
      <Link href="/" title="Shanakht home" className="mb-4 flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-main text-[15px] font-bold text-white">
        S
      </Link>
      <ul className="flex w-full flex-col gap-1 px-2">
        {WORKSPACES.map(({ view: v, word, key, Icon }) => {
          const on = v === view;
          return (
            <li key={v}>
              <button
                onClick={() => setView(v)}
                aria-current={on ? "page" : undefined}
                title={`${word} (G then ${key})`}
                className={`relative flex w-full flex-col items-center gap-1 rounded-[var(--radius-sm)] py-2 text-[11px] font-medium leading-none transition-colors duration-150 ${
                  on ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface hover:text-fg-2"
                }`}
              >
                {on && <span className="absolute -left-2 top-2 bottom-2 w-[3px] rounded-r bg-main" />}
                <span className="relative">
                  <Icon size={18} strokeWidth={on ? 2 : 1.75} className={on ? "text-main-ink" : ""} />
                  {badges[v] && <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full ring-2 ring-bg" style={{ background: badges[v] }} />}
                </span>
                {word}
                {chord && (
                  <span className="absolute right-1 top-1 rounded-[3px] bg-accent px-1 font-mono text-[10px] leading-[14px] text-accent-ink">{key}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
