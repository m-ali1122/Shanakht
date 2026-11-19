"use client";
import { AlertTriangle, ArrowRight, RotateCw, ShieldCheck, Zap } from "lucide-react";
import { useStore } from "@/lib/store";
import Chain, { blockFace } from "@/components/shell/Chain";
import { BankDot } from "@/components/shell/bits";
import { Drawer } from "@/components/shell/Drawer";

function Section({ title, aside, children }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex h-8 items-center gap-3">
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        <span className="ml-auto flex items-center gap-1">{aside}</span>
      </div>
      {children}
    </section>
  );
}

function BlockDrawer() {
  const b = useStore((s) => s.explorer);
  const open = useStore((s) => s.openExplorer);
  const caseId = useStore((s) => s.caseId);
  const setView = useStore((s) => s.setView);
  const f = b ? blockFace(b) : null;
  const rows: [string, string][] = !b ? [] : [
    ["time", b.ts],
    ["tx", b.tx || "(read-only call, no transaction)"],
    [b.kind === "commit" ? "root" : b.kind === "publish" || b.kind === "registry_hit" ? "fingerprint" : "decision hash", b.hash],
    ...(b.epoch != null ? ([["epoch", String(b.epoch)]] as [string, string][]) : []),
    ...(b.band ? ([["band", b.band]] as [string, string][]) : []),
    ...(b.action ? ([["action", String(b.action).replaceAll("_", " ")]] as [string, string][]) : []),
    ...(b.approver ? ([["approver", b.approver]] as [string, string][]) : []),
    ...(b.bank ? ([["bank", b.bank]] as [string, string][]) : []),
    ...Object.entries(b.detail ?? {})
      .filter(([k]) => k !== "block")
      .map(([k, v]) => [k.replaceAll("_", " "), typeof v === "number" ? v.toLocaleString("en-US") : typeof v === "object" && v ? JSON.stringify(v) : String(v)] as [string, string]),
  ];
  const linkedCase = !!b?.detail?.case && b.detail.case === caseId;
  return (
    <Drawer
      open={!!b}
      onClose={() => open(null)}
      title={b && f ? <>Block <span className="font-mono">#{b.id}</span> <span className="ml-1 font-normal text-muted">{f.kind}</span></> : "Block"}
      width={460}
    >
      {b && f && (
        <>
          <div className="mb-4 flex items-center gap-2.5">
            <span className="h-3 w-3 shrink-0" style={{ background: f.color, borderRadius: b.kind === "commit" ? 0 : 999 }} />
            <span className={`text-[18px] font-semibold ${b.kind === "registry_hit" ? "text-nomatch-ink" : "text-fg"}`}>{f.title}</span>
            <span className="truncate text-[13px] text-fg-2">{f.sub}</span>
          </div>
          <dl className="text-[13px]">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[110px_1fr] gap-3 border-b border-rule py-2 last:border-b-0">
                <dt className="text-muted">{k}</dt>
                <dd className={`min-w-0 break-all text-fg ${/^0x|^[0-9a-f]{12,}$/.test(v) ? "font-mono text-[12px]" : ""}`}>{v}</dd>
              </div>
            ))}
          </dl>
          {linkedCase && (
            <button onClick={() => { open(null); setView("investigate"); }} className="mt-4 flex items-center gap-1.5 text-[13px] font-semibold text-main-ink hover:underline">
              Open the case behind this decision <ArrowRight size={14} />
            </button>
          )}
        </>
      )}
    </Drawer>
  );
}

type Item = { id?: string; element_id?: string; label?: string; leaf?: string; leaf_epoch?: string; leaf_current?: string; status: string };

const ctl = "flex h-8 items-center gap-1.5 rounded-[4px] px-2 text-[12px] font-medium text-fg-2 transition-colors duration-150 hover:bg-surface-2 disabled:opacity-40";

