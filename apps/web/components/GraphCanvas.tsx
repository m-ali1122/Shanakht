"use client";
import { useEffect, useRef } from "react";
import cytoscape, { type Core, type StylesheetJson } from "cytoscape";
// @ts-expect-error no bundled types
import fcose from "cytoscape-fcose";
import { useStore } from "@/lib/store";
import { HIDDEN_UNTIL_INCOMING } from "@/lib/mockGraph";
import { MOCK } from "@/lib/api";

let registered = false;

function v(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

function buildStyle(): StylesheetJson {
  const bank = (b: string) => v(`--bank-${b.toLowerCase()}`);
  const ink2 = v("--ink-2");
  const rule = v("--rule");
  const surface = v("--surface");
  const accent = v("--accent");
  const muted = v("--muted");
  const font = getComputedStyle(document.body).fontFamily;
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-family": font,
        "font-size": 9,
        color: ink2,
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-max-width": "90px",
        "text-wrap": "ellipsis",
        "min-zoomed-font-size": 6,
        "transition-property": "opacity, border-width, border-color, background-color",
        "transition-duration": 180,
      } as any,
    },
    { selector: 'node[kind="record"], node[kind="person"]', style: { shape: "ellipse", width: 16, height: 16, "background-color": ink2, "border-width": 0 } },
    {
      selector: 'node[kind="account"]',
      style: { shape: "round-rectangle", width: 18, height: 18, "background-color": surface, "border-width": 2, "border-color": (n: any) => bank(n.data("bank") || "MRGL") } as any,
    },
    { selector: 'node[kind="remitter"]', style: { shape: "diamond", width: 22, height: 22, "background-color": v("--ink"), "border-width": 0, "font-size": 10, color: v("--ink") } },
    { selector: 'node[kind="phone"], node[kind="device"]', style: { shape: "hexagon", width: 13, height: 13, "background-color": muted, "border-width": 0, "font-family": "monospace", "font-size": 8 } as any },
    {
      selector: 'node[kind="fingerprint"]',
      style: {
        shape: "hexagon", width: 14, height: 14, "background-opacity": 0, "border-width": 1.5, "border-style": "dashed",
        "border-color": (n: any) => bank(n.data("bank") || "RAVI"), "font-family": "monospace", "font-size": 8, color: muted,
      } as any,
    },
    {
      selector: "edge",
      style: {
        width: 1, "line-color": rule, "curve-style": "straight", "target-arrow-shape": "none",
        "transition-property": "line-color, width, opacity", "transition-duration": 180,
      } as any,
    },
    { selector: 'edge[rel="SENT"]', style: { "target-arrow-shape": "triangle", "target-arrow-color": rule, "arrow-scale": 0.5 } },
    { selector: 'edge[rel="SAME_AS"], edge[rel="FP"]', style: { "line-style": "dashed", "line-dash-pattern": [3, 3] } as any },
    { selector: ".dim", style: { opacity: 0.22 } },
    { selector: "node.hl", style: { opacity: 1, "border-color": accent, "border-width": 2 } },
    { selector: 'node.hl[kind="fingerprint"]', style: { "border-color": accent, "border-width": 2 } },
    { selector: 'node.hl[kind="record"], node.hl[kind="remitter"], node.hl[kind="phone"], node.hl[kind="device"]', style: { "background-color": accent } },
    { selector: "edge.hl", style: { opacity: 1, width: 2, "line-color": accent, "target-arrow-color": accent } },
    { selector: "node.hl", style: { color: v("--ink") } },
    { selector: ".hidden", style: { display: "none" } },
    { selector: "node:selected", style: { "overlay-opacity": 0 } },
  ];
}

