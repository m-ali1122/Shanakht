// Graph data adapters: Cytoscape elements and new explore-API payloads -> GData,
// plus client-side fallbacks (provenance templates, patterns, search, path) used
// until the /graph/* explore endpoints are live.
import type { GraphElements } from "./types";
import { BANK_NAME, KINDS, type Kind, relLabel } from "./palette";

export type GNode = {
  id: string;
  label: string;
  kind: Kind;
  bank?: string | null;
  hollow?: boolean;
  tampered?: boolean;
  focus?: boolean;
  scenarios?: string[];
  degree?: number;
  fpKind?: string;
  // force-graph runtime fields
  x?: number;
  y?: number;
  z?: number;
  [k: string]: any;
};
export type GLink = {
  id: string;
  source: string | GNode;
  target: string | GNode;
  rel: string;
  label?: string | null;
  score?: number;
  count?: number;
  curv?: number;
  [k: string]: any;
};
export type GData = { nodes: GNode[]; links: GLink[] };

export const endId = (x: string | GNode | undefined | null): string => (x && typeof x === "object" ? x.id : (x as string) ?? "");
export const linkKey = (rel: string, a: string, b: string) => `${rel}:${a}>${b}`;

const REL_ALIAS: Record<string, string> = { FP: "HAS_FP" };
const normRel = (r?: string | null) => {
  const u = String(r ?? "LINK").toUpperCase();
  return REL_ALIAS[u] ?? u;
};
const normKind = (k?: string | null): Kind | null => {
  const s = String(k ?? "").toLowerCase();
  return (KINDS as string[]).includes(s) ? (s as Kind) : null;
};

/** Finalise: dedupe, drop dangling links, compute degree (if absent) and curvature for parallel links. */
export function finalise(nodes: GNode[], links: GLink[]): GData {
  const byId = new Map<string, GNode>();
  for (const n of nodes) {
    const prev = byId.get(n.id);
    if (prev) {
      if (n.scenarios?.length) prev.scenarios = [...new Set([...(prev.scenarios ?? []), ...n.scenarios])];
      prev.focus = prev.focus || n.focus;
      prev.tampered = prev.tampered || n.tampered;
    } else byId.set(n.id, n);
  }
  const seen = new Set<string>();
  const out: GLink[] = [];
  const deg = new Map<string, number>();
  for (const l of links) {
    const a = endId(l.source), b = endId(l.target);
    if (!byId.has(a) || !byId.has(b) || seen.has(l.id)) continue;
    seen.add(l.id);
    out.push(l);
    deg.set(a, (deg.get(a) ?? 0) + 1);
    deg.set(b, (deg.get(b) ?? 0) + 1);
  }
  const ns = [...byId.values()];
  for (const n of ns) n.degree = Math.max(n.degree ?? 0, deg.get(n.id) ?? 0);
  assignCurvature(out);
  return { nodes: ns, links: out };
}

export function assignCurvature(links: GLink[]) {
  const pair = new Map<string, number>();
  for (const l of links) {
    const a = endId(l.source), b = endId(l.target);
    const k = a < b ? a + "|" + b : b + "|" + a;
    const i = pair.get(k) ?? 0;
    pair.set(k, i + 1);
    l.curv = i ? 0.22 * Math.ceil(i / 2) * (i % 2 ? 1 : -1) : 0;
  }
}

/** Existing /graph/scenario and /graph/neighborhood: Cytoscape {nodes:[{data}], edges:[{data}]}. */
export function adaptCy(g: GraphElements | null | undefined, scenario?: string): GData {
  if (!g) return { nodes: [], links: [] };
  const nodes: GNode[] = [];
  for (const { data: d } of g.nodes ?? []) {
    const kind = normKind(d.kind);
    if (!kind) continue;
    const dd = d as any;
    nodes.push({
      id: d.id, label: String(d.label ?? d.id), kind, bank: d.bank ?? null, hollow: !!d.hollow,
      tampered: !!dd.tampered, focus: !!dd.focus, fpKind: d.fpKind, eid: dd.eid,
      scenarios: scenario ? [scenario] : dd.scenarios ?? [],
    });
  }
  const links: GLink[] = [];
  for (const { data: d } of g.edges ?? []) {
    const rel = normRel(d.rel);
    const cnt = d.label != null && /^\d+$/.test(String(d.label).trim()) ? Number(d.label) : undefined;
    links.push({ id: linkKey(rel, d.source, d.target), source: d.source, target: d.target, rel, label: d.label ?? null, count: cnt });
  }
  return finalise(nodes, links);
}

