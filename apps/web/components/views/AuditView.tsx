"use client";
import { AlertTriangle, ArrowRight, RotateCw, ShieldCheck, Zap } from "lucide-react";
import { useStore } from "@/lib/store";
import type { LedgerBlock } from "@/lib/types";
import Chain, { blockFace } from "@/components/shell/Chain";
import { BankDot, tint } from "@/components/shell/bits";

function Panel({ title, aside, children, className = "" }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 min-w-0 flex-col ${className}`}>
      <div className="flex h-10 shrink-0 items-center gap-2 px-5">
        <span className="text-[13px] font-semibold text-fg">{title}</span>
        <span className="ml-auto flex items-center gap-1.5">{aside}</span>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
    </section>
  );
}

function BlockDetail() {
  const sel = useStore((s) => s.explorer);
  const blocks = useStore((s) => s.blocks);
  const caseId = useStore((s) => s.caseId);
  const setView = useStore((s) => s.setView);
  const b: LedgerBlock | undefined = sel ?? blocks[blocks.length - 1];
  if (!b) return <Panel title="Block"><p className="text-[14px] text-muted">Select a block on the chain.</p></Panel>;
  const f = blockFace(b);
  const rows: [string, string][] = [
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
      .map(([k, v]) => [k.replaceAll("_", " "), typeof v === "number" ? v.toLocaleString("en-US") : String(v)] as [string, string]),
  ];
  const linkedCase = b.detail?.case && b.detail.case === caseId;
  return (
    <Panel
      title={<>Block <span className="font-mono">#{b.id}</span> <span className="ml-1 font-normal text-muted">{f.kind}</span></>}
      aside={sel ? <span className="text-[12px] text-muted">Esc shows newest</span> : <span className="text-[12px] text-muted">newest</span>}
    >
      <dl className="text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[100px_1fr] gap-3 border-b border-rule py-2">
            <dt className="text-muted">{k}</dt>
            <dd className={`min-w-0 break-all text-fg ${/^0x|^[0-9a-f]{12,}$/.test(v) ? "font-mono text-[12px]" : ""}`}>{v}</dd>
          </div>
        ))}
      </dl>
      {linkedCase && (
        <button onClick={() => setView("investigate")} className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-main-ink hover:underline">
          Open the case behind this decision <ArrowRight size={14} />
        </button>
      )}
    </Panel>
  );
}

type Item = { id?: string; element_id?: string; label?: string; leaf?: string; leaf_epoch?: string; leaf_current?: string; status: string };

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
      <button onClick={() => reverify()} disabled={!caseId || !integ} title="Recompute every cited leaf against the root on chain" className="flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-rule px-2 text-[12px] font-medium text-fg-2 hover:border-main hover:text-fg disabled:opacity-40">
        <RotateCw size={12} /> Re-verify
      </button>
      <button onClick={() => tamper()} disabled={!canAct} title="Simulate an insider editing one evidence node directly in the database (T)" className="flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-rule px-2 text-[12px] font-medium text-fg-2 hover:border-nomatch hover:text-nomatch-ink disabled:opacity-40">
        <Zap size={12} /> Tamper <kbd className="key !px-1 !text-[10px]">T</kbd>
      </button>
    </>
  );

  if (!integ) {
    return (
      <Panel title="Evidence integrity" aside={actions}>
        <p className="text-[14px] leading-relaxed text-fg-2">
          Every fact a case cites is a leaf under the graph root committed on chain. Open a case to verify its evidence here.
        </p>
        {caseId && caseStatus === "idle" && (
          <button onClick={() => runCase()} disabled={busy} className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-main-ink hover:underline disabled:opacity-50">
            Open investigation <span className="font-mono text-[12px]">{caseId}</span> <ArrowRight size={14} />
          </button>
        )}
        {caseStatus === "running" && <p className="mt-3 text-[13px] text-muted">Case agent running…</p>}
      </Panel>
    );
  }

  return (
    <Panel title={<>Evidence integrity <span className="ml-1 font-mono text-[12px] font-normal text-muted">{caseId}</span></>} aside={actions}>
      <div
        className="rounded-[var(--radius-sm)] border px-3 py-2.5"
        style={broken.length ? { borderColor: "var(--nomatch)", background: tint("var(--nomatch)", 10) } : { borderColor: "color-mix(in srgb, var(--match) 45%, transparent)", background: tint("var(--match)", 8) }}
      >
        <div className={`flex items-center gap-2 text-[15px] font-semibold ${broken.length ? "text-nomatch-ink" : "text-match-ink"}`}>
          {broken.length ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
          {broken.length ? broken.length > 1 ? `${broken.length} evidence leaves no longer match the root` : "1 evidence leaf no longer matches the root" : "All cited evidence matches the signed root"}
        </div>
        <div className="mt-1 text-[13px] text-fg-2">
          {integ.verified} of {integ.total} items verified · epoch {integ.epoch}{integ.block != null ? <> · block <span className="font-mono">#{integ.block}</span></> : null}
        </div>
        {integ.root && <div className="mt-1 truncate font-mono text-[11px] text-muted" title={integ.root}>root {integ.root}</div>}
      </div>
      <ul className="mt-2">
        {items.map((it, i) => {
          const ok = it.status === "verified";
          const name = it.id ?? it.element_id?.split(":").slice(1).join(":") ?? "";
          const kind = it.label ?? it.element_id?.split(":")[0] ?? "";
          return (
            <li key={(it.element_id ?? it.id ?? "") + i}>
              <button
                onClick={() => it.id && setHighlight([it.id])}
                className={`grid w-full grid-cols-[10px_72px_1fr_auto] items-center gap-2 border-b border-rule py-1.5 text-left text-[13px] ${ok ? "" : "line-in"}`}
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
                <div className="grid grid-cols-[82px_1fr] gap-x-2 border-b border-rule py-1.5 pl-[18px] font-mono text-[11px]">
                  <span className="text-muted">committed</span><span className="truncate text-fg-2">{it.leaf_epoch}</span>
                  <span className="text-muted">now</span><span className="truncate text-nomatch-ink">{it.leaf_current}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Registry() {
  const blocks = useStore((s) => s.blocks);
  const entries = blocks.filter((b) => b.kind === "publish");
  const hits = blocks.filter((b) => b.kind === "registry_hit");
  const orphanHits = hits.filter((h) => !entries.some((e) => e.fp && h.fp && e.fp.slice(0, 12) === h.fp.slice(0, 12)));
  return (
    <Panel title="Mule registry" aside={<span className="text-[12px] text-muted">{entries.length} entr{entries.length === 1 ? "y" : "ies"}</span>}>
      {entries.length === 0 && orphanHits.length === 0 ? (
        <p className="text-[14px] leading-relaxed text-fg-2">Empty. Approving a ring case publishes its phone and device fingerprints here, as keyed hashes only.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => {
            const h = hits.filter((x) => x.fp && e.fp && x.fp.slice(0, 12) === e.fp.slice(0, 12));
            return (
              <li key={e.id + e.tx} className="rounded-[var(--radius-sm)] border px-3 py-2" style={h.length ? { borderColor: "var(--nomatch)", background: tint("var(--nomatch)", 8) } : { borderColor: "var(--rule)" }}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px] text-fg">{(e.fp ?? "").slice(0, 16)}</span>
                  <span className="text-[12px] capitalize text-fg-2">{e.fpKind}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                  <BankDot code={e.bank ?? "MRGL"} size={6} /> published by {e.bank ?? "MRGL"} · block <span className="font-mono">#{e.id}</span> · {e.ts}
                </div>
                {h.map((x) => (
                  <div key={x.id + x.ts} className="mt-1 flex items-center gap-1.5 text-[12px] font-medium text-nomatch-ink">
                    <BankDot code={x.bank ?? ""} size={6} /> {x.bank} checked a new payee and got a hit · {x.ts}
                  </div>
                ))}
              </li>
            );
          })}
          {orphanHits.map((x) => (
            <li key={"h" + x.id + x.ts} className="rounded-[var(--radius-sm)] border border-nomatch px-3 py-2 text-[12px] text-nomatch-ink">
              <span className="font-mono">{(x.fp ?? "").slice(0, 16)}</span> · {x.bank} hit · {x.ts}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function AuditView() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-rule">
        <div className="flex h-10 items-center px-5">
          <span className="text-[13px] font-semibold text-fg">Chain</span>
          <span className="ml-2 text-[12px] text-muted">oldest to newest · click a block to open it</span>
        </div>
        <Chain />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)] divide-x divide-rule pt-2">
        <BlockDetail />
        <Integrity />
        <Registry />
      </div>
    </div>
  );
}
