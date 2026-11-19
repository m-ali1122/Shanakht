"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Director from "@/components/Director";
import TopBar from "@/components/shell/TopBar";
import DemoBar from "@/components/shell/DemoBar";
import { MicHost } from "@/components/shell/mic";
import InboundView from "@/components/views/InboundView";
import AuditView from "@/components/views/AuditView";
import { useStore, VIEWS, type View } from "@/lib/store";
import { SCENARIOS } from "@/lib/scenarios";

// The graph workspaces load on demand (canvas libraries stay out of the first paint).
const InvestigateView = dynamic(() => import("@/components/views/InvestigateView"), { ssr: false });
const GraphView = dynamic(() => import("@/components/views/GraphView"), { ssr: false });

/** The graph workspaces stay mounted once opened (hidden, not torn down), so switching back is instant.
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

/** Top bar + demo bar hide while the document is fullscreen or GRAPH sets `immersive`. */
function useImmersive() {
  const flag = useStore((s) => s.immersive);
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    on();
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const immersive = flag || fs;
  useEffect(() => {
    document.documentElement.style.setProperty("--topbar-h", immersive ? "0px" : "52px");
    document.documentElement.style.setProperty("--demobar-h", immersive ? "0px" : "48px");
  }, [immersive]);
  return immersive;
}

export default function ConsolePage() {
  const init = useStore((s) => s.init);
  const error = useStore((s) => s.error);
  const idx = useStore((s) => s.scenarioIdx);
  const view = useStore((s) => s.view);
  const immersive = useImmersive();

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
    <main className="flex h-screen min-h-[640px] min-w-[1200px] flex-col overflow-hidden bg-bg text-fg">
      <Director />
      <MicHost />
      {!immersive && <TopBar />}
      <div className="relative min-h-0 flex-1">
        {view === "inbound" && <InboundView />}
        <KeepAlive on={view === "investigate"}><InvestigateView /></KeepAlive>
        <KeepAlive on={view === "graph"}><GraphView /></KeepAlive>
        {view === "audit" && <AuditView />}
      </div>
      {!immersive && <DemoBar />}
      {error && (
        <div role="alert" className="fixed bottom-[56px] left-1/2 z-40 flex max-w-[640px] -translate-x-1/2 items-baseline gap-4 border-t-2 border-nomatch bg-bg px-4 py-2 text-[13px] text-nomatch-ink">
          <span className="min-w-0 break-words">{error}</span>
          <button className="shrink-0 rounded-[4px] px-2 py-0.5 text-[12px] font-medium text-fg-2 hover:bg-surface-2" onClick={() => useStore.setState({ error: null })}>Dismiss</button>
        </div>
      )}
    </main>
  );
}