/** New API payloads: {nodes, links} already in GData shape, normalised defensively. */
export function normalise(p: any): GData {
  if (!p) return { nodes: [], links: [] };
  if (Array.isArray(p.edges) && !p.links) return adaptCy(p);
  const nodes: GNode[] = [];
  for (const n of p.nodes ?? []) {
    const kind = normKind(n.kind);
    if (!kind || n.id == null) continue;
    nodes.push({ ...n, id: String(n.id), label: String(n.label ?? n.id), kind, scenarios: n.scenarios ?? [] });
  }
  const links: GLink[] = [];
  for (const l of p.links ?? []) {
    const a = endId(l.source), b = endId(l.target);
    const rel = normRel(l.rel);
    links.push({ ...l, id: String(l.id ?? linkKey(rel, a, b)), source: a, target: b, rel });
  }
  return finalise(nodes, links);
}

/** Merge `add` into `base`, keeping existing node objects (and their positions) intact. */
export function mergeData(base: GData, add: GData): GData {
  const have = new Map(base.nodes.map((n) => [n.id, n]));
  const nodes = [...base.nodes];
  const added: GNode[] = [];
  let changed = false;
  for (const n of add.nodes) {
    const prev = have.get(n.id);
    if (prev) {
      if (n.scenarios?.length) prev.scenarios = [...new Set([...(prev.scenarios ?? []), ...n.scenarios])];
      continue;
    }
    const copy = { ...n };
    nodes.push(copy);
    added.push(copy);
    have.set(n.id, copy);
    changed = true;
  }
  const lids = new Set(base.links.map((l) => l.id));
  const links = [...base.links];
  for (const l of add.links) {
    if (lids.has(l.id)) continue;
    const a = endId(l.source), b = endId(l.target);
    if (!have.has(a) || !have.has(b)) continue;
    links.push({ ...l, source: a, target: b });
    lids.add(l.id);
    changed = true;
  }
  if (!changed) return base;
  // seed new nodes next to a neighbour already on screen, so they grow out of it
  for (const src of added) {
    const nb = links.find((l) => endId(l.source) === src.id || endId(l.target) === src.id);
    const other = nb ? have.get(endId(nb.source) === src.id ? endId(nb.target) : endId(nb.source)) : undefined;
    if (other && other.x !== undefined) {
      src.x = other.x + (Math.random() - 0.5) * 20;
      src.y = (other.y ?? 0) + (Math.random() - 0.5) * 20;
      src.z = (other.z ?? 0) + (Math.random() - 0.5) * 20;
    }
  }
  const deg = new Map<string, number>();
  for (const l of links) {
    const a = endId(l.source), b = endId(l.target);
    deg.set(a, (deg.get(a) ?? 0) + 1);
    deg.set(b, (deg.get(b) ?? 0) + 1);
  }
  for (const n of nodes) n.degree = Math.max(n.degree ?? 0, deg.get(n.id) ?? 0);
  assignCurvature(links);
  return { nodes, links };
}

// ---------------------------------------------------------------- client fallbacks

export type NodeDetail = {
  id: string; kind: string; label: string; bank?: string | null;
  props: Record<string, unknown>;
  degree: Record<string, number>;
  scenarios: string[];
  integrity?: { eid?: string; committed: boolean; tampered: boolean } | null;
  fallback?: boolean;
};
export type EdgeDetail = {
  rel: string; source: string; target: string; title: string; cause: string; origin: string;
  evidence: { k: string; v: string }[];
  score?: number;
  reasons?: { code: string; text: string }[];
  transfers?: { tid: string; amount_pkr?: number; amount_fx?: number; currency?: string; date?: string; house?: string }[];
  committed: boolean;
  fallback?: boolean;
};

const bankName = (b?: string | null) => (b ? BANK_NAME[b] ?? b : "the bank");
const short = (s: string, n = 12) => (s.length > n ? s.slice(0, n) + "…" : s);

export function neighbours(data: GData, id: string) {
  const out: { link: GLink; other: GNode; dir: "out" | "in" }[] = [];
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  for (const l of data.links) {
    const a = endId(l.source), b = endId(l.target);
    if (a === id && byId.has(b)) out.push({ link: l, other: byId.get(b)!, dir: "out" });
    else if (b === id && byId.has(a)) out.push({ link: l, other: byId.get(a)!, dir: "in" });
  }
  return out;
}

