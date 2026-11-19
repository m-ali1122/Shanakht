"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { SCENARIOS, FP } from "@/lib/scenarios";
import { GUIDE, OUTCOME_LABEL } from "@/lib/guide";

const EASE = [0.2, 0.7, 0.2, 1] as const;

function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.9, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

const wrap = "mx-auto w-full max-w-[1200px] px-4 sm:px-8";
const h2 = "font-display text-[40px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[56px] lg:text-[64px]";
const lede = "mt-5 max-w-[44ch] text-[17px] leading-relaxed text-night-muted sm:text-[18px]";

export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-night-rule/60 bg-night-bg/70 backdrop-blur-md">
      <div className={`${wrap} flex h-16 items-center justify-between`}>
        <Link href="/" className="flex items-baseline gap-2.5">
          <span className="text-[18px] font-semibold tracking-[-0.02em]">Shanakht</span>
          <span className="urdu text-[16px] leading-none text-night-muted" lang="ur">
            شناخت
          </span>
        </Link>
        <Link
          href="/console"
          className="flex items-center gap-1.5 rounded-full border border-night-rule bg-night-bg/60 px-4 py-2 text-[14px] backdrop-blur transition-colors hover:border-night-fg/40"
        >
          Open the demo <ArrowUpRight size={15} />
        </Link>
      </div>
    </header>
  );
}

export function Hero() {
  return (
    <section data-k="[[0.5,0]]" className="flex min-h-[100svh] items-center pb-16 pt-28">
      <div className={wrap}>
        <Reveal>
          <h1 className="max-w-[13ch] font-display text-[52px] font-semibold leading-[0.98] tracking-[-0.045em] sm:text-[80px] lg:text-[96px]">
            Know who gets the money <span className="text-accent">before</span> it moves.
          </h1>
        </Reveal>
        <Reveal delay={0.12}>
          <p className={lede}>
            Names typed abroad rarely match the account title at home. Shanakht tells a spelling difference from the wrong
            person.
          </p>
        </Reveal>
        <Reveal delay={0.22} className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
          <Link
            href="/console"
            className="group flex items-center gap-2 rounded-full bg-accent px-6 py-3.5 text-[15px] font-medium text-accent-ink transition-transform hover:-translate-y-0.5"
          >
            Open the demo <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a href="#cases" className="text-[15px] text-night-muted underline decoration-night-rule underline-offset-[6px] transition-colors hover:text-night-fg hover:decoration-night-fg/50">
            See the six cases
          </a>
        </Reveal>
      </div>
    </section>
  );
}

const PAIRS: [string, string | null, string][] = [
  ["Mohd", "MUHAMMAD", "initial expanded"],
  ["Ali", "ALI", "exact"],
  ["s/o Rehmat", null, "patronymic dropped"],
];

