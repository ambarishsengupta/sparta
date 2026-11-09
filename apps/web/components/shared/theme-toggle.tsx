// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

"use client";

// Light / dark switch. The choice is stored on this device only (localStorage) and
// written to <html data-theme>, which globals.css already styles; with nothing
// stored, the OS setting decides. A small script in the root layout applies the
// stored choice before first paint, so there is no flash.
//
// Switching ripples the new theme out from the pointer with the View Transitions
// API where supported. Reduced motion, or no support, swaps instantly.
import { useSyncExternalStore } from "react";

import { DarkIcon, LightIcon } from "@/components/shared/icons";
import { messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

export const THEME_KEY = "sparta-theme";

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

function isDark() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "dark") return true;
  if (explicit === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeToggle({ className }: { className?: string }) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  const flip = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next = dark ? "light" : "dark";
    const apply = () => {
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // Storage blocked: the choice lasts for this visit only.
      }
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !document.startViewTransition) return apply();

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX || rect.left + rect.width / 2;
    const y = e.clientY || rect.top + rect.height / 2;
    const root = document.documentElement;
    root.style.setProperty("--vt-x", `${x}px`);
    root.style.setProperty("--vt-y", `${y}px`);
    root.style.setProperty(
      "--vt-r",
      `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`,
    );
    document.startViewTransition(apply);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={messages.shell.darkMode}
      onClick={flip}
      className={cn(
        "press-feedback relative flex h-11 w-[5.25rem] cursor-pointer items-center rounded-full border-[1.5px] border-ink bg-surface",
        className,
      )}
    >
      {/* Sliding knob: translate only. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1 left-1 size-8 rounded-full border-[1.5px] border-flash-edge bg-yellow",
          "transition-transform duration-300 ease-spring",
          dark && "translate-x-[2.375rem]",
        )}
      />
      <LightIcon
        aria-hidden="true"
        strokeWidth={2}
        className={cn(
          "relative z-10 ml-2.5 size-5 transition-colors",
          dark ? "text-ink-soft" : "text-on-yellow",
        )}
      />
      <DarkIcon
        aria-hidden="true"
        strokeWidth={2}
        className={cn(
          "relative z-10 ml-auto mr-2.5 size-5 transition-colors",
          dark ? "text-on-yellow" : "text-ink-soft",
        )}
      />
    </button>
  );
}
