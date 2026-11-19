"use client";
// Graph workspace: the grand cross-bank identity graph, queryable and filterable.
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { useGraphStore } from "@/lib/graphStore";
import { useStore } from "@/lib/store";
import { endId, type GLink, type GNode } from "@/lib/graphAdapt";
import Filters, { useVisibility } from "@/components/graph/Filters";
import Inspector from "@/components/graph/Inspector";
import QueryBar from "@/components/graph/QueryBar";
import Legend from "@/components/graph/Legend";

const Graph3D = dynamic(() => import("@/components/graph/Graph3D"), {
  ssr: false,
  loading: () => <Stage text="Loading the 3D renderer" />,
});

function Stage({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center gap-2 text-[13px] text-muted">
      <Loader2 size={14} className="animate-spin" /> {text}
    </div>
  );
}

export default function GraphView() {
  const data = useGraphStore((s) => s.data);
  const loading = useGraphStore((s) => s.loading);
  const error = useGraphStore((s) => s.error);
  const fallback = useGraphStore((s) => s.fallback);
  const stats = useGraphStore((s) => s.stats);
  const colourBy = useGraphStore((s) => s.colourBy);
  const highlight = useGraphStore((s) => s.highlight);
  const selection = useGraphStore((s) => s.selection);
  const selScope = useGraphStore((s) => s.selScope);
  const focus = useGraphStore((s) => s.focus);
  const pathFrom = useGraphStore((s) => s.pathFrom);
  const qerror = useGraphStore((s) => s.qerror);
  const loadGrand = useGraphStore((s) => s.loadGrand);
  const select = useGraphStore((s) => s.select);
  const clearSelection = useGraphStore((s) => s.clearSelection);
  const focusOn = useGraphStore((s) => s.focusOn);
  const pathTo = useGraphStore((s) => s.pathTo);
  const active = useStore((s) => s.view) === "graph";
  const [showFilters, setShowFilters] = useState(true);
  const { nodeVisible, linkVisible, counts } = useVisibility(data);

  useEffect(() => { loadGrand(); }, [loadGrand]);
  // selection / highlight made in the Investigate view do not carry over
  useEffect(() => {
    if (active && useGraphStore.getState().selScope !== "grand") { clearSelection(); useGraphStore.getState().setHighlight(null); }
  }, [active, clearSelection]);

  const hlNodes = useMemo(() => new Set(highlight?.nodes ?? []), [highlight]);
  const hlLinks = useMemo(() => new Set(highlight?.links ?? []), [highlight]);
  const fitIds = useMemo(() => (highlight && highlight.nodes.length > 1 ? highlight.nodes : []), [highlight]);
  const fitKey = highlight ? `${highlight.label}:${highlight.nodes.length}` : "all";
  const mine = selScope === "grand" ? selection : null;

  const onNodeClick = useCallback((n: GNode) => {
    if (pathFrom && pathFrom !== n.id) { pathTo(n.id, data, "grand"); return; }
    select({ type: "node", id: n.id }, data, "grand");
    // light up the node's neighbourhood; the highlight change refits the camera onto it
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
    <div className="relative h-full w-full overflow-hidden bg-bg">
      <div className="absolute inset-0">
        {data.nodes.length ? (
          <Graph3D
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
            onNodeClick={onNodeClick}
            onLinkClick={onLinkClick}
            onBackgroundClick={clearSelection}
          />
        ) : loading ? (
          <Stage text="Building the identity graph" />
        ) : error ? (
          <div className="flex h-full items-center justify-center text-[13px] text-muted">{error}</div>
        ) : null}
      </div>

      {showFilters ? (
        <div className="absolute bottom-0 left-0 top-0 z-10">
          <Filters data={data} counts={counts} onClose={() => setShowFilters(false)} />
        </div>
      ) : (
        <button
          onClick={() => setShowFilters(true)}
          className="absolute left-3 top-3 z-10 flex h-9 items-center gap-1.5 rounded-[var(--radius)] border border-rule bg-surface/90 px-2.5 text-[13px] text-fg-2 backdrop-blur-md hover:text-fg"
        >
          <SlidersHorizontal size={14} /> Filters
          <span className="font-mono text-[11.5px] text-muted">{counts.shownNodes.toLocaleString()}</span>
        </button>
      )}

      <div className={`pointer-events-none absolute top-3 z-20 flex justify-center ${showFilters ? "left-[256px]" : "left-0"} ${mine ? "right-[372px]" : "right-0"}`}>
        <QueryBar data={data} />
      </div>

      {mine && (
        <div className="absolute bottom-0 right-0 top-0 z-20">
          <Inspector data={data} scope="grand" />
        </div>
      )}

      <div className={`absolute bottom-3 z-10 ${showFilters ? "left-[268px]" : "left-3"}`}>
        <Legend colourBy={colourBy} />
      </div>

      <div className={`absolute bottom-3 z-10 flex flex-col items-end gap-1 text-right text-[12px] text-muted ${mine ? "right-[384px]" : "right-3"}`}>
        {pathFrom && <span className="rounded-full bg-accent px-2.5 py-0.5 text-[12px] font-medium text-accent-ink">Pick the second entity for the path</span>}
        {qerror && <span className="max-w-[360px] text-fg-2">{qerror}</span>}
        {data.nodes.length > 0 && (
          <span className="font-mono text-[11.5px] tabular-nums">
            {counts.shownNodes.toLocaleString()} entities · {counts.shownLinks.toLocaleString()} links
            {stats ? ` · of ${stats.total_nodes.toLocaleString()} in the graph` : ""}
          </span>
        )}
        {fallback && <span title="GET /graph/grand did not answer">Explore service offline · showing the case neighbourhoods</span>}
      </div>
    </div>
  );
}