export function NameCheck() {
  const reduce = useReducedMotion();
  return (
    <section data-k="[[0.5,1]]" className="flex min-h-[120svh] items-center py-24">
      <div className={wrap}>
        <Reveal>
          <h2 className={h2}>
            Same person,
            <br />
            spelled differently.
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className={lede}>Checked word by word, in Roman and Urdu script, before the money is sent.</p>
        </Reveal>

        <Reveal delay={0.18} className="pitch-card mt-10 max-w-[560px] rounded-2xl p-5 sm:p-7">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 text-[12px] text-night-muted sm:gap-x-5">
            <span>Typed abroad</span>
            <span />
            <span>Account title</span>
          </div>
          <div className="mt-2">
            {PAIRS.map(([a, b, why], i) => (
              <div key={a} className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 border-t border-night-rule py-3.5 sm:gap-x-5">
                <span className="text-[20px] font-medium tracking-[-0.01em] sm:text-[24px]">{a}</span>
                <motion.span
                  className={`block h-px w-8 origin-left sm:w-14 ${b ? "bg-accent" : "bg-night-rule"}`}
                  initial={reduce ? false : { scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true, amount: 0.8 }}
                  transition={{ duration: 0.6, ease: EASE, delay: 0.35 + i * 0.18 }}
                />
                <div>
                  <div className={`font-mono text-[15px] tracking-[0.04em] sm:text-[17px] ${b ? "" : "text-night-muted"}`}>{b ?? "—"}</div>
                  <div className="mt-0.5 text-[12px] text-night-muted">{why}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-night-rule pt-4">
            <span className="flex items-center gap-2 font-mono text-[12px] tracking-[0.06em] text-[var(--close)]">
              <span className="h-2 w-2 rounded-full bg-[var(--close)]" /> CLOSE · 0.91
            </span>
            <span className="urdu text-[24px] leading-none" lang="ur">
              محمد علی
            </span>
          </div>
        </Reveal>

        <Reveal delay={0.1} className="mt-4 flex max-w-[560px] flex-wrap items-center justify-between gap-3 rounded-2xl border border-night-rule px-5 py-4 sm:px-7">
          <span className="text-[15px]">
            Zainab Bibi <span className="px-1.5 text-night-muted">≠</span> <span className="font-mono tracking-[0.04em]">TARIQ MEHMOOD</span>
          </span>
          <span className="flex items-center gap-2 font-mono text-[12px] tracking-[0.06em] text-[var(--nomatch)]">
            <span className="h-2 w-2 rounded-full bg-[var(--nomatch)]" /> NO MATCH · HELD
          </span>
        </Reveal>
      </div>
    </section>
  );
}

const BANKS: [string, string][] = [
  ["Margalla", "var(--bank-mrgl)"],
  ["Ravi Commercial", "var(--bank-ravi)"],
  ["Chenab", "var(--bank-chnb)"],
  ["Indus Microfinance", "var(--bank-inds)"],
];

export function Graph() {
  return (
    <section data-k="[[0.16,2],[0.42,3],[0.78,4]]">
      <div className="flex min-h-[115svh] items-center py-24">
        <div className={wrap}>
          <Reveal>
            <h2 className={h2}>
              Four banks.
              <br />
              <span className="text-accent">One</span> person.
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className={lede}>Banks share keyed fingerprints of phones and devices, never the raw values.</p>
          </Reveal>
          <Reveal delay={0.18} className="mt-8 flex max-w-[520px] flex-wrap gap-x-6 gap-y-3">
            {BANKS.map(([n, c]) => (
              <span key={n} className="flex items-center gap-2 text-[14px] text-night-muted">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
                {n}
              </span>
            ))}
          </Reveal>
        </div>
      </div>
      <div className="flex min-h-[115svh] items-center py-24">
        <div className={wrap}>
          <Reveal>
            <h2 className={h2}>
              Five accounts.
              <br />
              <span className="text-[var(--nomatch)]">One</span> phone.
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className={lede}>A mule ring spread across three banks. No single bank can see it. The shared graph can.</p>
          </Reveal>
          <Reveal delay={0.18} className="mt-8 grid max-w-[460px] grid-cols-3 gap-px overflow-hidden rounded-2xl border border-night-rule bg-night-rule">
            {[
              ["5", "beneficiaries"],
              ["3", "banks"],
              ["< 48h", "all transfers"],
            ].map(([n, l]) => (
              <div key={l} className="bg-night-bg/80 px-4 py-4 backdrop-blur">
                <div className="text-[30px] font-semibold tracking-[-0.03em]">{n}</div>
                <div className="text-[13px] text-night-muted">{l}</div>
              </div>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function Agent() {
  return (
    <section data-k="[[0.5,5]]" className="flex min-h-[120svh] items-center py-24">
      <div className={wrap}>
        <Reveal>
          <h2 className={h2}>
            The model only
            <br />
            sees <span className="font-mono text-[0.82em] tracking-[-0.04em] text-accent">tokens</span>.
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className={lede}>The case agent writes its own graph queries and cites every fact. Names and accounts never reach it.</p>
        </Reveal>

        <Reveal delay={0.18} className="pitch-card mt-10 max-w-[560px] rounded-2xl p-5 sm:p-7">
          <div className="text-[12px] text-night-muted">Asked aloud</div>
          <p className="mt-1.5 text-[17px] leading-snug sm:text-[19px]">
            <span className="rounded bg-night-fg/10 px-1">Faisal Nawaz</span> ne pichle mahine kitne logon ko paise bheje?
          </p>
          <div className="mt-5 border-t border-night-rule pt-4 text-[12px] text-night-muted">What the model sees</div>
          <p className="mt-1.5 text-[17px] leading-snug text-night-muted sm:text-[19px]">
            <span className="font-mono text-[0.9em] text-accent">PERSON_1</span> ne pichle mahine kitne logon ko paise bheje?
          </p>
          <div className="mt-5 border-t border-night-rule pt-4 text-[12px] text-night-muted">Answer</div>
          <p className="urdu mt-1 text-right text-[22px] leading-[2] sm:text-[24px]" lang="ur">
            پچھلے مہینے پانچ افراد، تین بینکوں میں۔
          </p>
          <div className="mt-4 flex items-center justify-between border-t border-night-rule pt-4 font-mono text-[12px] text-night-muted">
            <span>Identifiers sent to model</span>
            <span className="text-[15px] text-accent">0</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Ledger() {
  const ref = useRef<HTMLElement>(null);
  const [tampered, setTampered] = useState(false);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start center", "end center"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => setTampered(v > 0.56));

  return (
    <section ref={ref} data-k="[[0.3,6],[0.78,7]]" className="relative h-[200svh]">
      <div className="sticky top-0 flex h-[100svh] items-center">
        <div className={wrap}>
          <Reveal>
            <h2 className={h2}>
              Every decision,
              <br />
              anchored on-chain.
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className={lede}>Only Merkle roots and keyed hashes leave the bank. Edit one fact afterwards and it stops verifying.</p>
          </Reveal>
          <Reveal delay={0.18} className="pitch-card mt-10 max-w-[480px] rounded-2xl p-5 sm:p-6">
            <div className="flex gap-1.5 sm:gap-2">
              {Array.from({ length: 9 }, (_, i) => {
                const bad = tampered && i === 4;
                return (
                  <span
                    key={i}
                    className="h-8 flex-1 rounded-md border transition-all duration-500"
                    style={{
                      background: bad ? "color-mix(in srgb, var(--nomatch) 30%, transparent)" : "color-mix(in srgb, var(--accent) 16%, transparent)",
                      borderColor: bad ? "var(--nomatch)" : "color-mix(in srgb, var(--accent) 45%, transparent)",
                      transform: bad ? "translateY(-4px)" : "none",
                    }}
                  />
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between font-mono text-[13px]">
              <span className={tampered ? "text-[var(--nomatch)]" : "text-accent"}>
                {tampered ? "8 of 9 verified · 1 changed" : "9 of 9 evidence items verified"}
              </span>
            </div>
            <div className="mt-4 border-t border-night-rule pt-4 font-mono text-[12px] tracking-[0.04em] text-night-muted">
              REGISTRY HIT · INDS · device fp {FP.S5_DEVICE.slice(0, 4)}…
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function Cases() {
  return (
    <section id="cases" data-k="[[0.3,8]]" className="scroll-mt-16 pb-16 pt-32">
      <div className={wrap}>
        <Reveal>
          <h2 className={h2}>Six cases.</h2>
        </Reveal>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SCENARIOS.map((s, i) => (
            <Reveal key={s.id} delay={0.05 * i}>
              <Link
                href={`/console?case=${s.id}`}
                className="group flex h-full min-h-[168px] flex-col justify-between rounded-2xl border border-night-rule bg-night-bg/70 p-6 backdrop-blur transition-colors duration-300 hover:border-accent/60 hover:bg-night-bg-2/80"
              >
                <div className="flex items-center justify-between font-mono text-[12px] text-night-muted">
                  <span>{String(s.id).padStart(2, "0")}</span>
                  <span>{OUTCOME_LABEL[GUIDE[i].outcome]}</span>
                </div>
                <div className="flex items-end justify-between gap-4">
                  <span className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">{s.title}</span>
                  <ArrowRight size={18} className="shrink-0 text-night-muted transition-all duration-300 group-hover:translate-x-1 group-hover:text-accent" />
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
      <footer className={`${wrap} mt-24 flex flex-col gap-2 border-t border-night-rule pt-6 text-[13px] text-night-muted sm:flex-row sm:justify-between`}>
        <span>All data is synthetic.</span>
        <span>Fictional banks: Margalla, Ravi Commercial, Chenab, Indus Microfinance.</span>
      </footer>
    </section>
  );
}
