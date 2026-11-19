"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { KEYFRAMES, scrollState, setK } from "./progress";

// Sections declare which scene keyframes they hold with
// data-k='[[fraction, keyframe], ...]' (fraction of the section's height).
// The viewport centre is mapped onto those control points, piecewise linear.
export default function ScrollDriver() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollState.reduced = reduced;

    let pts: [number, number][] = [];

    const update = () => {
      if (!pts.length) return;
      const y = window.scrollY + window.innerHeight * 0.5;
      let k = pts[0][1];
      if (y >= pts[pts.length - 1][0]) k = pts[pts.length - 1][1];
      else {
        for (let i = 0; i < pts.length - 1; i++) {
          const [y0, k0] = pts[i];
          const [y1, k1] = pts[i + 1];
          if (y >= y0 && y < y1) {
            k = k0 + ((y - y0) / Math.max(1, y1 - y0)) * (k1 - k0);
            break;
          }
        }
      }
      setK(Math.min(KEYFRAMES - 1, Math.max(0, k)));
    };

    const measure = () => {
      const next: [number, number][] = [];
      document.querySelectorAll<HTMLElement>("[data-k]").forEach((el) => {
        const r = el.getBoundingClientRect();
        const top = r.top + window.scrollY;
        try {
          for (const [f, k] of JSON.parse(el.dataset.k || "[]") as [number, number][]) next.push([top + r.height * f, k]);
        } catch {
          /* ignore malformed anchors */
        }
      });
      pts = next.sort((a, b) => a[0] - b[0]);
      update();
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", measure);

    let lenis: Lenis | null = null;
    if (!reduced) {
      lenis = new Lenis({ autoRaf: true, anchors: true, lerp: 0.09 });
    }

    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", measure);
      lenis?.destroy();
    };
  }, []);

  return null;
}
