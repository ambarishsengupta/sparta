// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// The five consumer tabs, in FDD section 3 order, with their locked pop colours
// (plan 2.2 and 4.3). Bottom bar and rail both render from this one list.

export const TAB_KEYS = ["wardrobe", "outfits", "wishlist", "purchases", "me"] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export type Pop = "tangerine" | "cobalt" | "pink" | "yellow" | "cyan";

export const TABS: Record<TabKey, { href: `/${TabKey}`; pop: Pop }> = {
  wardrobe: { href: "/wardrobe", pop: "tangerine" },
  outfits: { href: "/outfits", pop: "cobalt" },
  wishlist: { href: "/wishlist", pop: "pink" },
  purchases: { href: "/purchases", pop: "yellow" },
  me: { href: "/me", pop: "cyan" },
};

// Literal class names so Tailwind's scanner finds them.
export const POP_CLASS: Record<Pop, string> = {
  tangerine: "pop-tangerine",
  cobalt: "pop-cobalt",
  pink: "pop-pink",
  yellow: "pop-yellow",
  cyan: "pop-cyan",
};
