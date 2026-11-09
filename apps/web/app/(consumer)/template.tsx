// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

"use client";

// Tab-change transition and touch swipe for the five consumer tabs.
//
// Transition: a curtain of the new tab's textile sweeps across in the direction
// of travel (forward = rightward through the tab order, back = leftward) and
// pulls away, while the page slides in from the same side. No curtain on the
// first page load: the header's own entrance covers that.
//
// Next 16 keeps visited routes alive in hidden <Activity> boundaries rather than
// remounting this template, so the transition is started from a layout effect:
// those run again every time a tab is revealed, before it paints. The direction
// is written to the DOM, not to React state, so revealing never re-renders.
//
// Touch: a horizontal swipe on the page moves to the next or previous tab. The
// tab bar stays the visible way to do the same thing (gesture alternative).
import { usePathname, useRouter } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

import { tap } from "@/lib/delight";
import { POP_CLASS, TAB_KEYS, TABS, type TabKey } from "@/lib/tabs";
import { cn } from "@/lib/utils";

// The tab shown last, shared by every instance of this template.
let lastIndex: number | null = null;

const SWIPE_MIN_X = 64;
const SWIPE_MAX_Y = 48;

function tabOf(pathname: string): TabKey | null {
  return (
    TAB_KEYS.find((k) => pathname === TABS[k].href || pathname.startsWith(`${TABS[k].href}/`)) ??
    null
  );
}

export default function ConsumerTemplate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const tab = tabOf(pathname);
  const index = tab ? TAB_KEYS.indexOf(tab) : null;
  const wrap = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    const from = lastIndex;
    lastIndex = index;
    if (!el || from === null || index === null || from === index) return;

    el.dataset.dir = index < from ? "back" : "forward";
    el.classList.remove("is-entering");
    void el.offsetWidth; // restart the CSS animations if a transition is still running
    el.classList.add("is-entering");
    const done = window.setTimeout(() => el.classList.remove("is-entering"), 900);
    return () => window.clearTimeout(done);
  }, [index]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch" || !e.isPrimary) return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId || index === null) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dy) > SWIPE_MAX_Y) return;
    const next = index + (dx < 0 ? 1 : -1);
    if (next < 0 || next >= TAB_KEYS.length) return;
    tap(8);
    router.push(TABS[TAB_KEYS[next]].href);
  };

  return (
    <div
      ref={wrap}
      data-dir="forward"
      className={cn(tab && POP_CLASS[TABS[tab].pop], tab && `motif-${tab}`, "touch-pan-y")}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (swipe.current = null)}
    >
      <div aria-hidden="true" className="tab-curtain" />
      <div className="tab-content">{children}</div>
    </div>
  );
}
