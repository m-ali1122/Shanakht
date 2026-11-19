"use client";
// Reusable 2D identity graph (react-force-graph-2d). Load this module with next/dynamic ssr:false.
// Pan by dragging the background, wheel/pinch to zoom, drag nodes (they stay where dropped;
// right-click a node to release it). Drawn on canvas with plain marks: no glow, no particles.
// Security: the library's HTML tooltips are disabled; our tooltip writes textContent only.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { Maximize, Minus, Plus } from "lucide-react";
import type { GData, GLink, GNode } from "@/lib/graphAdapt";
import { endId } from "@/lib/graphAdapt";
import type { ColourBy } from "@/lib/graphStore";
import {
  ACCENT, ACCENT_EDGE, BANK_NAME, DIM, FG, FG2, KIND_COLOR, KIND_LABEL, LINK, LINK_DIM, MAIN, NO_BANK, NOMATCH,
  SCENARIO_COLOR, SCENARIO_NONE, STAGE, bankColor, hexA, relColor, relLabel, type Kind,
} from "@/lib/palette";

export type Graph2DProps = {
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
  /** scenario focus (case view): drawn at full strength with a lime halo when nothing is highlighted */
  focusIds?: Set<string>;
  pulse?: { ids: string[]; nonce: number };
  nodeVisible?: (n: GNode) => boolean;
  linkVisible?: (l: GLink) => boolean;
  /** nodes that stay on the map for orientation but are drawn faded (e.g. outside a filter) */
  nodeFaded?: (n: GNode) => boolean;
  onNodeClick?: (n: GNode) => void;
  onLinkClick?: (l: GLink) => void;
  onBackgroundClick?: () => void;
  /** false while the workspace is hidden: rendering pauses */
  active?: boolean;
  /** extra controls placed above the zoom buttons (e.g. a fullscreen toggle) */
  controls?: ReactNode;
  /** px kept clear on the right for an open drawer (moves the zoom buttons) */
  rightInset?: number;
  /** px covered by floating controls at the top; fitting keeps nodes below it */
  topInset?: number;
};

// graph-unit radii; a screen-space minimum keeps tiny nodes visible when zoomed out
const BASE_R: Record<Kind, number> = { remitter: 4.6, account: 3.8, record: 2.6, person: 5.2, phone: 2.4, device: 2.4, fingerprint: 2.8, decision: 3.8 };
const MIN_PX: Record<Kind, number> = { remitter: 2.6, account: 2.3, record: 1.5, person: 2.8, phone: 1.4, device: 1.4, fingerprint: 1.6, decision: 2.2 };
const DIRECTIONAL = new Set(["SENT", "HOLDS", "RESOLVES_TO", "HAS_FP"]);
const NO_LABEL = () => "";
const LABEL_BUDGET = 40;
const FONT = "Geist, ui-sans-serif, system-ui, sans-serif";

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

function nodeColour(n: GNode, by: ColourBy) {
  if (by === "bank") return n.bank ? bankColor(n.bank) : n.kind === "remitter" ? MAIN : NO_BANK;
  if (by === "scenario") {
    const s = n.scenarios?.[0];
    return s ? SCENARIO_COLOR[s] ?? SCENARIO_NONE : SCENARIO_NONE;
  }
  return KIND_COLOR[n.kind] ?? FG;
}
function radius(n: GNode, variant: "case" | "grand", k: number) {
  const deg = n.degree ?? 0;
  const f = variant === "grand" ? 1 + Math.min(0.8, Math.log2(1 + deg) * 0.12) : 1 + Math.min(0.4, Math.log2(1 + deg) * 0.07);
  return Math.max((BASE_R[n.kind] ?? 3) * f, (MIN_PX[n.kind] ?? 1.5) / k);
}
/** zoom level above which a kind's labels appear on their own */
function labelZoom(kind: Kind, variant: "case" | "grand") {
  const big = kind === "remitter" || kind === "person" || kind === "account" || kind === "decision";
  if (variant === "case") return big ? 1.1 : kind === "record" ? 1.8 : 2.8;
  return big ? 2.4 : kind === "record" ? 3.6 : 5;
}

