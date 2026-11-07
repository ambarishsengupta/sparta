// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

"use client";

// The live ground behind every consumer screen, and the tap ring.
//
// Background: a drifting kolam dot grid, two rangoli mandalas turning in
// opposite directions and a few marigold petals rising through the page. All
// layers are fixed, pointer-events-none and move with transform only, so they
// never cost layout or repaint on scroll.
//
// Pointer and touch: the layers lean away from the mouse (or from the last
// touch) for a soft parallax. Values are written straight to CSS custom
// properties once per animation frame, never into React state. A dotted kolam
// ring blooms wherever a link or button is pressed, by finger or mouse.
//
// Reduced motion: no parallax, no tap ring, and the CSS loops stop (globals.css).
import { useEffect, useRef } from "react";

// Fixed positions and timings, so server and client render the same markup.
const PETALS = [
  { x: "6%", size: 10, dur: 26, delay: -3, petal: "var(--tangerine)" },
  { x: "19%", size: 14, dur: 31, delay: -17, petal: "var(--yellow)" },
  { x: "33%", size: 9, dur: 23, delay: -9, petal: "var(--pink)" },
  { x: "48%", size: 12, dur: 29, delay: -22, petal: "var(--tangerine)" },
  { x: "61%", size: 10, dur: 25, delay: -5, petal: "var(--yellow)" },
  { x: "74%", size: 15, dur: 34, delay: -14, petal: "var(--tangerine)" },
  { x: "87%", size: 9, dur: 27, delay: -24, petal: "var(--pink)" },
  { x: "95%", size: 11, dur: 30, delay: -11, petal: "var(--yellow)" },
];

const TAPPABLE = "a[href], button, [role='button'], summary";

export function Ambient() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    let frame = 0;
    let px = 0;
    let py = 0;
    const commit = () => {
      frame = 0;
      root.style.setProperty("--px", px.toFixed(3));
      root.style.setProperty("--py", py.toFixed(3));
    };
    const aim = (x: number, y: number) => {
      px = (x / window.innerWidth) * 2 - 1;
      py = (y / window.innerHeight) * 2 - 1;
      if (!frame) frame = requestAnimationFrame(commit);
    };

    const onMove = (e: PointerEvent) => {
      if (reduce.matches || e.pointerType !== "mouse") return;
      aim(e.clientX, e.clientY);
    };

    const onDown = (e: PointerEvent) => {
      if (reduce.matches) return;
      // Touch has no hover, so the ground leans toward the last touch instead.
      if (e.pointerType !== "mouse") aim(e.clientX, e.clientY);

      const target = (e.target as Element | null)?.closest(TAPPABLE);
      if (!target || target.matches("[aria-disabled='true'], :disabled")) return;
      const ring = document.createElement("span");
      ring.className = "tap-ring";
      ring.setAttribute("aria-hidden", "true");
      ring.style.left = `${e.clientX}px`;
      ring.style.top = `${e.clientY}px`;
      const pop = getComputedStyle(target).getPropertyValue("--pop").trim();
      if (pop) ring.style.setProperty("--ring-colour", pop);
      document.body.append(ring);
      ring
        .animate(
          [
            { transform: "scale(0.2) rotate(0deg)", opacity: 0.9 },
            { transform: "scale(1.5) rotate(60deg)", opacity: 0 },
          ],
          { duration: 560, easing: "cubic-bezier(0.2, 0, 0, 1)" },
        )
        .finished.finally(() => ring.remove());
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} aria-hidden="true" className="ambient">
      <div className="ambient-layer ambient-dots" />
      <div className="ambient-layer ambient-mandala is-small" />
      <div className="ambient-layer ambient-mandala is-large" />
      {PETALS.map((p, i) => (
        <div
          key={i}
          className="ambient-layer ambient-petal"
          style={
            {
              "--x": p.x,
              "--size": `${p.size}px`,
              "--dur": `${p.dur}s`,
              "--delay": `${p.delay}s`,
              "--petal": p.petal,
            } as React.CSSProperties
          }
        >
          <span />
        </div>
      ))}
    </div>
  );
}