export default function GraphCanvas() {
  const el = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const graph = useStore((s) => s.graph);
  const focus = useStore((s) => s.focus);
  const highlight = useStore((s) => s.highlight);
  const pulse = useStore((s) => s.pulse);
  const pulseNonce = useStore((s) => s.pulseNonce);
  const revealed = useStore((s) => s.revealed);
  const setHighlight = useStore((s) => s.setHighlight);
  const idsKey = useRef("");

  // Build / re-layout only when the element set changes.
  useEffect(() => {
    if (!el.current || !graph) return;
    if (!registered) {
      cytoscape.use(fcose);
      registered = true;
    }
    const key = graph.nodes.map((n) => n.data.id).join("|");
    if (cyRef.current && key === idsKey.current) return;
    idsKey.current = key;
    cyRef.current?.destroy();
    const cy = cytoscape({
      container: el.current,
      elements: [...graph.nodes, ...graph.edges] as any,
      style: buildStyle(),
      minZoom: 0.3,
      maxZoom: 1.6,
      boxSelectionEnabled: false,
    });
    cy.layout({ name: "fcose", quality: "proof", randomize: true, animate: false, nodeRepulsion: 6500, idealEdgeLength: 46, gravity: 0.3, nodeSeparation: 60, packComponents: true, seed: 7 } as any).run();
    cy.on("tap", "node", (evt) => {
      const n = evt.target;
      setHighlight([n.id(), ...n.neighborhood("node").map((x: any) => x.id())]);
    });
    cyRef.current = cy;
    applyFocus(cy, useStore.getState().focus, useStore.getState().highlight, useStore.getState().revealed, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Focus / highlight / reveal: style-only, never re-layout.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    applyFocus(cy, focus, highlight, revealed, true);
  }, [focus, highlight, revealed]);

  // One soft pulse on ring members.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || pulse.length === 0) return;
    pulse.forEach((id) => {
      const n = cy.getElementById(id);
      if (n.empty()) return;
      const w = n.width();
      n.animate({ style: { width: w * 1.6, height: w * 1.6 } as any }, { duration: 260, easing: "ease-out" }).animate(
        { style: { width: w, height: w } as any },
        { duration: 420, easing: "ease-in-out" },
      );
    });
  }, [pulseNonce, pulse]);

  useEffect(() => () => cyRef.current?.destroy(), []);

  return (
    <section className="relative min-w-0 flex-1 bg-paper">
      <div className="pointer-events-none absolute left-4 top-3 z-10">
        <div className="label">Identity graph</div>
      </div>
      <Legend />
      <div className="absolute inset-0">
        <div ref={el} className="h-full w-full" aria-label="Identity graph" />
      </div>
    </section>
  );
}

function applyFocus(cy: Core, focus: string[], highlight: string[], revealed: string[], animate: boolean) {
  cy.batch(() => {
    if (MOCK) {
      HIDDEN_UNTIL_INCOMING.forEach((id) => {
        const n = cy.getElementById(id);
        if (revealed.includes(id)) {
          if (n.hasClass("hidden")) {
            const anchor = n.neighborhood("node").first() as any;
            if (anchor.nonempty()) n.position({ x: anchor.position("x") + 55, y: anchor.position("y") + 35 });
            n.removeClass("hidden");
          }
        } else n.addClass("hidden");
      });
    }
    cy.elements().removeClass("hl dim");
    const fset = new Set(focus);
    const hset = new Set(highlight);
    const active = hset.size ? hset : fset;
    cy.nodes().forEach((n) => {
      if (!fset.has(n.id()) && !hset.has(n.id())) n.addClass("dim");
      if (hset.has(n.id())) n.addClass("hl");
    });
    cy.edges().forEach((e) => {
      const s = e.source().id(), t = e.target().id();
      if (active.has(s) && active.has(t)) {
        if (hset.size) e.addClass("hl");
      } else e.addClass("dim");
    });
  });
  const target = cy.nodes().filter((n) => (focus.includes(n.id()) || highlight.includes(n.id())) && !n.hasClass("hidden"));
  if (target.nonempty()) {
    if (animate) cy.animate({ fit: { eles: target, padding: 70 } } as any, { duration: 200, easing: "ease-out" } as any);
    else cy.fit(target, 70);
  }
}

function Legend() {
  const item = (shape: React.ReactNode, text: string) => (
    <span className="flex items-center gap-1.5">
      {shape}
      <span>{text}</span>
    </span>
  );
  return (
    <div className="pointer-events-none absolute bottom-3 left-4 z-10 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      {item(<svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="var(--ink-2)" /></svg>, "Host record")}
      {item(<svg width="12" height="12"><rect x="1.5" y="1.5" width="9" height="9" rx="2.5" fill="var(--surface)" stroke="var(--bank-ravi)" strokeWidth="1.5" /></svg>, "Account (bank ring)")}
      {item(<svg width="12" height="12"><path d="M6 0.5 L11.5 6 L6 11.5 L0.5 6Z" fill="var(--ink)" /></svg>, "Remitter")}
      {item(<svg width="12" height="12"><path d="M3 1 H9 L11.5 6 L9 11 H3 L0.5 6Z" fill="var(--muted)" /></svg>, "Phone / device")}
      {item(<svg width="12" height="12"><path d="M3 1 H9 L11.5 6 L9 11 H3 L0.5 6Z" fill="none" stroke="var(--bank-inds)" strokeDasharray="2 1.5" /></svg>, "Partner fingerprint")}
    </div>
  );
}
