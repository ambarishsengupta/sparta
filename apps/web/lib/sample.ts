// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// Demo content for the four consumer tabs until the data layer arrives (M2 to M4).
// Every record points at an item in lib/catalogue.ts SAMPLE, so the tabs agree with
// each other: the outfit uses shirts you "own", the wishlist holds things you don't.
// All values are invented for the academic demo and every screen says so.
import { type CatalogueItem, SAMPLE } from "@/lib/catalogue";

const byId = new Map(SAMPLE.map((i) => [i.id, i]));
export const item = (id: string): CatalogueItem => {
  const found = byId.get(id);
  if (!found) throw new Error(`sample item ${id} missing`);
  return found;
};

/** Items the demo user already owns, with how often each was worn. */
export const OWNED: { id: string; worn: number }[] = [
  { id: "s1", worn: 14 },
  { id: "s2", worn: 9 },
  { id: "s3", worn: 21 },
  { id: "s5", worn: 17 },
  { id: "s6", worn: 4 },
  { id: "s9", worn: 6 },
  { id: "s10", worn: 3 },
  { id: "s11", worn: 8 },
];

export type Outfit = { id: string; occasion: string; when: string; items: string[] };

export const OUTFITS: Outfit[] = [
  { id: "o1", occasion: "Office", when: "Monday", items: ["s1", "s2", "s11"] },
  { id: "o2", occasion: "Weekend brunch", when: "Saturday", items: ["s10", "s5", "s3"] },
  { id: "o3", occasion: "Festive evening", when: "Diwali", items: ["s6", "s9", "s11"] },
];

export type Wish = { id: string; target: number; plan: string; note: string };

export const WISHLIST: Wish[] = [
  { id: "s4", target: 1600, plan: "December", note: "For winter office days" },
  { id: "s8", target: 600, plan: "Next sale", note: "Replace old pair" },
  { id: "s12", target: 500, plan: "January", note: "Goes with the bomber" },
  { id: "s7", target: 350, plan: "Any time", note: "Brown belt is worn out" },
];

export type Purchase = { id: string; item: string; date: string; paid: number; receipt: boolean };

export const PURCHASES: Purchase[] = [
  { id: "p1", item: "s3", date: "2 Nov 2026", paid: 2799, receipt: true },
  { id: "p2", item: "s10", date: "19 Oct 2026", paid: 1099, receipt: true },
  { id: "p3", item: "s6", date: "12 Oct 2026", paid: 999, receipt: false },
  { id: "p4", item: "s11", date: "28 Sep 2026", paid: 3299, receipt: true },
];
