"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Director from "@/components/Director";
import Rail from "@/components/shell/Rail";
import StatusLine from "@/components/shell/StatusLine";
import DemoBar from "@/components/shell/DemoBar";
import { MicHost } from "@/components/shell/mic";
import InboundView from "@/components/views/InboundView";
import AuditView from "@/components/views/AuditView";
import { useStore, VIEWS, type View } from "@/lib/store";
import { SCENARIOS } from "@/lib/scenarios";

// The 3D workspaces load on demand (three.js stays out of the first paint).
const InvestigateView = dynamic(() => import("@/components/views/InvestigateView"), { ssr: false });
const GraphView = dynamic(() => import("@/components/views/GraphView"), { ssr: false });

/** The 3D workspaces stay mounted once opened (hidden, not torn down), so switching back is instant.
 *  They can read `useStore(s => s.view)` to pause rendering while hidden. */
function KeepAlive({ on, children }: { on: boolean; children: React.ReactNode }) {
  const [seen, setSeen] = useState(on);
  useEffect(() => { if (on) setSeen(true); }, [on]);
  if (!seen && !on) return null;
  return (
    <div className={`absolute inset-0 ${on ? "" : "invisible pointer-events-none"}`} aria-hidden={!on}>
      {children}
    </div>
  );
}

export default function ConsolePage() {
  const init = useStore((s) => s.init);
  const error = useStore((s) => s.error);
  const idx = useStore((s) => s.scenarioIdx);
  const view = useStore((s) => s.view);

  useEffect(() => {
    // /console?case=5&view=audit opens straight into that case and workspace (links from the home page).
    const q = new URLSearchParams(window.location.search);
    const n = Number(q.get("case"));
    const v = q.get("view") as View | null;
    const patch: Partial<ReturnType<typeof useStore.getState>> = {};
    if (n >= 1 && n <= SCENARIOS.length && n - 1 !== useStore.getState().scenarioIdx) Object.assign(patch, { scenarioIdx: n - 1, focus: SCENARIOS[n - 1].focus });
    if (v && VIEWS.includes(v)) patch.view = v;
    if (Object.keys(patch).length) useStore.setState(patch);
    init();
  }, [init]);

  // Keep the address bar in step with the open case and workspace so it can be shared.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    url.searchParams.set("case", String(idx + 1));
    window.history.replaceState(null, "", url);
  }, [idx, view]);

  return (
    <main className="flex h-screen min-h-[680px] min-w-[1280px] overflow-hidden bg-bg text-fg">
      <Director />
      <MicHost />
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <StatusLine />
        <div className="relative min-h-0 flex-1 bg-surface/40">
          {view === "inbound" && <InboundView />}
          <KeepAlive on={view === "investigate"}><InvestigateView /></KeepAlive>
          <KeepAlive on={view === "graph"}><GraphView /></KeepAlive>
          {view === "audit" && <AuditView />}
        </div>
        <DemoBar />
      </div>
      {error && (
        <div role="alert" className="fixed bottom-[60px] left-1/2 z-40 flex max-w-[640px] -translate-x-1/2 items-center gap-3 rounded-[var(--radius)] border border-nomatch/60 bg-surface-2 px-3.5 py-2 text-[13px] text-nomatch-ink shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]">
          <span className="min-w-0 break-words">{error}</span>
          <button className="shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[12px] font-medium text-fg-2 hover:bg-surface" onClick={() => useStore.setState({ error: null })}>Dismiss</button>
        </div>
      )}
    </main>
  );
}
