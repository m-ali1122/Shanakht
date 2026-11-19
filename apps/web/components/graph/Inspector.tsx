"use client";
import { useMemo } from "react";
import { ArrowRight, Crosshair, GitFork, Loader2, Route, ShieldAlert, ShieldCheck } from "lucide-react";
import { useGraphStore, type Scope } from "@/lib/graphStore";
import { endId, neighbours, type GData, type GLink } from "@/lib/graphAdapt";
import { BANK, BANK_NAME, KIND_LABEL, NO_BANK, relColor, relLabel, type Kind } from "@/lib/palette";
import { KindGlyph } from "./Legend";

const isId = (s: string) => /^(PK\d\d|RM-|R-|P-|ph:|dv:|fp:|D-|T\d)/.test(s) || /^[0-9a-f]{16,}$/i.test(s);
const shortId = (s: string) => (s.length > 28 ? s.slice(0, 14) + "…" + s.slice(-6) : s);

function KV({ k, v }: { k: string; v: unknown }) {
  const s = v == null ? "-" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-rule py-2 text-[13px] last:border-b-0">
      <dt className="text-muted">{k.replace(/_/g, " ")}</dt>
      <dd className={`min-w-0 break-words text-fg ${isId(s) ? "font-mono text-[12px]" : ""}`} title={s}>{isId(s) ? shortId(s) : s}</dd>
    </div>
  );
}

function BankTag({ bank }: { bank?: string | null }) {
  if (!bank) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-2">
      <span className="h-2 w-2 rounded-full" style={{ background: BANK[bank] ?? NO_BANK }} />
      {BANK_NAME[bank] ?? bank}
    </span>
  );
}