export function nodeFallback(data: GData, id: string): NodeDetail | null {
  const n = data.nodes.find((x) => x.id === id);
  if (!n) return null;
  const degree: Record<string, number> = {};
  for (const { link } of neighbours(data, id)) degree[link.rel] = (degree[link.rel] ?? 0) + 1;
  const props: Record<string, unknown> = {};
  const partner = !!n.bank && n.bank !== "MRGL";
  if (n.kind === "account") props.iban = partner ? `${n.bank} ··${id.slice(-4)}` : id;
  if (n.kind === "record") props.record = id;
  if (n.kind === "remitter") props.remitter = id;
  if (n.kind === "person") props.person = id;
  if (n.kind === "phone" || n.kind === "device" || n.kind === "fingerprint") props.hash = short(id.replace(/^(ph|dv|fp):/, ""), 16);
  if (n.fpKind) props.fingerprint_of = n.fpKind;
  if (partner) props.visibility = "partner bank: fingerprints only";
  return {
    id, kind: n.kind, label: n.label, bank: n.bank, props, degree, scenarios: n.scenarios ?? [],
    integrity: { eid: n.eid, committed: !!n.eid, tampered: !!n.tampered }, fallback: true,
  };
}

export function edgeFallback(data: GData, link: GLink): EdgeDetail {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const a = byId.get(endId(link.source)), b = byId.get(endId(link.target));
  const an = a?.label ?? endId(link.source), bn = b?.label ?? endId(link.target);
  const bank = a?.bank ?? b?.bank;
  const base = { rel: link.rel, source: endId(link.source), target: endId(link.target), committed: true, fallback: true };
  const sharers = (id: string) => {
    const recs = neighbours(data, id).filter((x) => x.other.kind === "record");
    return { records: recs.length, banks: new Set(recs.map((x) => x.other.bank).filter(Boolean)).size };
  };
  switch (link.rel) {
    case "HOLDS":
      return { ...base, title: "Record holds account", cause: `The KYC record at ${bankName(bank)} lists this account as held by ${an}.`, origin: `${bankName(bank)} KYC file`, evidence: [{ k: "record", v: an }, { k: "account", v: bn }, { k: "bank", v: bank ?? "-" }] };
    case "USES_PHONE":
    case "USES_DEVICE": {
      const what = link.rel === "USES_PHONE" ? "phone" : "device";
      const s = sharers(endId(link.target));
      return { ...base, title: `Shared ${what}`, cause: `The KYC record registered this ${what}. Only its keyed hash is stored.`, origin: `${bankName(a?.bank)} KYC file`, evidence: [{ k: "record", v: an }, { k: `${what} hash`, v: short(bn, 16) }, { k: "records sharing it", v: String(s.records) }, { k: "banks", v: String(s.banks) }] };
    }
    case "RESOLVES_TO":
      return { ...base, title: "Same person", cause: `The resolver matched the name on record ${an} to person ${bn}${link.score != null ? ` with score ${link.score.toFixed(2)}` : ""}.`, origin: "Identity resolver", score: link.score, evidence: [{ k: "record name", v: an }, { k: "person", v: bn }] };
    case "HAS_FP":
      return { ...base, title: "Partner fingerprint", cause: `${bankName(a?.bank)} contributed a signed HMAC fingerprint${b?.fpKind ? ` of a ${b.fpKind}` : ""} for this account. No name or number crosses banks.`, origin: `${bankName(a?.bank)}, signed`, evidence: [{ k: "account", v: an }, { k: "fingerprint", v: short(bn, 16) }, { k: "kind", v: b?.fpKind ?? "-" }] };
    case "SAME_AS":
      return { ...base, title: "Fingerprint match", cause: `A host-bank ${a?.kind === "phone" || b?.kind === "phone" ? "phone" : "device"} hash equals a partner fingerprint: the same identifier is in use across banks.`, origin: "Keyed hash comparison", evidence: [{ k: "host hash", v: short(an, 16) }, { k: "partner fingerprint", v: short(bn, 16) }] };
    case "SENT": {
      const n = link.count ?? 1;
      return { ...base, title: "Transfers", cause: `${an} sent ${n} transfer${n === 1 ? "" : "s"} to this account.`, origin: "Transfer history", evidence: [{ k: "sender", v: an }, { k: "account", v: bn }, { k: "transfers", v: String(n) }], transfers: [] };
    }
    default:
      return { ...base, title: relLabel(link.rel), cause: `${an} is linked to ${bn} (${relLabel(link.rel).toLowerCase()}).`, origin: "Identity graph", evidence: [] };
  }
}

