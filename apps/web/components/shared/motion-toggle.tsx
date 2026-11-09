// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

"use client";

// Pause / play for the always-moving background (WCAG 2.2.2: anything that moves
// for more than 5 seconds needs a way to stop it). Writes <html data-motion="calm">,
// which globals.css uses to freeze the loops in place; stored on this device only.
// The root layout applies a stored choice before first paint. Operating-system
// "reduce motion" still wins and stops everything, with or without this switch.
import { useSyncExternalStore } from "react";

import { PauseIcon, PlayIcon } from "@/components/shared/icons";
import { messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

export const MOTION_KEY = "sparta-motion";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-motion"],
  });
  return () => observer.disconnect();
}

const isCalm = () => document.documentElement.dataset.motion === "calm";

export function MotionToggle({ className }: { className?: string }) {
  const calm = useSyncExternalStore(subscribe, isCalm, () => false);

  const flip = () => {
    const root = document.documentElement;
    if (calm) delete root.dataset.motion;
    else root.dataset.motion = "calm";
    try {
      if (calm) localStorage.removeItem(MOTION_KEY);
      else localStorage.setItem(MOTION_KEY, "calm");
    } catch {
      // Storage blocked: the choice lasts for this visit only.
    }
  };

  const Icon = calm ? PlayIcon : PauseIcon;
  return (
    <button
      type="button"
      aria-pressed={calm}
      aria-label={messages.shell.pauseMotion}
      title={messages.shell.pauseMotion}
      onClick={flip}
      className={cn(
        "press-feedback flex size-11 cursor-pointer items-center justify-center rounded-full border-[1.5px] border-ink bg-surface text-ink",
        "aria-pressed:bg-yellow aria-pressed:text-on-yellow",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-5" strokeWidth={2} />
    </button>
  );
}