function Btn({ onClick, icon, children, active, disabled, title }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode; active?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`flex h-8 items-center gap-1.5 rounded-[4px] border px-2.5 text-[13px] font-medium transition-colors disabled:opacity-50 ${
        active ? "border-main bg-main text-white" : "border-rule bg-bg text-fg hover:border-main/50 hover:text-main-ink"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => <h3 className="mb-1 text-[12px] font-medium text-muted">{children}</h3>;

/** Drawer title for the current selection. */
export function inspectorTitle(data: GData): string {
  const { selection: sel, inspector: ins } = useGraphStore.getState();
  if (!sel) return "";
  if (sel.type === "link") return "Why this link exists";
  const kind = (ins.node?.kind ?? data.nodes.find((n) => n.id === sel.id)?.kind) as Kind | undefined;
  return (kind && KIND_LABEL[kind]) || "Entity";
}

/** Inspector body (sits inside a Drawer): entity details or the provenance of a link. */
export default function Inspector({ data, scope }: { data: GData; scope: Scope }) {
  const sel = useGraphStore((s) => s.selection);
  const ins = useGraphStore((s) => s.inspector);
  const select = useGraphStore((s) => s.select);
  const focusOn = useGraphStore((s) => s.focusOn);
  const expand = useGraphStore((s) => s.expand);
  const startPath = useGraphStore((s) => s.startPath);
  const pathFrom = useGraphStore((s) => s.pathFrom);
  const busy = useGraphStore((s) => s.busy);

  if (!sel) return null;
  const pickNode = (id: string) => { select({ type: "node", id }, data, scope); focusOn(id); };
  const pickLink = (l: GLink) => select({ type: "link", id: l.id, rel: l.rel, source: endId(l.source), target: endId(l.target) }, data, scope);

  return (
    <div className="space-y-6" aria-busy={ins.loading}>
      {sel.type === "node" ? (
        <>
          <NodeBody id={sel.id} data={data} pickLink={pickLink} actions={
            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={() => expand(sel.id, scope)} icon={<GitFork size={13} />} disabled={busy} title="Load and light up this entity's neighbours">Expand neighbours</Btn>
              <Btn onClick={() => focusOn(sel.id)} icon={<Crosshair size={13} />} title="Centre the map on it">Focus</Btn>
              <Btn onClick={() => startPath(pathFrom === sel.id ? null : sel.id)} icon={<Route size={13} />} active={pathFrom === sel.id} title="Shortest path to another entity">Path to…</Btn>
            </div>
          } />
          {pathFrom === sel.id && (
            <p className="-mt-3 flex items-center gap-2 text-[13px] text-fg">
              <Route size={13} className="text-main-ink" /> Click a second entity on the graph.
              <button type="button" className="ml-auto text-[12.5px] text-main-ink hover:underline" onClick={() => startPath(null)}>Cancel</button>
            </p>
          )}
        </>
      ) : <EdgeBody data={data} pickNode={pickNode} />}
      {ins.loading && <p className="flex items-center gap-2 text-[12.5px] text-muted"><Loader2 size={12} className="animate-spin" /> Loading the full record</p>}
      {ins.error && <p className="text-[13px] text-muted">{ins.error}</p>}
    </div>
  );
}

function NodeBody({ id, data, pickLink, actions }: { id: string; data: GData; pickLink: (l: GLink) => void; actions?: React.ReactNode }) {
  const ins = useGraphStore((s) => s.inspector);
  const n = ins.node;
  const local = data.nodes.find((x) => x.id === id);
  const nb = useMemo(() => neighbours(data, id), [data, id]);
  const label = n?.label ?? local?.label ?? id;
  const kind = (n?.kind ?? local?.kind ?? "record") as Kind;
  const degree = n?.degree ?? {};
  const maxDeg = Math.max(1, ...Object.values(degree));
  const integ = n?.integrity;
  const tampered = integ?.tampered || local?.tampered;
  const cases = n?.scenarios ?? local?.scenarios ?? [];

  return (
    <>
      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-[18px] font-semibold leading-snug text-fg">
            <KindGlyph kind={kind} size={12} /> <span className="min-w-0 break-words">{label}</span>
          </h2>
          <div className="mt-1 font-mono text-[12px] text-muted" title={id}>{shortId(id)}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <BankTag bank={n?.bank ?? local?.bank} />
            {cases.length > 0 && <span className="text-[12.5px] text-fg-2">In case {cases.map((s) => s.replace(/^S/, "")).join(", ")}</span>}
          </div>
        </div>
        {actions}
      </section>

      {integ && (
        <p className={`flex items-start gap-2 text-[13px] leading-snug ${tampered ? "text-nomatch-ink" : "text-fg-2"}`}>
          {tampered ? <ShieldAlert size={14} className="mt-[2px] shrink-0" /> : <ShieldCheck size={14} className="mt-[2px] shrink-0 text-match-ink" />}
          <span>
            {tampered ? "Changed after the last committed graph root." : integ.committed ? "Committed in the signed graph root." : "Not in a committed graph root yet."}
            {integ.eid && <span className="block font-mono text-[11.5px] text-muted">{integ.eid}</span>}
          </span>
        </p>
      )}

      {n && Object.keys(n.props ?? {}).length > 0 && (
        <section>
          <Label>Properties</Label>
          <dl>{Object.entries(n.props).map(([k, v]) => <KV key={k} k={k} v={v} />)}</dl>
        </section>
      )}

      {Object.keys(degree).length > 0 && (
        <section>
          <Label>Links by relationship</Label>
          <ul>
            {Object.entries(degree).sort((a, b) => b[1] - a[1]).map(([rel, c]) => (
              <li key={rel} className="grid grid-cols-[128px_1fr_36px] items-center gap-3 py-1 text-[13px]">
                <span className="truncate text-fg-2">{relLabel(rel)}</span>
                <span className="h-[3px] bg-surface-2">
                  <span className="block h-[3px]" style={{ width: `${(c / maxDeg) * 100}%`, background: relColor(rel) }} />
                </span>
                <span className="text-right font-mono text-[12px] tabular-nums text-muted">{c}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {nb.length > 0 && (
        <section>
          <Label>Connections on the map · choose one to see why it exists</Label>
          <ul className="-mx-2">
            {nb.slice(0, 40).map(({ link, other, dir }) => (
              <li key={link.id}>
                <button type="button" onClick={() => pickLink(link)} className="group flex h-8 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[13px] hover:bg-surface-2">
                  <span className="h-[2px] w-3 shrink-0" style={{ background: relColor(link.rel) }} />
                  <span className="w-[112px] shrink-0 truncate text-[12.5px] text-muted">{dir === "in" ? "← " : ""}{relLabel(link.rel)}{dir === "out" ? " →" : ""}</span>
                  <KindGlyph kind={other.kind} size={10} />
                  <span className="min-w-0 flex-1 truncate text-fg-2 group-hover:text-fg">{other.label}</span>
                  {link.count && link.count > 1 ? <span className="font-mono text-[11.5px] text-muted">×{link.count}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          {nb.length > 40 && <p className="mt-1 text-[12.5px] text-muted">and {nb.length - 40} more</p>}
        </section>
      )}
    </>
  );
}

function EdgeBody({ data, pickNode }: { data: GData; pickNode: (id: string) => void }) {
  const sel = useGraphStore((s) => s.selection);
  const e = useGraphStore((s) => s.inspector.edge);
  if (!sel || sel.type !== "link") return null;
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const a = byId.get(sel.source), b = byId.get(sel.target);
  const end = (id: string, n?: typeof a) => (
    <button type="button" onClick={() => pickNode(id)} className="flex min-w-0 items-center gap-1.5 rounded-[4px] px-1 py-0.5 text-left text-[13.5px] text-fg hover:bg-surface-2 hover:text-main-ink" title={id}>
      <KindGlyph kind={n?.kind ?? "record"} size={10} />
      <span className="min-w-0 truncate">{n?.label ?? shortId(id)}</span>
    </button>
  );
  return (
    <>
      <section>
        <div className="flex items-center gap-2">
          <span className="h-[2px] w-4" style={{ background: relColor(sel.rel) }} />
          <span className="font-mono text-[11.5px] text-muted">{sel.rel}</span>
        </div>
        <h2 className="mt-1.5 text-[18px] font-semibold leading-snug text-fg">{e?.title ?? relLabel(sel.rel)}</h2>
        <div className="-mx-1 mt-1.5 flex flex-wrap items-center gap-1">
          {end(sel.source, a)}
          <ArrowRight size={13} className="shrink-0 text-muted" />
          {end(sel.target, b)}
        </div>
      </section>

      {e && (
        <>
          <section className="border-t border-rule pt-4">
            <p className="text-[14.5px] leading-[1.6] text-fg">{e.cause}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
              <span className="text-muted">Origin <span className="text-fg-2">{e.origin}</span></span>
              <span className={`flex items-center gap-1 ${e.committed ? "text-match-ink" : "text-muted"}`}>
                {e.committed ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                {e.committed ? "In the committed Merkle root" : "Not committed"}
              </span>
            </div>
          </section>

          {e.score != null && (
            <section>
              <div className="flex items-baseline justify-between">
                <Label>Resolver score</Label>
                <span className="font-mono text-[13px] tabular-nums text-fg">{e.score.toFixed(2)}</span>
              </div>
              <div className="h-[3px] bg-surface-2">
                <div className="h-[3px]" style={{ width: `${Math.max(0, Math.min(1, e.score)) * 100}%`, background: e.score >= 0.85 ? "var(--match)" : e.score >= 0.6 ? "var(--close)" : "var(--nomatch)" }} />
              </div>
            </section>
          )}

          {e.reasons && e.reasons.length > 0 && (
            <section>
              <Label>Resolver reasons</Label>
              <ul>
                {e.reasons.map((r, i) => (
                  <li key={i} className="flex gap-3 border-b border-rule py-2 text-[13px] leading-snug text-fg-2 last:border-b-0">
                    <span className="w-[96px] shrink-0 font-mono text-[11.5px] text-muted">{r.code}</span>
                    <span>{r.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {e.evidence?.length > 0 && (
            <section>
              <Label>Evidence</Label>
              <dl>{e.evidence.map((x, i) => <KV key={i} k={x.k} v={x.v} />)}</dl>
            </section>
          )}

          {e.transfers && e.transfers.length > 0 && (
            <section>
              <Label>Transfers ({e.transfers.length})</Label>
              <table className="w-full text-[12.5px]">
                <tbody>
                  {e.transfers.map((t) => (
                    <tr key={t.tid} className="border-b border-rule last:border-0">
                      <td className="py-1.5 pr-2 font-mono text-[11.5px] text-muted">{(t.date ?? "").slice(0, 10)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-fg">{t.amount_pkr != null ? `Rs ${t.amount_pkr.toLocaleString()}` : "-"}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-fg-2">{t.amount_fx != null ? `${t.amount_fx.toLocaleString()} ${t.currency ?? ""}` : ""}</td>
                      <td className="py-1.5 text-right text-muted">{t.house ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {e.fallback && <p className="text-[12.5px] leading-snug text-muted">Explained from the graph on screen; the full record loads once the explore service answers.</p>}
        </>
      )}
    </>
  );
}
