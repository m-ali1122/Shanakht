"use client";
// Graph workspace: the grand cross-bank identity graph as a 2D map you pan, zoom and drag.
// Query field + filter chips float top-left; details open in a right drawer; F = fullscreen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, Maximize2, Minimize2 } from "lucide-react";
import { useGraphStore } from "@/lib/graphStore";
import { useStore } from "@/lib/store";
import { endId, type GLink, type GNode } from "@/lib/graphAdapt";
import FilterChips, { useVisibility } from "@/components/graph/Filters";
import Inspector, { inspectorTitle } from "@/components/graph/Inspector";
import QueryBar from "@/components/graph/QueryBar";
import Legend from "@/components/graph/Legend";
import { Drawer } from "@/components/shell/Drawer";

const Graph2D = dynamic(() => import("@/components/graph/Graph2D"), {
  ssr: false,
  loading: () => <Stage text="Loading the graph" />,
});

const DRAWER_W = 400;

function Stage({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center gap-2 text-[13px] text-muted">
      <Loader2 size={14} className="animate-spin" /> {text}
    </div>
  );
}

/** Fullscreen on an element (Fullscreen API) + the console's `immersive` flag (hides top and demo bars). */
export function useFullscreen(ref: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const [on, setOn] = useState(false);
  const setImmersive = useStore((s) => s.setImmersive);
  useEffect(() => {
    const f = () => {
      const fs = !!document.fullscreenElement && document.fullscreenElement === ref.current;
      if (!document.fullscreenElement) { setOn(false); setImmersive(false); } else if (fs) { setOn(true); setImmersive(true); }
    };
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, [ref, setImmersive]);
  const toggle = useCallback(async () => {
    if (on) {
      setOn(false);
      setImmersive(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      return;
    }
    setOn(true);
    setImmersive(true); // still hides the bars where the Fullscreen API is refused
    await ref.current?.requestFullscreen?.().catch(() => {});
  }, [on, ref, setImmersive]);
  // F toggles, Esc leaves (the browser handles Esc itself in real fullscreen)
  useEffect(() => {
    if (!enabled) return;
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable]")) return;
      if (e.key === "f" || e.key === "F") { e.preventDefault(); toggle(); }
      else if (e.key === "Escape" && on && !document.fullscreenElement) { setOn(false); setImmersive(false); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [enabled, toggle, on, setImmersive]);
  // leaving the tab leaves immersive mode
  useEffect(() => {
    if (enabled || !on) return;
    setOn(false);
    setImmersive(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [enabled, on, setImmersive]);
  return { on, toggle };
}

export function FullscreenButton({ on, toggle }: { on: boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Exit fullscreen (F)" : "Fullscreen (F)"}
      title={on ? "Exit fullscreen (F)" : "Fullscreen (F)"}
      className="mb-1 grid h-8 w-8 place-items-center rounded-[4px] text-fg-2 hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-main"
    >
      {on ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
    </button>
  );
}

export default function GraphView() {
  const data = useGraphStore((s) => s.data);
  const loading = useGraphStore((s) => s.loading);
  const error = useGraphStore((s) => s.error);
  const fallback = useGraphStore((s) => s.fallback);
  const stats = useGraphStore((s) => s.stats);
  const colourBy = useGraphStore((s) => s.colourBy);
  const setColourBy = useGraphStore((s) => s.setColourBy);
  const highlight = useGraphStore((s) => s.highlight);
  const selection = useGraphStore((s) => s.selection);
  const selScope = useGraphStore((s) => s.selScope);
  const inspector = useGraphStore((s) => s.inspector);
  const focus = useGraphStore((s) => s.focus);
  const pathFrom = useGraphStore((s) => s.pathFrom);
  const qerror = useGraphStore((s) => s.qerror);
  const loadGrand = useGraphStore((s) => s.loadGrand);
  const select = useGraphStore((s) => s.select);
  const clearSelection = useGraphStore((s) => s.clearSelection);
  const focusOn = useGraphStore((s) => s.focusOn);
  const pathTo = useGraphStore((s) => s.pathTo);
  const active = useStore((s) => s.view) === "graph";
  const { nodeVisible, linkVisible, nodeFaded, counts } = useVisibility(data);
  const wrap = useRef<HTMLDivElement>(null);
  const fs = useFullscreen(wrap, active);

  useEffect(() => { loadGrand(); }, [loadGrand]);
  // selection / highlight made in the Investigate view do not carry over
  useEffect(() => {
    if (active && useGraphStore.getState().selScope !== "grand") { clearSelection(); useGraphStore.getState().setHighlight(null); }
  }, [active, clearSelection]);

  const hlNodes = useMemo(() => new Set(highlight?.nodes ?? []), [highlight]);
  const hlLinks = useMemo(() => new Set(highlight?.links ?? []), [highlight]);
  const cases = useGraphStore((s) => s.filters.cases);
  // fit to the highlight; otherwise to the case neighbourhoods brought forward; otherwise everything
  const fitIds = useMemo(() => {
    if (highlight && highlight.nodes.length > 1) return highlight.nodes;
    if (!highlight && cases.length) return data.nodes.filter((n) => n.scenarios?.some((s) => cases.includes(s))).map((n) => n.id);
    return [];
  }, [highlight, cases, data]);
  // bringing case neighbourhoods forward replaces an exploratory highlight, so the view moves to them
  useEffect(() => { if (cases.length) useGraphStore.getState().setHighlight(null); }, [cases]);
  const fitKey = highlight ? `${highlight.label}:${highlight.nodes.length}` : cases.length ? `cases:${cases.join(",")}` : "all";
  const mine = selScope === "grand" ? selection : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const title = useMemo(() => inspectorTitle(data), [mine, inspector.node?.kind, data]);

  const onNodeClick = useCallback((n: GNode) => {
    if (pathFrom && pathFrom !== n.id) { pathTo(n.id, data, "grand"); return; }
    select({ type: "node", id: n.id }, data, "grand");
    // light up the node's neighbourhood; the highlight change fits the view onto it
    const ls = data.links.filter((l) => endId(l.source) === n.id || endId(l.target) === n.id);
    if (ls.length) {
      useGraphStore.getState().setHighlight({
        nodes: [n.id, ...ls.map((l) => (endId(l.source) === n.id ? endId(l.target) : endId(l.source)))],
        links: ls.map((l) => l.id),
        label: n.label,
      });
    } else focusOn(n.id);
  }, [pathFrom, pathTo, select, focusOn, data]);
  const onLinkClick = useCallback((l: GLink) => {
    select({ type: "link", id: l.id, rel: l.rel, source: endId(l.source), target: endId(l.target) }, data, "grand");
  }, [select, data]);

  return (
    <div ref={wrap} className="relative h-full w-full overflow-hidden bg-bg" aria-label="Identity graph">
      <div className="absolute inset-0">
        {data.nodes.length ? (
          <Graph2D
            data={data}
            variant="grand"
            active={active}
            colourBy={colourBy}
            highlightNodes={hlNodes}
            highlightLinks={hlLinks}
            dimOthers
            focus={focus}
            fitIds={fitIds}
            fitKey={fitKey}
            selectedId={mine?.type === "node" ? mine.id : null}
            selectedLinkId={mine?.type === "link" ? mine.id : null}
            nodeVisible={nodeVisible}
            linkVisible={linkVisible}
            nodeFaded={nodeFaded}
            onNodeClick={onNodeClick}
            onLinkClick={onLinkClick}
            onBackgroundClick={clearSelection}
            rightInset={mine ? DRAWER_W : 0}
            topInset={180}
            controls={<FullscreenButton {...fs} />}
          />
        ) : loading ? (
          <Stage text="Building the identity graph" />
        ) : error ? (
          <div className="flex h-full items-center justify-center text-[13px] text-muted">{error}</div>
        ) : null}
      </div>

      {/* query + filters, floating top-left */}
      <div className="pointer-events-none absolute left-4 top-4 z-20 flex max-w-[calc(100%-32px)] flex-col gap-2" style={{ right: mine ? DRAWER_W + 16 : 16 }}>
        <QueryBar data={data} />
        <FilterChips data={data} counts={counts} />
      </div>

      <div className="absolute bottom-3 left-4 z-10">
        <Legend colourBy={colourBy} setColourBy={setColourBy} />
      </div>

      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1 text-center text-[12.5px]">
        {pathFrom && <span className="bg-bg px-2 font-medium text-fg"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent" />Pick the second entity for the path · Esc cancels</span>}
        {qerror && <span className="max-w-[420px] bg-bg/90 px-2 text-fg-2">{qerror}</span>}
        {fallback && <span className="bg-bg/90 px-2 text-muted" title="GET /graph/grand did not answer">Explore service offline · showing the case neighbourhoods</span>}
        {!fallback && stats && stats.total_nodes > data.nodes.length && (
          <span className="bg-bg/90 px-2 text-muted">A sample of {stats.total_nodes.toLocaleString()} entities in the full graph</span>
        )}
      </div>

      <Drawer open={!!mine && active} onClose={clearSelection} title={title} width={DRAWER_W} modal={false}>
        <Inspector data={data} scope="grand" />
      </Drawer>
    </div>
  );
}
