"use client";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import TopBar from "@/components/TopBar";
import TranscriptLine from "@/components/TranscriptLine";
import TransferPanel from "@/components/TransferPanel";
import CasePanel from "@/components/CasePanel";
import LedgerStrip, { MiniExplorer } from "@/components/LedgerStrip";
import Director from "@/components/Director";
import { useStore } from "@/lib/store";

const GraphCanvas = dynamic(() => import("@/components/GraphCanvas"), { ssr: false });

export default function Page() {
  const init = useStore((s) => s.init);
  const error = useStore((s) => s.error);
  useEffect(() => {
    init();
  }, [init]);
  return (
    <main className="flex h-screen min-h-[760px] min-w-[1280px] flex-col">
      <Director />
      <TopBar />
      <TranscriptLine />
      <div className="flex min-h-0 flex-1">
        <TransferPanel />
        <GraphCanvas />
        <CasePanel />
      </div>
      <LedgerStrip />
      <MiniExplorer />
      {error && (
        <div className="mono fixed bottom-[120px] left-1/2 z-40 -translate-x-1/2 rounded-[var(--radius)] border border-nomatch bg-surface px-3 py-1.5 text-[12px] text-nomatch">
          {error}
          <button className="ml-3 text-muted hover:text-ink" onClick={() => useStore.setState({ error: null })}>dismiss</button>
        </div>
      )}
    </main>
  );
}