export function searchLocal(data: GData, q: string, limit = 20) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const hits: { id: string; label: string; kind: string; bank?: string | null; match: string; rank: number }[] = [];
  for (const n of data.nodes) {
    const id = n.id.toLowerCase(), lab = n.label.toLowerCase();
    const bare = id.replace(/^(ph|dv|fp):/, "");
    let rank = -1, match = "";
    if (id === s || bare === s) { rank = 0; match = "id"; }
    else if (lab === s) { rank = 1; match = "name"; }
    else if (id.startsWith(s) || bare.startsWith(s)) { rank = 2; match = "id prefix"; }
    else if (lab.includes(s)) { rank = 3; match = "name"; }
    else if (id.includes(s)) { rank = 4; match = "id"; }
    if (rank >= 0) hits.push({ id: n.id, label: n.label, kind: n.kind, bank: n.bank, match, rank });
  }
  return hits.sort((a, b) => a.rank - b.rank).slice(0, limit);
}

export function pathLocal(data: GData, from: string, to: string, max = 6): GData | null {
  const adj = new Map<string, { other: string; link: GLink }[]>();
  for (const l of data.links) {
    const a = endId(l.source), b = endId(l.target);
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ other: b, link: l });
    (adj.get(b) ?? adj.set(b, []).get(b)!).push({ other: a, link: l });
  }
  const prev = new Map<string, { from: string; link: GLink } | null>([[from, null]]);
  let frontier = [from];
  for (let d = 0; d < max && frontier.length && !prev.has(to); d++) {
    const next: string[] = [];
    for (const u of frontier) for (const { other, link } of adj.get(u) ?? []) {
      if (prev.has(other)) continue;
      prev.set(other, { from: u, link });
      next.push(other);
    }
    frontier = next;
  }
  if (!prev.has(to)) return null;
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const nodes: GNode[] = [], links: GLink[] = [];
  for (let cur: string | undefined = to; cur; ) {
    nodes.push(byId.get(cur)!);
    const p = prev.get(cur);
    if (!p) break;
    links.push(p.link);
    cur = p.from;
  }
  return { nodes: nodes.reverse(), links: links.reverse() };
}

export const PATTERNS_LOCAL = [
  { key: "shared-phone", title: "Shared phone", description: "A phone on 3 or more KYC records across 2 or more banks." },
  { key: "shared-device", title: "Shared device", description: "A device on 3 or more KYC records across 2 or more banks." },
  { key: "fan-in", title: "Fan-in account", description: "An account receiving money from 4 or more senders." },
  { key: "cross-bank-person", title: "Cross-bank person", description: "One person with KYC records at 3 or more banks." },
  { key: "partner-hit", title: "Partner hit", description: "A host-bank phone or device that matches a partner fingerprint." },
];

/** Client-side detectors over the loaded graph (fallback until /graph/pattern is live). */
export function patternLocal(data: GData, key: string): { nodes: string[]; links: string[]; matches: string[][] } {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const matches: string[][] = [];
  const nodes = new Set<string>(), links = new Set<string>();
  const add = (ids: string[], lks: GLink[]) => { matches.push(ids); ids.forEach((i) => nodes.add(i)); lks.forEach((l) => links.add(l.id)); };
  if (key === "shared-phone" || key === "shared-device") {
    const kind = key === "shared-phone" ? "phone" : "device";
    for (const n of data.nodes) {
      if (n.kind !== kind && !(n.kind === "fingerprint" && n.fpKind === kind)) continue;
      const nb = neighbours(data, n.id).filter((x) => x.other.kind === "record" || x.other.kind === "account");
      const banks = new Set(nb.map((x) => x.other.bank).filter(Boolean));
      if (nb.length >= 3 && banks.size >= 2) add([n.id, ...nb.map((x) => x.other.id)], nb.map((x) => x.link));
    }
  } else if (key === "fan-in") {
    for (const n of data.nodes) {
      if (n.kind !== "account") continue;
      const nb = neighbours(data, n.id).filter((x) => x.link.rel === "SENT");
      if (nb.length >= 4) add([n.id, ...nb.map((x) => x.other.id)], nb.map((x) => x.link));
    }
  } else if (key === "cross-bank-person") {
    for (const n of data.nodes) {
      if (n.kind !== "person") continue;
      const nb = neighbours(data, n.id).filter((x) => x.link.rel === "RESOLVES_TO");
      if (new Set(nb.map((x) => x.other.bank).filter(Boolean)).size >= 3) add([n.id, ...nb.map((x) => x.other.id)], nb.map((x) => x.link));
    }
  } else if (key === "partner-hit") {
    for (const l of data.links) {
      if (l.rel !== "SAME_AS") continue;
      const a = endId(l.source), b = endId(l.target);
      if (byId.has(a) && byId.has(b)) add([a, b], [l]);
    }
  }
  return { nodes: [...nodes], links: [...links], matches };
}