function shape(ctx: CanvasRenderingContext2D, kind: Kind, x: number, y: number, r: number) {
  ctx.beginPath();
  switch (kind) {
    case "remitter": {
      const d = r * 1.25;
      ctx.moveTo(x, y - d); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d, y); ctx.closePath();
      break;
    }
    case "account": {
      const s = r * 0.9;
      ctx.rect(x - s, y - s, s * 2, s * 2);
      break;
    }
    case "phone": {
      const d = r * 1.2;
      ctx.moveTo(x, y - d); ctx.lineTo(x + d * 0.95, y + d * 0.7); ctx.lineTo(x - d * 0.95, y + d * 0.7); ctx.closePath();
      break;
    }
    case "device": {
      const d = r * 1.2;
      ctx.moveTo(x, y + d); ctx.lineTo(x + d * 0.95, y - d * 0.7); ctx.lineTo(x - d * 0.95, y - d * 0.7); ctx.closePath();
      break;
    }
    case "decision": {
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const px = x + r * 1.1 * Math.cos(a), py = y + r * 1.1 * Math.sin(a);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      break;
    }
    default:
      ctx.arc(x, y, r, 0, 2 * Math.PI);
  }
}

export default memo(Graph2D);

function Graph2D(props: Graph2DProps) {
  const { data, variant } = props;
  const box = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const reduced = useReducedMotion();
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverLink, setHoverLink] = useState<string | null>(null);
  const [animating, setAnimating] = useState(false);
  const pulseScale = useRef<Map<string, number>>(new Map());
  const zoomK = useRef(1);
  const fitted = useRef(false);
  const pendingFit = useRef(false);
  const engineRunning = useRef(true);
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);
  const propsRef = useRef(props);
  propsRef.current = props;

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

  // ---- forces: compact clusters, enough repulsion that ~2.5k nodes read as islands
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    const charge = g.d3Force("charge");
    charge?.strength?.((n: GNode) => (variant === "grand" ? -14 - Math.min(40, (n.degree ?? 0) * 2) : -90));
    charge?.distanceMax?.(variant === "grand" ? 160 : 320);
    const link = g.d3Force("link");
    link?.distance?.((l: GLink) => {
      const base = l.rel === "HOLDS" ? 9 : l.rel === "RESOLVES_TO" ? 12 : l.rel === "SENT" ? 30 : l.rel === "SAME_AS" ? 10 : 15;
      return variant === "grand" ? base : base * 1.9;
    });
    g.d3Force("center")?.strength?.(variant === "grand" ? 0.04 : 0.1);
    g.d3ReheatSimulation();
  }, [variant, size.w > 0]);

  // ---- new data: refit after the layout settles
  useEffect(() => {
    fitted.current = false;
    engineRunning.current = true;
  }, [data]);

  const flyTo = useCallback((n: GNode) => {
    const g = fg.current;
    if (!g || n.x === undefined || n.y === undefined) return false;
    const ms = reduced ? 0 : 650;
    g.centerAt(n.x, n.y, ms);
    g.zoom(Math.max(g.zoom(), variant === "grand" ? 4.5 : 3), ms);
    return true;
  }, [variant, reduced]);

  const sizeRef = useRef(size);
  sizeRef.current = size;
  /** fit a set of nodes into the part of the canvas not covered by overlays, never zooming in absurdly */
  const doFit = useCallback((ms?: number) => {
    const g = fg.current;
    if (!g || !data.nodes.length) return;
    const P = propsRef.current;
    const ids = P.fitIds;
    const set = ids && ids.length ? new Set(ids) : null;
    let pts = set ? data.nodes.filter((n) => set.has(n.id) && n.x !== undefined) : [];
    if (!pts.length) pts = data.nodes.filter((n) => n.x !== undefined && !P.hiddenIds?.has(n.id) && (P.nodeVisible ? P.nodeVisible(n) : true));
    if (!pts.length) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of pts) { x0 = Math.min(x0, n.x!); x1 = Math.max(x1, n.x!); y0 = Math.min(y0, n.y!); y1 = Math.max(y1, n.y!); }
    const { w, h } = sizeRef.current;
    const ri = P.rightInset ?? 0, ti = P.topInset ?? 0, pad = variant === "grand" ? 40 : 56;
    const aw = Math.max(80, w - ri - 2 * pad), ah = Math.max(80, h - ti - 2 * pad);
    const maxK = variant === "grand" ? (pts.length < 6 ? 3.5 : 6) : 3;
    const k = Math.min(aw / Math.max(1, x1 - x0), ah / Math.max(1, y1 - y0), maxK);
    const t = reduced ? 0 : ms ?? 600;
    g.centerAt((x0 + x1) / 2 + ri / 2 / k, (y0 + y1) / 2 - ti / 2 / k, t);
    g.zoom(k, t);
  }, [data, variant, reduced]);

  useEffect(() => {
    if (props.fitKey === undefined) return;
    doFit(); // fit now with current positions, and again once the layout settles
    if (engineRunning.current) pendingFit.current = true;
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

  // ---- move to a node
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
    const t0 = performance.now();
    let raf = 0;
    setAnimating(true);
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      const s = 1 + 0.8 * Math.sin(Math.PI * k);
      for (const id of p.ids) pulseScale.current.set(id, s);
      if (k < 1) raf = requestAnimationFrame(tick);
      else { pulseScale.current.clear(); setAnimating(false); }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); pulseScale.current.clear(); setAnimating(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pulse?.nonce]);

  // ---- styling inputs
  const { highlightNodes: hlN, highlightLinks: hlL, selectedId, selectedLinkId: selL, ringIds: ring, tamperedIds, focusIds, dimOthers, colourBy, nodeFaded } = props;
  const anyHl = !!(hlN?.size || hlL?.size);
  const isFocus = useCallback((n: GNode) => (focusIds ? focusIds.has(n.id) : !!n.focus), [focusIds]);

  const labelIds = useMemo(() => {
    const out = new Set<string>();
    const pool = hlN?.size ? data.nodes.filter((n) => hlN.has(n.id)) : variant === "case" ? data.nodes.filter(isFocus) : [];
    const rank = (n: GNode) => (n.kind === "remitter" ? 0 : n.kind === "person" ? 1 : n.kind === "account" ? 2 : n.kind === "record" ? 3 : 4);
    pool.sort((a, b) => rank(a) - rank(b));
    for (const n of pool.slice(0, LABEL_BUDGET)) out.add(n.id);
    return out;
  }, [data, hlN, variant, isFocus]);

  // neighbours of the hovered node: their links take colour on hover
  const hoverNb = useMemo(() => {
    if (!hoverNode) return null;
    const s = new Set<string>();
    for (const l of data.links) if (endId(l.source) === hoverNode || endId(l.target) === hoverNode) s.add(l.id);
    return s;
  }, [hoverNode, data]);

  const nodeDim = useCallback((n: GNode) => {
    if (selectedId === n.id) return false;
    if (nodeFaded?.(n)) return true;
    if (!dimOthers) return false;
    return anyHl ? !hlN?.has(n.id) : variant === "case" && !isFocus(n);
  }, [selectedId, nodeFaded, dimOthers, anyHl, hlN, variant, isFocus]);

  const nodeCanvasObject = useCallback((node: object, ctx: CanvasRenderingContext2D, k: number) => {
    const n = node as GNode;
    if (n.x === undefined || n.y === undefined) return;
    const x = n.x, y = n.y;
    const sel = selectedId === n.id;
    const hl = !!hlN?.has(n.id);
    const isRing = !!ring?.has(n.id);
    const tampered = !!n.tampered || !!tamperedIds?.has(n.id);
    const hov = hoverNode === n.id;
    const dim = nodeDim(n);
    const focused = variant === "case" && !anyHl && isFocus(n);
    const r = radius(n, variant, k) * (pulseScale.current.get(n.id) ?? 1);

    // halo: lime fill for selection / highlight / case focus
    if (!dim && (sel || hl || focused)) {
      ctx.beginPath();
      ctx.arc(x, y, r + (sel ? 7 : 4.5) / k, 0, 2 * Math.PI);
      ctx.fillStyle = hexA(ACCENT, sel ? 0.75 : 0.5);
      ctx.fill();
      if (sel) { ctx.lineWidth = 1.2 / k; ctx.strokeStyle = ACCENT_EDGE; ctx.stroke(); }
    }
    // ring alert / tampered: red ring
    if (isRing || tampered) {
      ctx.beginPath();
      ctx.arc(x, y, r + 3.2 / k, 0, 2 * Math.PI);
      ctx.lineWidth = 1.6 / k;
      ctx.strokeStyle = NOMATCH;
      ctx.stroke();
    }

    const colour = dim ? DIM : isRing || tampered ? NOMATCH : nodeColour(n, colourBy);
    const hollow = n.kind === "fingerprint" || !!n.hollow;
    shape(ctx, n.kind, x, y, r);
    if (hollow) {
      ctx.fillStyle = STAGE;
      ctx.fill();
      ctx.lineWidth = Math.max(1.4 / k, r * 0.38);
      ctx.strokeStyle = colour;
      ctx.stroke();
    } else {
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.lineWidth = 1 / k;
      ctx.strokeStyle = STAGE;
      ctx.stroke();
    }
    if (hov && !sel) {
      shape(ctx, n.kind, x, y, r + 1.8 / k);
      ctx.lineWidth = 1.2 / k;
      ctx.strokeStyle = FG;
      ctx.stroke();
    }

    // labels: when zoomed in far enough, or for the few nodes worth reading
    const want = sel || hov || (!dim && (labelIds.has(n.id) || k >= labelZoom(n.kind, variant)));
    if (!want) return;
    const text = n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label;
    const fs = (sel || hov ? 12 : 11) / k;
    ctx.font = `${sel || hov ? 600 : 500} ${fs}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const ty = y + r * (n.kind === "remitter" ? 1.25 : 1) + 3 / k;
    ctx.lineJoin = "round";
    ctx.lineWidth = 3 / k;
    ctx.strokeStyle = hexA(STAGE, 0.92);
    ctx.strokeText(text, x, ty);
    ctx.fillStyle = sel || hov ? FG : FG2;
    ctx.fillText(text, x, ty);
  }, [selectedId, hlN, ring, tamperedIds, hoverNode, nodeDim, variant, anyHl, isFocus, colourBy, labelIds]);

  const nodePointerAreaPaint = useCallback((node: object, color: string, ctx: CanvasRenderingContext2D, k: number) => {
    const n = node as GNode;
    if (n.x === undefined || n.y === undefined) return;
    ctx.beginPath();
    ctx.arc(n.x, n.y, radius(n, variant, k) + 3 / k, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  }, [variant]);

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

  // ---- link styling: thin grey at rest, coloured by relationship only when it matters
  const linkHl = useCallback((l: GLink) => {
    if (selL === l.id) return true;
    if (hlL?.size) return hlL.has(l.id);
    return !!hlN?.size && hlN.has(endId(l.source)) && hlN.has(endId(l.target));
  }, [hlN, hlL, selL]);
  const linkHot = useCallback((l: GLink) => hoverLink === l.id || !!hoverNb?.has(l.id), [hoverLink, hoverNb]);
  const linkFaded = useCallback((l: GLink) => {
    const a = byId.get(endId(l.source)), b = byId.get(endId(l.target));
    return (!!a && !!nodeFaded?.(a)) || (!!b && !!nodeFaded?.(b));
  }, [byId, nodeFaded]);

  const linkColor = useCallback((link: object) => {
    const l = link as GLink;
    if (selL === l.id) return MAIN;
    const a = endId(l.source), b = endId(l.target);
    if (ring?.has(a) && ring?.has(b)) return NOMATCH;
    if (linkHl(l) || linkHot(l)) return relColor(l.rel);
    if (linkFaded(l)) return LINK_DIM;
    if (dimOthers && anyHl) return LINK_DIM;
    if (variant === "case" && dimOthers && !anyHl) {
      const fa = focusIds ? focusIds.has(a) : byId.get(a)?.focus, fb = focusIds ? focusIds.has(b) : byId.get(b)?.focus;
      if (!(fa && fb)) return LINK_DIM;
    }
    return LINK;
  }, [selL, ring, linkHl, linkHot, linkFaded, dimOthers, anyHl, variant, focusIds, byId]);
  const linkWidth = useCallback((link: object) => {
    const l = link as GLink;
    if (selL === l.id) return 2.2;
    if (linkHot(l)) return 1.6;
    if (linkHl(l)) return 1.4;
    const a = endId(l.source), b = endId(l.target);
    if (ring?.has(a) && ring?.has(b)) return 1.4;
    return variant === "grand" ? 0.6 : 0.9;
  }, [selL, linkHl, linkHot, ring, variant]);
  const arrowLen = useCallback((link: object) => {
    const l = link as GLink;
    if (!DIRECTIONAL.has(l.rel)) return 0;
    const k = zoomK.current;
    const strong = selL === l.id || linkHl(l) || linkHot(l);
    if (!strong && k < (variant === "grand" ? 3 : 1.6)) return 0;
    return (strong ? 7 : 5) / k;
  }, [selL, linkHl, linkHot, variant]);
  const curvature = useCallback((link: object) => (link as GLink).curv ?? 0, []);

  // ---- hover tooltip (textContent only)
  const showTip = useCallback((title: string | null, sub?: string) => {
    const t = tip.current;
    if (!t) return;
    if (!title) { t.style.display = "none"; return; }
    t.replaceChildren();
    const b = document.createElement("div");
    b.className = "text-[12.5px] font-medium text-fg";
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
  const onNodeHover = useCallback((node: object | null) => {
    const n = node as GNode | null;
    setHoverNode(n?.id ?? null);
    if (!n) { showTip(null); return; }
    const bits = [KIND_LABEL[n.kind] ?? n.kind, n.bank ? BANK_NAME[n.bank] ?? n.bank : null, n.scenarios?.length ? `case ${n.scenarios.map((s) => s.slice(1)).join(", ")}` : null];
    showTip(n.label, bits.filter(Boolean).join(" · "));
  }, [showTip]);
  const hoverNodeRef = useRef(hoverNode);
  hoverNodeRef.current = hoverNode;
  const onLinkHover = useCallback((link: object | null) => {
    const l = link as GLink | null;
    setHoverLink(l?.id ?? null);
    if (!l) { if (!hoverNodeRef.current) showTip(null); return; }
    const a = byId.get(endId(l.source)), b = byId.get(endId(l.target));
    const extra = l.count && l.count > 1 ? ` · ${l.count} transfers` : l.score != null ? ` · score ${l.score.toFixed(2)}` : "";
    showTip(relLabel(l.rel) + extra, `${a?.label ?? endId(l.source)} → ${b?.label ?? endId(l.target)}`);
  }, [byId, showTip]);

  const nodeClick = useCallback((node: object) => props.onNodeClick?.(node as GNode), [props.onNodeClick]);
  const linkClick = useCallback((link: object) => props.onLinkClick?.(link as GLink), [props.onLinkClick]);
  const bgClick = useCallback(() => props.onBackgroundClick?.(), [props.onBackgroundClick]);
  // drop = pin where placed; right-click = release
  const onDragEnd = useCallback((node: object) => { const n = node as GNode; n.fx = n.x; n.fy = n.y; }, []);
  const onRightClick = useCallback((node: object) => {
    const n = node as GNode;
    n.fx = undefined; n.fy = undefined;
    fg.current?.d3ReheatSimulation();
  }, []);
  const onZoom = useCallback((t: { k: number }) => { zoomK.current = t.k; }, []);

  const zoomBy = (f: number) => { const g = fg.current; if (g) g.zoom(g.zoom() * f, reduced ? 0 : 250); };
  const btn = "grid h-8 w-8 place-items-center rounded-[4px] text-fg-2 hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-main";

  return (
    <div ref={box} className="relative h-full w-full overflow-hidden bg-bg" onPointerLeave={() => showTip(null)}>
      {size.w > 0 && size.h > 0 && (
        <ForceGraph2D
          ref={fg as any}
          graphData={data as any}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          nodeId="id"
          nodeLabel={NO_LABEL}
          linkLabel={NO_LABEL}
          nodeCanvasObject={nodeCanvasObject}
          nodeCanvasObjectMode={() => "replace"}
          nodePointerAreaPaint={nodePointerAreaPaint}
          nodeVisibility={nodeShown}
          linkVisibility={linkShown}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkCurvature={curvature}
          linkDirectionalArrowLength={arrowLen}
          linkDirectionalArrowRelPos={0.88}
          linkDirectionalArrowColor={linkColor}
          linkHoverPrecision={variant === "grand" ? 3 : 5}
          autoPauseRedraw={!animating}
          minZoom={0.04}
          maxZoom={14}
          warmupTicks={variant === "grand" ? 60 : 20}
          cooldownTicks={variant === "grand" ? 160 : 200}
          cooldownTime={variant === "grand" ? 5000 : 6000}
          d3AlphaDecay={0.035}
          d3VelocityDecay={0.38}
          enableNodeDrag
          onNodeDragEnd={onDragEnd}
          onNodeRightClick={onRightClick}
          onEngineStop={onEngineStop}
          onNodeHover={onNodeHover}
          onLinkHover={onLinkHover}
          onNodeClick={nodeClick}
          onLinkClick={linkClick}
          onBackgroundClick={bgClick}
          onZoom={onZoom}
        />
      )}
      <div
        className="absolute bottom-3 z-10 flex flex-col items-center gap-0.5 bg-bg/90"
        style={{ right: 12 + (props.rightInset ?? 0) }}
      >
        {props.controls}
        <button className={btn} onClick={() => zoomBy(1.5)} aria-label="Zoom in" title="Zoom in"><Plus size={15} /></button>
        <button className={btn} onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out" title="Zoom out"><Minus size={15} /></button>
        <button className={btn} onClick={() => doFit(500)} aria-label="Zoom to fit" title="Zoom to fit"><Maximize size={14} /></button>
      </div>
      <div
        ref={tip}
        className="pointer-events-none absolute left-0 top-0 z-20 max-w-[260px] rounded-[4px] border border-rule bg-bg px-2.5 py-1.5"
        style={{ display: "none" }}
        role="tooltip"
      />
    </div>
  );
}
