"use client";
// Reusable 3D identity graph (react-force-graph-3d). Load this module with next/dynamic ssr:false.
// Security: the library's HTML tooltips are disabled; our tooltip writes textContent only.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import type { GData, GLink, GNode } from "@/lib/graphAdapt";
import { endId } from "@/lib/graphAdapt";
import type { ColourBy } from "@/lib/graphStore";
import {
  ACCENT, BANK_NAME, DIM, FG, KIND_COLOR, KIND_LABEL, MAIN_BRIGHT, NOMATCH, SCENARIO_COLOR, SCENARIO_NONE,
  bankColor, relColor, relLabel, type Kind,
} from "@/lib/palette";

export type Graph3DProps = {
  data: GData;
  variant: "case" | "grand";
  colourBy: ColourBy;
  highlightNodes?: Set<string>;
  highlightLinks?: Set<string>;
  dimOthers?: boolean;
  focus?: { id: string; nonce: number } | null;
  /** zoom-to-fit these nodes whenever fitKey changes (all nodes when empty) */
  fitIds?: string[];
  fitKey?: string | number;
  selectedId?: string | null;
  selectedLinkId?: string | null;
  ringIds?: Set<string>;
  tamperedIds?: Set<string>;
  hiddenIds?: Set<string>;
  /** scenario focus (case view): drawn bright with a soft halo when nothing is highlighted */
  focusIds?: Set<string>;
  pulse?: { ids: string[]; nonce: number };
  nodeVisible?: (n: GNode) => boolean;
  linkVisible?: (l: GLink) => boolean;
  onNodeClick?: (n: GNode) => void;
  onLinkClick?: (l: GLink) => void;
  onBackgroundClick?: () => void;
  /** false while the workspace is hidden: rendering pauses */
  active?: boolean;
};

// ---------------------------------------------------------------- shared three.js resources
const GEOM: Record<Kind, THREE.BufferGeometry> = {
  remitter: new THREE.OctahedronGeometry(1.25),
  account: new THREE.BoxGeometry(1.5, 1.5, 1.5),
  record: new THREE.SphereGeometry(1, 14, 10),
  person: new THREE.SphereGeometry(1, 20, 14),
  phone: new THREE.TetrahedronGeometry(1.3),
  device: new THREE.TetrahedronGeometry(1.3).rotateX(Math.PI),
  fingerprint: new THREE.IcosahedronGeometry(1.2, 0),
  decision: new THREE.DodecahedronGeometry(1.1),
};
const BASE_R: Record<Kind, number> = { remitter: 5.2, account: 4, record: 3, person: 5, phone: 2.6, device: 2.6, fingerprint: 3, decision: 4 };
const HALO_GEOM = new THREE.SphereGeometry(1, 20, 14);
const MATS = new Map<string, THREE.Material>();
function mat(color: string, wire: boolean, dim: boolean): THREE.Material {
  const k = `${color}|${wire}|${dim}`;
  let m = MATS.get(k);
  if (!m) {
    const c = new THREE.Color(dim ? DIM : color);
    m = wire
      ? new THREE.MeshBasicMaterial({ color: c, wireframe: true, transparent: true, opacity: dim ? 0.25 : 0.95 })
      : new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: dim ? 0.1 : 0.28 }); // dim = opaque dark: no transparent sorting for thousands of nodes
    MATS.set(k, m);
  }
  return m;
}
const HALO_MATS = new Map<string, THREE.Material>();
function haloMat(color: string, strong: boolean) {
  const k = color + strong;
  let m = HALO_MATS.get(k);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: strong ? 0.3 : 0.18, depthWrite: false });
    HALO_MATS.set(k, m);
  }
  return m;
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const NO_LABEL = () => "";
const DIRECTIONAL = new Set(["SENT", "HOLDS", "RESOLVES_TO", "HAS_FP"]);

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const f = () => setR(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return r;
}

type Sty = Graph3DProps & { hovered: string | null; reduced: boolean; labelIds?: Set<string> };

const LABEL_BUDGET = 40;
/** Which highlighted / focused nodes get a text label: a small budget, senders and people first. */
function pickLabels(nodes: GNode[], s: Sty): Set<string> {
  const out = new Set<string>();
  const hl = s.highlightNodes;
  const pool = hl?.size ? nodes.filter((n) => hl.has(n.id)) : s.variant === "case" ? nodes.filter((n) => isFocus(n, s)) : [];
  const rank = (n: GNode) => (n.kind === "remitter" ? 0 : n.kind === "person" ? 1 : n.kind === "account" ? 2 : n.kind === "record" ? 3 : 4);
  pool.sort((a, b) => rank(a) - rank(b));
  for (const n of pool.slice(0, LABEL_BUDGET)) out.add(n.id);
  return out;
}

