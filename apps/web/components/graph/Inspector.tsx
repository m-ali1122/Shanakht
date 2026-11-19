"use client";
import { useMemo } from "react";
import { ArrowRight, Crosshair, GitFork, Link2, Loader2, Route, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useGraphStore, type Scope } from "@/lib/graphStore";
import { endId, neighbours, type GData, type GLink } from "@/lib/graphAdapt";
import { BANK, BANK_NAME, KIND_LABEL, relColor, relLabel, type Kind } from "@/lib/palette";
import { KindGlyph } from "./Legend";

const isId = (s: string) => /^(PK\d\d|RM-|R-|P-|ph:|dv:|fp:|D-|T\d)/.test(s) || /^[0-9a-f]{16,}$/i.test(s);
const shortId = (s: string) => (s.length > 28 ? s.slice(0, 14) + "…" + s.slice(-6) : s);

function KV({ k, v }: { k: string; v: unknown }) {
  const s = v == null ? "-" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return (
    <div className="grid grid-cols-[112px_1fr] gap-2 py-[3px] text-[13px]">
      <dt className="text-muted">{k.replace(/_/g, " ")}</dt>
      <dd className={`min-w-0 break-words text-fg ${isId(s) ? "font-mono text-[12px]" : ""}`} title={s}>{isId(s) ? shortId(s) : s}</dd>
    </div>
  );
}

function BankChip({ bank }: { bank?: string | null }) {
  if (!bank) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-rule px-2 py-0.5 text-[12px] text-fg-2">
      <span className="h-2 w-2 rounded-full" style={{ background: BANK[bank] ?? "#5C627C" }} />
      {BANK_NAME[bank] ?? bank}
    </span>
  );
}

