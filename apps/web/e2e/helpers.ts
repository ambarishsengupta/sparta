// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

import type { Page } from "@playwright/test";

export const TABS = [
  { key: "wardrobe", label: "Wardrobe", href: "/wardrobe", pop: "tangerine" },
  { key: "outfits", label: "Outfits", href: "/outfits", pop: "cobalt" },
  { key: "wishlist", label: "Wishlist", href: "/wishlist", pop: "pink" },
  { key: "purchases", label: "Purchases", href: "/purchases", pop: "yellow" },
  { key: "me", label: "Me", href: "/me", pop: "cyan" },
] as const;

/** Wait for fonts and for every finite, time-based animation and transition to finish. */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Time-based animations only: scroll-driven ones (animation-timeline: view())
    // finish when the page scrolls, not with time, so waiting on them would hang.
    const finite = document
      .getAnimations()
      .filter(
        (a) =>
          a.timeline instanceof DocumentTimeline &&
          a.effect?.getComputedTiming().iterations !== Infinity,
      );
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
}

/** A token's value resolved by the browser to rgb(), for comparing with computed styles. */
export async function tokenRgb(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
}
