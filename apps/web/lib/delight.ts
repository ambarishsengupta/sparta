// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// One-off feedback effects, built on the Web Animations API (no animation library).
// Each one says something about what just happened:
//   flyToTab      the item's colour dot travels to the tab where it was saved
//   petalBurst    a small marigold scatter confirms the add
//   tap           a short vibration on Android (iOS browsers ignore it)
// All are skipped under prefers-reduced-motion. Calm mode does not stop them:
// it pauses ambient loops only, and these are feedback to the user's own action.
// Never used on consent, "Leave the pilot" or "what I wore" screens (FR-3, FR-56).

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function centre(el: Element) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function spawn(className: string, x: number, y: number, colour: string, size: number) {
  const el = document.createElement("span");
  el.className = className;
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, {
    left: `${x - size / 2}px`,
    top: `${y - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    background: colour,
  });
  document.body.append(el);
  return el;
}

/** Sends a dot of `colour` from `from` to the element matching `toSelector`, along an arc. */
export function flyToTab(from: Element, toSelector: string, colour: string): Promise<void> {
  const to = document.querySelector(toSelector);
  if (reduced() || !to) return Promise.resolve();
  const a = centre(from);
  const b = centre(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Lift above the straight line so the path reads as a throw, not a slide.
  const lift = -Math.min(160, Math.abs(dx) * 0.35 + 60);
  const dot = spawn("delight-dot", a.x, a.y, colour, 18);
  return dot
    .animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
        {
          transform: `translate(${dx * 0.5}px, ${dy * 0.5 + lift}px) scale(1.25)`,
          opacity: 1,
          offset: 0.45,
        },
        { transform: `translate(${dx}px, ${dy}px) scale(0.35)`, opacity: 0.2 },
      ],
      { duration: 640, easing: "cubic-bezier(0.3, 0, 0.2, 1)" },
    )
    .finished.then(() => undefined)
    .catch(() => undefined)
    .finally(() => dot.remove());
}

const BURST_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/** Eight petals scatter from `from` and fade, in the given colours (cycled). */
export function petalBurst(from: Element, colours: string[]) {
  if (reduced()) return;
  const { x, y } = centre(from);
  BURST_ANGLES.forEach((deg, i) => {
    const rad = (deg * Math.PI) / 180;
    const dist = 34 + (i % 3) * 8;
    const petal = spawn("delight-petal", x, y, colours[i % colours.length], 10);
    petal
      .animate(
        [
          { transform: `rotate(${deg}deg) translate(0, 0) scale(0.4)`, opacity: 1 },
          {
            transform: `translate(${Math.cos(rad) * dist}px, ${Math.sin(rad) * dist}px) rotate(${deg + 160}deg) scale(1)`,
            opacity: 0,
          },
        ],
        { duration: 560, easing: "cubic-bezier(0.2, 0, 0, 1)", delay: (i % 2) * 30 },
      )
      .finished.catch(() => undefined)
      .finally(() => petal.remove());
  });
}

/** A short vibration where supported (Android browsers). */
export function tap(ms = 12) {
  if (reduced()) return;
  if ("vibrate" in navigator) navigator.vibrate(ms);
}
