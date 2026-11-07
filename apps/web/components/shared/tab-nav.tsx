// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

"use client";

// Level-1 navigation (plan 2.1): a bottom tab bar under 1024 px and a 96 px left
// rail at 1024 px and over. Same five places, same order, never mixed.
// The active tab gets a pill in its own pop colour; the pill stretches in and the
// icon lands like a block-print stamp once (CSS only, plan 4.2 fallback; instant under reduced motion).
import Link from "next/link";
import { usePathname } from "next/navigation";

import { TAB_ICONS } from "@/components/shared/icons";
import { messages } from "@/lib/i18n/messages";
import { POP_CLASS, TAB_KEYS, TABS } from "@/lib/tabs";
import { cn } from "@/lib/utils";

export function TabNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label={messages.shell.navLabel}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 bg-surface pt-2.5",
        "pb-[env(safe-area-inset-bottom)]",
        "lg:inset-y-0 lg:right-auto lg:left-0 lg:w-24 lg:pt-0 lg:pr-2.5 lg:pb-0",
      )}
    >
      {/* Bel border (woven diamond chain) on the edge that meets the page. */}
      <span aria-hidden="true" className="bel-edge-x absolute inset-x-0 top-0 h-2.5 lg:hidden" />
      <span
        aria-hidden="true"
        className="bel-edge-y absolute inset-y-0 right-0 hidden w-2.5 lg:block"
      />
      <p aria-hidden="true" className="hidden pt-6 pb-6 text-center lg:block">
        <span className="block font-heading text-xl leading-none text-ink">
          {messages.app.name}
        </span>
      </p>
      <ul className="mx-auto grid max-w-xl grid-cols-5 lg:flex lg:max-w-none lg:flex-col lg:gap-1">
        {TAB_KEYS.map((key) => {
          const tab = TABS[key];
          const Icon = TAB_ICONS[key];
          const current = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={key} className={POP_CLASS[tab.pop]}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "group flex min-h-16 flex-col items-center justify-center gap-1 rounded-tile px-1 py-2",
                  "press-feedback",
                  "text-xs font-medium text-ink-soft",
                  "aria-[current=page]:font-semibold aria-[current=page]:text-ink",
                  "focus-visible:-outline-offset-2",
                )}
              >
                <span className="relative flex h-8 w-14 items-center justify-center">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-0 rounded-full border-[1.5px] border-flash-edge bg-pop",
                      "scale-x-50 opacity-0 transition-[transform,opacity] duration-200 ease-snap",
                      "group-aria-[current=page]:scale-x-100 group-aria-[current=page]:opacity-100",
                    )}
                  />
                  <Icon
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="relative size-6 group-aria-[current=page]:animate-tab-tilt group-aria-[current=page]:text-on-pop"
                  />
                </span>
                <span>{messages.tabs[key].label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