function Btn({ onClick, icon, children, active, disabled }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode; active?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border text-[12.5px] font-medium transition-colors disabled:opacity-50 ${
        active ? "border-accent/60 bg-accent text-accent-ink" : "border-rule bg-surface-2 text-fg hover:border-main/60"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

export default function Inspector({ data, scope, onClose }: { data: GData; scope: Scope; onClose?: () => void }) {
  const sel = useGraphStore((s) => s.selection);
  const ins = useGraphStore((s) => s.inspector);
  const select = useGraphStore((s) => s.select);
  const clear = useGraphStore((s) => s.clearSelection);
  const focusOn = useGraphStore((s) => s.focusOn);
  const expand = useGraphStore((s) => s.expand);
  const startPath = useGraphStore((s) => s.startPath);
  const pathFrom = useGraphStore((s) => s.pathFrom);
  const busy = useGraphStore((s) => s.busy);
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);

  if (!sel) return null;
  const close = () => { clear(); onClose?.(); };
  const pickNode = (id: string) => { select({ type: "node", id }, data, scope); focusOn(id); };
  const pickLink = (l: GLink) => select({ type: "link", id: l.id, rel: l.rel, source: endId(l.source), target: endId(l.target) }, data, scope);

  return (
    <aside className="slide-in flex h-full w-[372px] flex-col border-l border-rule bg-surface/95 backdrop-blur-md" aria-label="Inspector">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-rule pl-4 pr-2">
        {sel.type === "node" ? (
          <>
            <KindGlyph kind={(ins.node?.kind ?? byId.get(sel.id)?.kind ?? "record") as Kind} size={12} />
            <span className="text-[13px] font-semibold text-fg">{KIND_LABEL[(ins.node?.kind ?? byId.get(sel.id)?.kind) as Kind] ?? "Entity"}</span>
          </>
        ) : (
          <>
            <Link2 size={14} className="text-fg-2" />
            <span className="text-[13px] font-semibold text-fg">Why this link exists</span>
          </>
        )}
        {ins.loading && <Loader2 size={13} className="animate-spin text-muted" />}
        <button onClick={close} className="ml-auto rounded-[var(--radius-sm)] p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close inspector">
          <X size={15} />
        </button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {sel.type === "node" ? <NodeBody id={sel.id} data={data} pickLink={pickLink} /> : <EdgeBody data={data} pickNode={pickNode} />}
        {ins.error && <p className="mt-3 text-[13px] text-muted">{ins.error}</p>}
      </div>

      {sel.type === "node" && (
        <div className="shrink-0 space-y-2 border-t border-rule px-4 py-3">
          {pathFrom === sel.id ? (
            <div className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-accent/12 px-2.5 py-1.5 text-[12.5px] text-fg">
              <Route size={13} className="text-accent" /> Click a second entity on the graph
              <button className="ml-auto text-[12px] text-muted hover:text-fg" onClick={() => startPath(null)}>Cancel</button>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Btn onClick={() => expand(sel.id, scope)} icon={<GitFork size={13} />} disabled={busy}>Expand</Btn>
            <Btn onClick={() => focusOn(sel.id)} icon={<Crosshair size={13} />}>Focus</Btn>
            <Btn onClick={() => startPath(pathFrom === sel.id ? null : sel.id)} icon={<Route size={13} />} active={pathFrom === sel.id}>Path to…</Btn>
          </div>
        </div>
      )}
    </aside>
  );
}

function NodeBody({ id, data, pickLink }: { id: string; data: GData; pickLink: (l: GLink) => void }) {
  const ins = useGraphStore((s) => s.inspector);
  const n = ins.node;
  const local = data.nodes.find((x) => x.id === id);
  const nb = useMemo(() => neighbours(data, id), [data, id]);
  const label = n?.label ?? local?.label ?? id;
  const degree = n?.degree ?? {};
  const maxDeg = Math.max(1, ...Object.values(degree));
  const integ = n?.integrity;
  const tampered = integ?.tampered || local?.tampered;

  return (
    <div className="space-y-5">
      <section>
        <h2 className="text-[17px] font-semibold leading-snug text-fg">{label}</h2>
        <div className="mt-1 font-mono text-[12px] text-muted" title={id}>{shortId(id)}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <BankChip bank={n?.bank ?? local?.bank} />
          {(n?.scenarios ?? local?.scenarios ?? []).map((s) => (
            <span key={s} className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] text-fg-2">Case {s.replace(/^S/, "")}</span>
          ))}
        </div>
      </section>

      {n && Object.keys(n.props ?? {}).length > 0 && (
        <section>
          <dl>{Object.entries(n.props).map(([k, v]) => <KV key={k} k={k} v={v} />)}</dl>
        </section>
      )}

      {integ && (
        <section className={`flex items-start gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-[13px] ${tampered ? "border-nomatch/50 text-nomatch-ink" : "border-rule text-fg-2"}`}>
          {tampered ? <ShieldAlert size={15} className="mt-[1px] shrink-0" /> : <ShieldCheck size={15} className="mt-[1px] shrink-0 text-match-ink" />}
          <span>
            {tampered ? "Changed after the last committed graph root." : integ.committed ? "Committed in the signed graph root." : "Not in a committed graph root yet."}
            {integ.eid && <span className="block font-mono text-[11.5px] text-muted">{integ.eid}</span>}
          </span>
        </section>
      )}

      {Object.keys(degree).length > 0 && (
        <section>
          <div className="label mb-1.5">Links by relationship</div>
          <ul className="space-y-1">
            {Object.entries(degree).sort((a, b) => b[1] - a[1]).map(([rel, c]) => (
              <li key={rel} className="grid grid-cols-[120px_1fr_36px] items-center gap-2 text-[12.5px]">
                <span className="truncate text-fg-2">{relLabel(rel)}</span>
                <span className="h-1.5 rounded-full bg-surface-2">
                  <span className="block h-1.5 rounded-full" style={{ width: `${(c / maxDeg) * 100}%`, background: relColor(rel) }} />
                </span>
                <span className="text-right font-mono tabular-nums text-muted">{c}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {nb.length > 0 && (
        <section>
          <div className="label mb-1">Connections on screen · click for why</div>
          <ul>
            {nb.slice(0, 40).map(({ link, other, dir }) => (
              <li key={link.id}>
                <button onClick={() => pickLink(link)} className="group flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-left text-[13px] hover:bg-surface-2">
                  <span className="h-[3px] w-3 shrink-0 rounded" style={{ background: relColor(link.rel) }} />
                  <span className="w-[104px] shrink-0 truncate text-[12px] text-muted">{dir === "in" ? "← " : ""}{relLabel(link.rel)}{dir === "out" ? " →" : ""}</span>
                  <KindGlyph kind={other.kind} size={10} />
                  <span className="min-w-0 flex-1 truncate text-fg-2 group-hover:text-fg">{other.label}</span>
                  {link.count && link.count > 1 ? <span className="font-mono text-[11px] text-muted">×{link.count}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          {nb.length > 40 && <p className="mt-1 px-1.5 text-[12px] text-muted">and {nb.length - 40} more</p>}
        </section>
      )}
    </div>
  );
}

function EdgeBody({ data, pickNode }: { data: GData; pickNode: (id: string) => void }) {
  const sel = useGraphStore((s) => s.selection);
  const e = useGraphStore((s) => s.inspector.edge);
  if (!sel || sel.type !== "link") return null;
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const a = byId.get(sel.source), b = byId.get(sel.target);
  const end = (id: string, n?: typeof a) => (
    <button onClick={() => pickNode(id)} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius-sm)] border border-rule bg-surface-2 px-2 py-1.5 text-left hover:border-main/60">
      <KindGlyph kind={n?.kind ?? "record"} size={10} />
      <span className="min-w-0 truncate text-[12.5px] text-fg">{n?.label ?? shortId(id)}</span>
    </button>
  );
  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center gap-2">
          <span className="h-[3px] w-4 rounded" style={{ background: relColor(sel.rel) }} />
          <span className="font-mono text-[11.5px] text-muted">{sel.rel}</span>
        </div>
        <h2 className="mt-1.5 text-[17px] font-semibold leading-snug text-fg">{e?.title ?? relLabel(sel.rel)}</h2>
        <div className="mt-2 flex items-center gap-1.5">
          {end(sel.source, a)}
          <ArrowRight size={13} className="shrink-0 text-muted" />
          {end(sel.target, b)}
        </div>
      </section>

      {e && (
        <>
          <section>
            <p className="text-[14px] leading-[1.55] text-fg">{e.cause}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="text-muted">Origin</span>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-fg-2">{e.origin}</span>
              <span className={`ml-auto flex items-center gap-1 ${e.committed ? "text-match-ink" : "text-muted"}`}>
                {e.committed ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                {e.committed ? "In the committed Merkle root" : "Not committed"}
              </span>
            </div>
          </section>

          {e.score != null && (
            <section>
              <div className="flex items-baseline justify-between">
                <span className="label">Resolver score</span>
                <span className="font-mono text-[13px] tabular-nums text-fg">{e.score.toFixed(2)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                <div className="h-1.5 rounded-full" style={{ width: `${Math.max(0, Math.min(1, e.score)) * 100}%`, background: e.score >= 0.85 ? "var(--match)" : e.score >= 0.6 ? "var(--close)" : "var(--nomatch)" }} />
              </div>
            </section>
          )}

          {e.reasons && e.reasons.length > 0 && (
            <section>
              <div className="label mb-1">Resolver reasons</div>
              <ul className="space-y-1">
                {e.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-snug text-fg-2">
                    <span className="shrink-0 rounded bg-surface-2 px-1.5 font-mono text-[11px] leading-[18px] text-muted">{r.code}</span>
                    <span>{r.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {e.evidence?.length > 0 && (
            <section>
              <div className="label mb-1">Evidence</div>
              <dl>{e.evidence.map((x, i) => <KV key={i} k={x.k} v={x.v} />)}</dl>
            </section>
          )}

          {e.transfers && e.transfers.length > 0 && (
            <section>
              <div className="label mb-1">Transfers ({e.transfers.length})</div>
              <table className="w-full text-[12.5px]">
                <tbody>
                  {e.transfers.map((t) => (
                    <tr key={t.tid} className="border-b border-rule/60 last:border-0">
                      <td className="py-1 pr-2 font-mono text-[11.5px] text-muted">{(t.date ?? "").slice(0, 10)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-fg">{t.amount_pkr != null ? `Rs ${t.amount_pkr.toLocaleString()}` : "-"}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-fg-2">{t.amount_fx != null ? `${t.amount_fx.toLocaleString()} ${t.currency ?? ""}` : ""}</td>
                      <td className="py-1 text-right text-muted">{t.house ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {e.fallback && <p className="text-[12px] leading-snug text-muted">Explained from the graph on screen; the full record loads once the explore service answers.</p>}
        </>
      )}
    </div>
  );
}