function nodeColour(n: GNode, by: ColourBy) {
  if (by === "bank") return n.bank ? bankColor(n.bank) : n.kind === "remitter" ? MAIN_BRIGHT : "#5C627C";
  if (by === "scenario") {
    const s = n.scenarios?.[0];
    return s ? SCENARIO_COLOR[s] ?? SCENARIO_NONE : SCENARIO_NONE;
  }
  return KIND_COLOR[n.kind] ?? FG;
}
function nodeRadius(n: GNode, variant: "case" | "grand") {
  const base = BASE_R[n.kind] ?? 3;
  const deg = n.degree ?? 0;
  const f = variant === "grand" ? 1 + Math.min(0.9, Math.log2(1 + deg) * 0.13) : 1 + Math.min(0.5, Math.log2(1 + deg) * 0.08);
  return base * f;
}

const isFocus = (n: GNode, s: Sty) => (s.focusIds ? s.focusIds.has(n.id) : !!n.focus);

function styleNode(n: GNode, s: Sty) {
  const mesh: THREE.Mesh | undefined = n.__mesh;
  if (!mesh) return;
  // halo and label are children of the mesh (one scene object per node, not a group + mesh),
  // so they sit in the mesh's scaled space: sizes below are divided by r.
  const anyHl = !!s.highlightNodes?.size;
  const hl = !!s.highlightNodes?.has(n.id);
  const sel = s.selectedId === n.id;
  const ring = !!s.ringIds?.has(n.id);
  const tampered = !!n.tampered || !!s.tamperedIds?.has(n.id);
  // dimmed: something else is highlighted, or (case view, nothing highlighted) the node is outside the scenario focus
  const dim = !!s.dimOthers && !sel && (anyHl ? !hl : s.variant === "case" && !isFocus(n, s));
  const wire = n.kind === "fingerprint" || !!n.hollow;
  const colour = tampered || ring ? NOMATCH : nodeColour(n, s.colourBy);
  mesh.material = mat(colour, wire, dim);
  const r = nodeRadius(n, s.variant);
  mesh.scale.setScalar(r);

  // halo: lime for selection / highlight / focus, red for ring or tampered
  const haloOn = sel || hl || ring || tampered || (s.variant === "case" && !anyHl && isFocus(n, s));
  let halo: THREE.Mesh | undefined = n.__halo;
  if (haloOn && !halo) {
    halo = new THREE.Mesh(HALO_GEOM, haloMat(ACCENT, false));
    n.__halo = halo;
    mesh.add(halo);
  }
  if (halo) {
    halo.visible = haloOn;
    if (haloOn) {
      halo.material = haloMat(ring || tampered ? NOMATCH : ACCENT, sel);
      halo.scale.setScalar(sel ? 2 : 1.7);
    }
  }

  // labels only for the few nodes worth reading
  const want = sel || s.hovered === n.id || !!s.labelIds?.has(n.id);
  let label: SpriteText | undefined = n.__label;
  if (want && !label) {
    label = new SpriteText(n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label, (s.variant === "grand" ? 3.4 : 2.8) / r, FG);
    label.fontFace = "Geist, ui-sans-serif, system-ui, sans-serif";
    label.fontWeight = "500";
    label.backgroundColor = "rgba(10,12,20,0.78)";
    label.padding = [1.6 / r, 0.8 / r];
    label.borderRadius = 1.4 / r;
    (label.material as THREE.SpriteMaterial).depthWrite = false;
    (label.material as THREE.SpriteMaterial).depthTest = false;
    label.renderOrder = 10;
    n.__label = label;
    mesh.add(label);
  }
  if (label) {
    label.visible = want;
    const c = sel ? ACCENT : FG;
    if (label.color !== c) label.color = c; // every SpriteText setter redraws its canvas: only touch on change
    label.position.set(0, -(1.4 + 3.2 / r), 0);
  }
}

export default memo(Graph3D);