function Integrity() {
  const integ = useStore((s) => s.integrity);
  const caseId = useStore((s) => s.caseId);
  const caseOut = useStore((s) => s.caseOut);
  const caseStatus = useStore((s) => s.caseStatus);
  const busy = useStore((s) => s.busy);
  const reverify = useStore((s) => s.reverify);
  const tamper = useStore((s) => s.tamper);
  const runCase = useStore((s) => s.runCase);
  const setHighlight = useStore((s) => s.setHighlight);
  const items = ((integ?.items ?? []) as Item[]).slice().sort((a, b) => Number(a.status === "verified") - Number(b.status === "verified"));
  const broken = items.filter((i) => i.status !== "verified");
  const canAct = !!caseId && !!caseOut && !busy;

  const actions = (
    <>
      <button onClick={() => reverify()} disabled={!caseId || !integ} title="Recompute every cited leaf against the root on chain" className={`${ctl} hover:text-fg`}>
        <RotateCw size={12} /> Re-verify
      </button>
      <button onClick={() => tamper()} disabled={!canAct} title="Simulate an insider editing one evidence node directly in the database (T)" className={`${ctl} hover:text-nomatch-ink`}>
        <Zap size={12} /> Tamper <kbd className="key !px-1 !text-[10px]">T</kbd>
      </button>
    </>
  );

  if (!integ) {
    return (
      <Section title="Evidence integrity" aside={actions}>
        <p className="max-w-[560px] border-t border-rule pt-3 text-[14px] leading-relaxed text-fg-2">
          Every fact a case cites is a leaf under the graph root committed on chain. Open a case to verify its evidence here.
        </p>
        {caseId && caseStatus === "idle" && (
          <button onClick={() => runCase()} disabled={busy} className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-main-ink hover:underline disabled:opacity-50">
            Open investigation <span className="font-mono text-[12px] font-normal">{caseId}</span> <ArrowRight size={14} />
          </button>
        )}
        {caseStatus === "running" && <p className="mt-3 text-[13px] text-muted">Case agent running…</p>}
      </Section>
    );
  }

  return (
    <Section title={<>Evidence integrity <span className="ml-1 font-mono text-[12px] font-normal text-muted">{caseId}</span></>} aside={actions}>
      <div className="border-t border-rule pt-3">
        <div className={`flex items-center gap-2 text-[15px] font-semibold ${broken.length ? "text-nomatch-ink" : "text-match-ink"}`}>
          {broken.length ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
          {broken.length ? (broken.length > 1 ? `${broken.length} evidence leaves no longer match the root` : "1 evidence leaf no longer matches the root") : "All cited evidence matches the signed root"}
        </div>
        <div className="mt-1 text-[13px] text-fg-2">
          {integ.verified} of {integ.total} items verified · epoch {integ.epoch}
          {integ.block != null ? <> · block <span className="font-mono">#{integ.block}</span></> : null}
          {integ.root && <span className="ml-2 font-mono text-[11px] text-muted" title={integ.root}>root {integ.root.slice(0, 18)}…</span>}
        </div>
      </div>
      <ul className="mt-3 border-t border-rule">
        {items.map((it, i) => {
          const ok = it.status === "verified";
          const name = it.id ?? it.element_id?.split(":").slice(1).join(":") ?? "";
          const kind = it.label ?? it.element_id?.split(":")[0] ?? "";
          return (
            <li key={(it.element_id ?? it.id ?? "") + i} className="border-b border-rule">
              <button
                onClick={() => it.id && setHighlight([it.id])}
                className={`grid w-full grid-cols-[10px_96px_1fr_auto] items-center gap-3 rounded-[4px] px-1 py-2 text-left text-[13px] hover:bg-surface-2 ${ok ? "" : "line-in"}`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: ok ? "var(--match)" : "var(--nomatch)" }} />
                <span className="truncate text-muted">{kind}</span>
                <span className={`truncate font-mono text-[12px] ${ok ? "text-fg-2" : "font-medium text-nomatch-ink"}`} title={name}>{name}</span>
                {ok ? (
                  <span className="font-mono text-[11px] text-muted">{(it.leaf ?? "").slice(0, 10)}</span>
                ) : (
                  <span className="text-[12px] font-medium text-nomatch-ink">changed after epoch {integ.epoch}</span>
                )}
              </button>
              {!ok && (it.leaf_epoch || it.leaf_current) && (
                <div className="grid grid-cols-[96px_1fr] gap-x-3 pb-2 pl-[27px] font-mono text-[11px]">
                  <span className="text-muted">committed</span><span className="truncate text-fg-2">{it.leaf_epoch}</span>
                  <span className="text-muted">now</span><span className="truncate text-nomatch-ink">{it.leaf_current}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Registry() {
  const blocks = useStore((s) => s.blocks);
  const entries = blocks.filter((b) => b.kind === "publish");
  const hits = blocks.filter((b) => b.kind === "registry_hit");
  const orphanHits = hits.filter((h) => !entries.some((e) => e.fp && h.fp && e.fp.slice(0, 12) === h.fp.slice(0, 12)));
  return (
    <Section title="Mule registry" aside={<span className="text-[12px] text-muted">{entries.length} entr{entries.length === 1 ? "y" : "ies"}</span>}>
      {entries.length === 0 && orphanHits.length === 0 ? (
        <p className="border-t border-rule pt-3 text-[14px] leading-relaxed text-fg-2">Empty. Approving a ring case publishes its phone and device fingerprints here, as keyed hashes only.</p>
      ) : (
        <ul className="border-t border-rule">
          {entries.map((e) => {
            const h = hits.filter((x) => x.fp && e.fp && x.fp.slice(0, 12) === e.fp.slice(0, 12));
            return (
              <li key={e.id + e.tx} className="border-b border-rule py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[13px] text-fg">{(e.fp ?? "").slice(0, 16)}</span>
                  <span className="text-[12px] capitalize text-fg-2">{e.fpKind}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                  <BankDot code={e.bank ?? "MRGL"} size={6} /> published by {e.bank ?? "MRGL"} · block <span className="font-mono">#{e.id}</span> · {e.ts}
                </div>
                {h.map((x) => (
                  <div key={x.id + x.ts} className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold text-nomatch-ink">
                    <BankDot code={x.bank ?? ""} size={6} /> {x.bank} checked a new payee and got a hit · {x.ts}
                  </div>
                ))}
              </li>
            );
          })}
          {orphanHits.map((x) => (
            <li key={"h" + x.id + x.ts} className="border-b border-rule py-2.5 text-[13px] font-medium text-nomatch-ink">
              <span className="font-mono">{(x.fp ?? "").slice(0, 16)}</span> · {x.bank} hit · {x.ts}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export default function AuditView() {
  const n = useStore((s) => s.blocks.length);
  return (
    <div className="scroll-thin h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1480px] px-10 pb-12 pt-9">
        <div className="mb-6 flex items-baseline gap-4">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-fg">Ledger</h1>
          <span className="text-[13px] text-muted">Local chain · {n} block{n === 1 ? "" : "s"} · oldest to newest · click a block to open it</span>
        </div>
        <Chain />
        <div className="mt-12 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-16">
          <Integrity />
          <Registry />
        </div>
      </div>
      <BlockDrawer />
    </div>
  );
}
