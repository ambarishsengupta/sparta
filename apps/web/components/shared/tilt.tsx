// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

"use client";

// Leans its child toward a mouse pointer (3D tilt) and sinks it slightly under
// a finger or a click. Writes CSS custom properties on the element directly, so
// pointer movement never re-renders React. The .tilt rule in globals.css turns
// the values into a transform; reduced motion makes the transition instant.
import { useRef } from "react";

import { cn } from "@/lib/utils";

export function Tilt({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (props: Record<string, string>) => {
    const el = ref.current;
    if (!el) return;
    for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v);
  };

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("tilt", className)}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        set({
          "--tx": (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3),
          "--ty": (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3),
        });
      }}
      onPointerLeave={() => set({ "--tx": "0", "--ty": "0", "--press": "1" })}
      onPointerDown={() => set({ "--press": "0.96" })}
      onPointerUp={() => set({ "--press": "1" })}
      onPointerCancel={() => set({ "--press": "1" })}
    >
      {children}
    </div>
  );
}