function Graph3D(props: Graph3DProps) {
  const { data, variant } = props;
  const box = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  if (typeof window !== "undefined") { (window as any).__THREE = THREE; (window as any).__fgr = fg; } // TEMP
  const [size, setSize] = useState({ w: 0, h: 0 });
  const reduced = useReducedMotion();
  const hovered = useRef<string | null>(null);
  const sty = useRef<Sty>({ ...props, hovered: null, reduced });
  sty.current = { ...props, hovered: hovered.current, reduced, labelIds: sty.current.labelIds };
  const fitted = useRef(false);
  const pendingFit = useRef(false);
  const engineRunning = useRef(true);
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);

  // ---- size from the container
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ---- pause rendering when the workspace is hidden, off screen, or the tab is hidden
  const activeRef = useRef(props.active ?? true);
  const applyRun = useRef<() => void>(() => {});
  useEffect(() => {
    activeRef.current = props.active ?? true;
    applyRun.current();
  }, [props.active]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let visible = true;
    const apply = () => {
      const g = fg.current;
      if (!g) return;
      if (visible && activeRef.current && !document.hidden) g.resumeAnimation(); else g.pauseAnimation();
    };
    applyRun.current = apply;
    const io = new IntersectionObserver((es) => { visible = es[0]?.isIntersecting ?? true; apply(); });
    io.observe(el);
    document.addEventListener("visibilitychange", apply);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", apply); };
  }, [size.w > 0]);

  // ---- forces
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    const charge = g.d3Force("charge");
    charge?.strength?.(variant === "grand" ? -34 : -140);
    charge?.distanceMax?.(variant === "grand" ? 260 : 400);
    const link = g.d3Force("link");
    link?.distance?.((l: GLink) => {
      const base = l.rel === "HOLDS" ? 14 : l.rel === "RESOLVES_TO" ? 20 : l.rel === "SENT" ? 42 : l.rel === "SAME_AS" ? 16 : 24;
      return variant === "grand" ? base : base * 1.5;
    });
    g.d3ReheatSimulation();
  }, [variant, size.w > 0]);

  // ---- new data: refit after the layout settles
  useEffect(() => {
    fitted.current = false;
    engineRunning.current = true;
  }, [data]);

  const flyTo = useCallback((n: GNode) => {
    const g = fg.current;
    if (!g || n.x === undefined) return false;
    const d = variant === "grand" ? 190 : 120;
    const len = Math.max(1, Math.hypot(n.x, n.y ?? 0, n.z ?? 0));
    const r = 1 + d / len;
    g.cameraPosition({ x: n.x * r, y: (n.y ?? 0) * r, z: (n.z ?? 0) * r }, { x: n.x, y: n.y ?? 0, z: n.z ?? 0 }, sty.current.reduced ? 0 : 1100);
    return true;
  }, [variant]);

  const doFit = useCallback((ms?: number) => {
    const g = fg.current;
    if (!g || !data.nodes.length) return;
    const ids = sty.current.fitIds;
    const set = ids && ids.length ? new Set(ids) : null;
    const inSet = set ? data.nodes.filter((n) => set.has(n.id) && n.x !== undefined) : [];
    if (set && inSet.length === 1) { flyTo(inSet[0]); return; } // a one-point bbox would put the camera inside the node
    g.zoomToFit(sty.current.reduced ? 0 : ms ?? 700, variant === "grand" ? 40 : 70, set && inSet.length ? (n) => set.has((n as GNode).id) : undefined);
  }, [data, variant, flyTo]);

  useEffect(() => {
    if (props.fitKey === undefined) return;
    if (engineRunning.current) pendingFit.current = true;
    else doFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitKey]);

  const onEngineStop = useCallback(() => {
    engineRunning.current = false;
    if (!fitted.current || pendingFit.current) {
      fitted.current = true;
      pendingFit.current = false;
      doFit();
    }
  }, [doFit]);

  // ---- restyle nodes in place (no object rebuild)
  const restyleAll = useCallback(() => {
    sty.current = { ...sty.current, labelIds: pickLabels(data.nodes, sty.current) };
    for (const n of data.nodes) styleNode(n, sty.current);
  }, [data]);
  useEffect(() => {
    restyleAll();
  }, [restyleAll, props.highlightNodes, props.selectedId, props.colourBy, props.ringIds, props.tamperedIds, props.dimOthers, props.focusIds, variant]);

  // ---- fly to a node
  useEffect(() => {
    const f = props.focus;
    if (!f) return;
    let tries = 0;
    let t: ReturnType<typeof setTimeout>;
    const go = () => {
      const n = byId.get(f.id);
      if (!n) return;
      if (!flyTo(n) && tries++ < 8) t = setTimeout(go, 300);
    };
    go();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus?.nonce, props.focus?.id]);

  // ---- one soft pulse on the given nodes
  useEffect(() => {
    const p = props.pulse;
    if (!p || !p.ids.length || reduced) return;
    const nodes = p.ids.map((id) => byId.get(id)).filter(Boolean) as GNode[];
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 800);
      const s = 1 + 0.7 * Math.sin(Math.PI * k);
      for (const n of nodes) n.__mesh?.scale.setScalar(nodeRadius(n, variant) * s);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pulse?.nonce]);

  // ---- node objects (built once per node; styled in place afterwards)
  const nodeThreeObject = useCallback((node: object) => {
    const n = node as GNode;
    const mesh = new THREE.Mesh(GEOM[n.kind] ?? GEOM.record, mat(FG, false, false));
    n.__mesh = mesh;
    n.__halo = undefined;
    n.__label = undefined;
    styleNode(n, sty.current);
    return mesh;
  }, []);

  // ---- visibility
  const nodeShown = useCallback((node: object) => {
    const n = node as GNode;
    if (props.hiddenIds?.has(n.id)) return false;
    return props.nodeVisible ? props.nodeVisible(n) : true;
  }, [props.hiddenIds, props.nodeVisible]);
  const linkShown = useCallback((link: object) => {
    const l = link as GLink;
    const a = byId.get(endId(l.source)), b = byId.get(endId(l.target));
    if (!a || !b || !nodeShown(a) || !nodeShown(b)) return false;
    return props.linkVisible ? props.linkVisible(l) : true;
  }, [byId, nodeShown, props.linkVisible]);

  // ---- link styling
  const hlN = props.highlightNodes, hlL = props.highlightLinks, sel = props.selectedLinkId, ring = props.ringIds;
  const linkHl = useCallback((l: GLink) => {
    if (sel === l.id) return true;
    if (hlL?.size) return hlL.has(l.id);
    return !!hlN?.size && hlN.has(endId(l.source)) && hlN.has(endId(l.target));
  }, [hlN, hlL, sel]);
  const anyHl = !!(hlN?.size || hlL?.size);
  const linkColor = useCallback((link: object) => {
    const l = link as GLink;
    if (sel === l.id) return ACCENT;
    const a = endId(l.source), b = endId(l.target);
    if (ring?.has(a) && ring?.has(b)) return NOMATCH;
    if (linkHl(l)) return relColor(l.rel);
    if (props.dimOthers && anyHl) return "rgba(60,66,92,0.22)";
    if (variant === "case" && props.dimOthers && !anyHl) {
      const f = props.focusIds;
      const fa = f ? f.has(a) : byId.get(a)?.focus, fb = f ? f.has(b) : byId.get(b)?.focus;
      if (!(fa && fb)) return "rgba(60,66,92,0.3)";
    }
    return hexA(relColor(l.rel), variant === "grand" ? 0.42 : 0.7);
  }, [sel, ring, linkHl, props.dimOthers, props.focusIds, anyHl, variant, byId]);
  const linkWidth = useCallback((link: object) => {
    const l = link as GLink;
    if (sel === l.id) return 1.8;
    if (linkHl(l)) return variant === "grand" ? 1.1 : 1.3;
    return variant === "case" ? 0.45 : 0;
  }, [sel, linkHl, variant]);
  const particles = useCallback((link: object) => {
    if (reduced) return 0;
    const l = link as GLink;
    if (sel === l.id) return 4;
    const h = linkHl(l);
    if (h) return 3;
    if (props.dimOthers && anyHl) return 0;
    if (l.rel === "SENT") return variant === "grand" ? 1 : Math.min(4, 1 + (l.count ?? 1));
    return 0;
  }, [reduced, sel, linkHl, props.dimOthers, anyHl, variant]);
  const particleColor = useCallback((link: object) => {
    const l = link as GLink;
    return sel === l.id || linkHl(l) ? ACCENT : relColor(l.rel);
  }, [sel, linkHl]);
  const arrowLen = useCallback((link: object) => {
    const l = link as GLink;
    if (!DIRECTIONAL.has(l.rel)) return 0;
    if (variant === "case") return l.rel === "SENT" || linkHl(l) ? 3.2 : 0;
    return linkHl(l) ? 3.6 : 0;
  }, [variant, linkHl]);
  const curvature = useCallback((link: object) => {
    const l = link as GLink;
    return (l.curv ?? 0) + (l.rel === "SENT" && !l.curv ? 0.12 : 0);
  }, []);

  // ---- hover tooltip (textContent only)
  const showTip = useCallback((title: string | null, sub?: string) => {
    const t = tip.current;
    if (!t) return;
    if (!title) { t.style.display = "none"; return; }
    t.replaceChildren();
    const b = document.createElement("div");
    b.className = "text-[13px] font-medium text-fg";
    b.textContent = title;
    t.append(b);
    if (sub) {
      const s = document.createElement("div");
      s.className = "text-[12px] text-muted";
      s.textContent = sub;
      t.append(s);
    }
    t.style.display = "block";
  }, []);
  useEffect(() => {
    const el = box.current, t = tip.current;
    if (!el || !t) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(e.clientX - r.left + 14, r.width - 260), y = Math.min(e.clientY - r.top + 16, r.height - 56);
      t.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
    };
    el.addEventListener("pointermove", move);
    return () => el.removeEventListener("pointermove", move);
  }, []);
  const setHover = useCallback((id: string | null) => {
    const prev = hovered.current;
    hovered.current = id;
    sty.current = { ...sty.current, hovered: id };
    for (const x of [prev, id]) { const n = x ? byId.get(x) : undefined; if (n) styleNode(n, sty.current); }
    if (box.current) box.current.style.cursor = id ? "pointer" : "";
  }, [byId]);
  const onNodeHover = useCallback((node: object | null) => {
    const n = node as GNode | null;
    setHover(n?.id ?? null);
    if (!n) { showTip(null); return; }
    const bits = [KIND_LABEL[n.kind] ?? n.kind, n.bank ? BANK_NAME[n.bank] ?? n.bank : null, n.scenarios?.length ? `case ${n.scenarios.map((s) => s.slice(1)).join(", ")}` : null];
    showTip(n.label, bits.filter(Boolean).join(" · "));
  }, [setHover, showTip]);
  const onLinkHover = useCallback((link: object | null) => {
    const l = link as GLink | null;
    if (box.current) box.current.style.cursor = l ? "pointer" : hovered.current ? "pointer" : "";
    if (!l) { if (!hovered.current) showTip(null); return; }
    const a = byId.get(endId(l.source)), b = byId.get(endId(l.target));
    const extra = l.count && l.count > 1 ? ` · ${l.count} transfers` : l.score != null ? ` · score ${l.score.toFixed(2)}` : "";
    showTip(relLabel(l.rel) + extra, `${a?.label ?? endId(l.source)} → ${b?.label ?? endId(l.target)}`);
  }, [byId, showTip]);

  const nodeClick = useCallback((node: object) => props.onNodeClick?.(node as GNode), [props.onNodeClick]);
  const linkClick = useCallback((link: object) => props.onLinkClick?.(link as GLink), [props.onLinkClick]);
  const bgClick = useCallback(() => props.onBackgroundClick?.(), [props.onBackgroundClick]);

  return (
    <div ref={box} className="relative h-full w-full overflow-hidden" onPointerLeave={() => showTip(null)}>
      {size.w > 0 && size.h > 0 && (
        <ForceGraph3D
          ref={fg as any}
          graphData={data as any}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          showNavInfo={false}
          nodeId="id"
          nodeLabel={NO_LABEL}
          linkLabel={NO_LABEL}
          nodeThreeObject={nodeThreeObject}
          nodeVisibility={nodeShown}
          linkVisibility={linkShown}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkOpacity={0.85}
          linkResolution={4}
          linkCurvature={curvature}
          linkDirectionalArrowLength={arrowLen}
          linkDirectionalArrowRelPos={0.92}
          linkDirectionalArrowColor={linkColor}
          linkDirectionalArrowResolution={6}
          linkDirectionalParticles={particles}
          linkDirectionalParticleWidth={variant === "grand" ? 1.3 : 1.5}
          linkDirectionalParticleSpeed={0.006}
          linkDirectionalParticleColor={particleColor}
          linkDirectionalParticleResolution={6}
          linkHoverPrecision={variant === "grand" ? 2.5 : 4}
          warmupTicks={variant === "grand" ? 100 : 30}
          cooldownTicks={variant === "grand" ? 70 : 140}
          cooldownTime={variant === "grand" ? 6000 : 9000}
          d3AlphaDecay={0.03}
          d3VelocityDecay={0.34}
          enableNodeDrag={variant === "case"}
          onEngineStop={onEngineStop}
          onNodeHover={onNodeHover}
          onLinkHover={onLinkHover}
          onNodeClick={nodeClick}
          onLinkClick={linkClick}
          onBackgroundClick={bgClick}
        />
      )}
      <div
        ref={tip}
        className="pointer-events-none absolute left-0 top-0 z-20 max-w-[260px] rounded-[var(--radius-sm)] border border-rule bg-surface/95 px-2.5 py-1.5 shadow-lg backdrop-blur-sm"
        style={{ display: "none" }}
        role="tooltip"
      />
    </div>
  );
}
