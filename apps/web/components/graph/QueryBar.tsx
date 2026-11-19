"use client";
import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, Loader2, MessageSquareText, Search, Shapes, X } from "lucide-react";
import { useGraphStore, type QueryMode } from "@/lib/graphStore";
import type { GData } from "@/lib/graphAdapt";
import { BANK, KIND_LABEL, type Kind } from "@/lib/palette";
import { KindGlyph } from "./Legend";

const MODES: { key: QueryMode; label: string; icon: React.ReactNode; ph: string }[] = [
  { key: "find", label: "Find", icon: <Search size={13} />, ph: "Name, IBAN, record id, phone or device hash" },
  { key: "ask", label: "Ask", icon: <MessageSquareText size={13} />, ph: "Which accounts share a phone with Usman Ghani?" },
  { key: "patterns", label: "Patterns", icon: <Shapes size={13} />, ph: "" },
];

export default function QueryBar({ data }: { data: GData }) {
  const mode = useGraphStore((s) => s.mode);
  const setMode = useGraphStore((s) => s.setMode);
  const busy = useGraphStore((s) => s.busy);
  const hits = useGraphStore((s) => s.hits);
  const answer = useGraphStore((s) => s.answer);
  const patterns = useGraphStore((s) => s.patterns);
  const active = useGraphStore((s) => s.activePattern);
  const qerror = useGraphStore((s) => s.qerror);
  const highlight = useGraphStore((s) => s.highlight);
  const find = useGraphStore((s) => s.find);
  const ask = useGraphStore((s) => s.ask);
  const runPattern = useGraphStore((s) => s.runPattern);
  const clearQuery = useGraphStore((s) => s.clearQuery);
  const select = useGraphStore((s) => s.select);
  const focusOn = useGraphStore((s) => s.focusOn);
  const expand = useGraphStore((s) => s.expand);
  const setHighlight = useGraphStore((s) => s.setHighlight);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const deb = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "/" focuses the query box
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "/" || (e.target as HTMLElement)?.closest("input,textarea,[contenteditable]")) return;
      e.preventDefault();
      if (mode === "patterns") setMode("find");
      input.current?.focus();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [mode, setMode]);

  const onChange = (v: string) => {
    setText(v);
    setOpen(true);
    if (mode !== "find") return;
    if (deb.current) clearTimeout(deb.current);
    deb.current = setTimeout(() => find(v), 220);
  };
  const submit = () => {
    setOpen(true);
    if (mode === "ask") ask(text);
    else if (mode === "find") {
      if (hits[0]) pick(hits[0].id);
      else find(text);
    }
  };
  const pick = async (id: string) => {
    if (!data.nodes.some((n) => n.id === id)) await expand(id, "grand");
    const d = useGraphStore.getState().data;
    select({ type: "node", id }, d, "grand");
    focusOn(id);
    setOpen(false);
  };
  const reset = () => { setText(""); clearQuery(); setOpen(false); };

  const panel = open && (
    (mode === "find" && (hits.length > 0 || qerror)) ||
    (mode === "ask" && (answer || busy || qerror)) ||
    (mode === "patterns")
  );

  return (
    <div className="pointer-events-auto relative w-[min(560px,calc(100vw-32px))]">
      <div className="flex h-10 items-center gap-1 rounded-[4px] border border-rule bg-bg pl-1 pr-1.5 focus-within:border-main">
        <div className="flex shrink-0 gap-0.5" role="tablist" aria-label="Query mode">
          {MODES.map((m) => (
            <button
              key={m.key}
              role="tab"
              aria-selected={mode === m.key}
              onClick={() => { setMode(m.key); setOpen(true); if (m.key !== "patterns") setTimeout(() => input.current?.focus(), 0); }}
              className={`flex h-8 items-center gap-1.5 rounded-[3px] px-2 text-[13px] ${mode === m.key ? "bg-main-soft font-medium text-main-ink" : "text-fg-2 hover:bg-surface-2 hover:text-fg"}`}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
        {mode !== "patterns" ? (
          <input
            ref={input}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } if (e.key === "Escape") setOpen(false); }}
            placeholder={MODES.find((m) => m.key === mode)!.ph}
            className="h-9 min-w-0 flex-1 border-l border-rule bg-transparent px-2.5 text-[14px] text-fg outline-none placeholder:text-muted"
            aria-label={mode === "find" ? "Find an entity" : "Ask the graph"}
          />
        ) : (
          <div className="min-w-0 flex-1 truncate border-l border-rule px-2.5 text-[13px] text-fg-2">{active ? active.title : "Pick a detector below"}</div>
        )}
        {busy ? <Loader2 size={15} className="mr-1 animate-spin text-muted" /> : mode !== "patterns" && text ? (
          <kbd className="mr-1 flex items-center gap-1 rounded-[3px] border border-rule px-1.5 py-0.5 text-[11px] text-muted"><CornerDownLeft size={11} /></kbd>
        ) : null}
        {highlight && (
          <span className="flex h-7 max-w-[180px] shrink-0 items-center gap-1.5 rounded-[3px] bg-surface-2 pl-2 pr-0.5 text-[12px] text-fg" title={highlight.label}>
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
            <span className="truncate">
            {highlight.label}</span>
            <button onClick={reset} className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] text-muted hover:bg-rule hover:text-fg" aria-label="Clear highlight"><X size={12} /></button>
          </span>
        )}
      </div>

      {panel && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-[56vh] overflow-hidden rounded-[4px] border border-rule bg-bg">
          <div className="flex items-center justify-end px-2 pt-1.5">
            <button onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:text-fg" aria-label="Close results"><X size={13} /></button>
          </div>
          <div className="scroll-thin max-h-[calc(52vh-32px)] overflow-y-auto px-2 pb-2">
            {qerror && <p className="px-2 pb-2 text-[13px] text-muted">{qerror}</p>}

            {mode === "find" && hits.length > 0 && (
              <ul>
                {hits.map((h) => (
                  <li key={h.id}>
                    <button onClick={() => pick(h.id)} className="flex h-9 w-full items-center gap-2.5 rounded-[3px] px-2 text-left hover:bg-surface-2">
                      <KindGlyph kind={h.kind} />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{h.label}</span>
                      <span className="shrink-0 text-[12px] text-muted">{KIND_LABEL[h.kind as Kind] ?? h.kind}</span>
                      {h.bank && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: BANK[h.bank] ?? "#5C627C" }} title={h.bank} />}
                      <span className="w-[120px] shrink-0 truncate text-right font-mono text-[11.5px] text-muted">{h.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {mode === "ask" && (busy && !answer ? (
              <p className="px-2 pb-2 text-[13px] text-muted">Translating the question to a graph query…</p>
            ) : answer ? (
              <div className="space-y-2 px-2 pb-1">
                <p className="text-[12.5px] text-muted">{answer.transcript}</p>
                {answer.error && !answer.text ? (
                  <p className="text-[13.5px] text-nomatch-ink">{answer.error}</p>
                ) : (
                  <p className="text-[14px] leading-[1.55] text-fg">{answer.text}</p>
                )}
                <div className="flex items-center gap-3 text-[12px] text-muted">
                  <span>{answer.rows} row{answer.rows === 1 ? "" : "s"}</span>
                  {highlight && <span>{highlight.nodes.length} on the graph</span>}
                </div>
                {answer.cypher && (
                  <details className="group">
                    <summary className="cursor-pointer list-none text-[12px] text-fg-2 hover:text-fg">Show the query</summary>
                    <pre className="scroll-thin mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-[3px] bg-surface-2 px-2 py-1.5 font-mono text-[11.5px] text-fg-2">{answer.cypher}</pre>
                  </details>
                )}
              </div>
            ) : null)}

            {mode === "patterns" && (
              <div className="space-y-2">
                <ul>
                  {(patterns.length ? patterns : []).map((p) => (
                    <li key={p.key}>
                      <button
                        onClick={() => runPattern(p.key)}
                        aria-pressed={active?.key === p.key}
                        className={`flex w-full gap-2.5 rounded-[3px] px-2 py-2 text-left transition-colors ${active?.key === p.key ? "bg-main-soft" : "hover:bg-surface-2"}`}
                      >
                        <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${active?.key === p.key ? "bg-accent" : "bg-rule"}`} />
                        <span className="min-w-0">
                          <span className={`block text-[13px] font-medium ${active?.key === p.key ? "text-main-ink" : "text-fg"}`}>{p.title}</span>
                          <span className="block text-[12.5px] leading-snug text-muted">{p.description}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {!patterns.length && <li className="px-2 text-[13px] text-muted">Loading detectors…</li>}
                </ul>
                {active && (
                  <div className="border-t border-rule px-1 pt-2">
                    <div className="px-1 pb-1 text-[13px] text-fg">
                      {active.count} match{active.count === 1 ? "" : "es"}
                      {active.local && <span className="text-muted"> in the graph on screen</span>}
                    </div>
                    <ul>
                      {active.matches.slice(0, 20).map((m, i) => {
                        const lab = m.map((id) => data.nodes.find((n) => n.id === id)?.label ?? id);
                        return (
                          <li key={i}>
                            <button
                              onClick={() => setHighlight({ nodes: m, links: [], label: `${active.title} ${i + 1}` })}
                              className="flex w-full items-baseline gap-2 rounded-[3px] px-1 py-1 text-left text-[12.5px] hover:bg-surface-2"
                            >
                              <span className="w-5 shrink-0 font-mono text-[11px] text-muted">{i + 1}</span>
                              <span className="min-w-0 flex-1 truncate text-fg-2">{lab.slice(0, 6).join(" · ")}{lab.length > 6 ? ` +${lab.length - 6}` : ""}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
