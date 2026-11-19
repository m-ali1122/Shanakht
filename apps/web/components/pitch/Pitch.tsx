"use client";

import dynamic from "next/dynamic";
import ScrollDriver from "./ScrollDriver";
import { Agent, Cases, Graph, Hero, Ledger, NameCheck, Nav } from "./Sections";

const Scene = dynamic(() => import("./Scene"), { ssr: false });

export default function Pitch() {
  return (
    <div className="pitch relative min-h-screen overflow-x-clip bg-night-bg font-sans antialiased">
      <div className="pitch-canvas pointer-events-none fixed inset-0 z-0" aria-hidden>
        <Scene />
      </div>
      <div className="pitch-scrim pointer-events-none fixed inset-0 z-[1]" aria-hidden />
      <ScrollDriver />
      <Nav />
      <main className="relative z-10">
        <Hero />
        <NameCheck />
        <Graph />
        <Agent />
        <Ledger />
        <Cases />
      </main>
    </div>
  );
}
