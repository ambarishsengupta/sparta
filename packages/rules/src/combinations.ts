import { conditionBandOf } from '@sparta/taxonomy';
import { allowedInSlot, comboAllowed, layerRequiredIfAvailable, passesSeason, placementsOf, usablePlacements } from './eligibility.js';
import { seasonFor } from './season.js';
import type { Ctx, Item, Slot } from './types.js';

export type Outfit = Record<Slot, Item | null>;
/** Slot candidates (step 2). `both` holds Suit and Tuxedo, which fill layer and bottom at once. */
export interface Candidates {
  top: Item[];
  bottom: Item[];
  layer: Item[];
  footwear: Item[];
  both: Item[];
  belts: Item[];
}

const BEST_PER_SLOT = 8;
const SLOTS: readonly Slot[] = ['top', 'bottom', 'layer', 'footwear', 'accessory'];
const emptyOutfit = (): Outfit => ({ top: null, bottom: null, layer: null, footwear: null, accessory: null });
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Cheap pre-score (step 2): occasion tag match (no tags counts half), then condition not Falling apart. */
export function preScore(item: Item, ctx: Ctx): number {
  const match = item.occasions.length === 0 ? 0.5 : item.occasions.includes(ctx.occasion) ? 1 : 0;
  const wornOut = item.condition !== null && conditionBandOf(item.condition) === 'Falling apart';
  return 2 * match + (wornOut ? 0 : 1);
}

/** Step 2: group eligible items by slot, best first (pre-score, then item ID), best `limit` (eight) per slot; `keepOne` false skips the add-back below (Wardrobe unlock keeps its bound exact). */
export function slotCandidates(eligible: readonly Item[], ctx: Ctx, limit = BEST_PER_SLOT, keepOne = true): Candidates {
  const groups: Candidates = { top: [], bottom: [], layer: [], footwear: [], both: [], belts: [] };
  for (const item of eligible) {
    for (const p of usablePlacements(item, ctx.occasion)) {
      groups[p.length === 2 ? 'both' : p[0] === 'accessory' ? 'belts' : (p[0] as keyof Candidates)].push(item);
    }
  }
  const order = (a: Item, b: Item): number => preScore(b, ctx) - preScore(a, ctx) || cmp(a.id, b.id);
  for (const key of Object.keys(groups) as (keyof Candidates)[]) groups[key].sort(order);
  const full = { top: groups.top, bottom: groups.bottom, layer: groups.layer, both: groups.both, footwear: groups.footwear };
  for (const key of Object.keys(groups) as (keyof Candidates)[]) {
    if (key !== 'belts') groups[key] = groups[key].slice(0, limit);
  }
  return keepOne ? keepOneOutfit(groups, full, ctx) : groups;
}

export type Pool = Pick<Candidates, 'top' | 'bottom' | 'layer' | 'both' | 'footwear'>;
type Found = { top: Item; bottom: Item; footwear: Item; layer?: Item };

/**
 * The first allowed outfit in pre-score order: top, footwear, then bottom (or suit) and, if `layered`, a layer to go with
 * it (a Suit or Tuxedo being its own layer). Same pruning as `enumerateOutfits`, so it finds exactly what that would.
 */
export function firstOutfit(g: Pool, ctx: Ctx, layered: boolean): Found | null {
  for (const top of g.top) for (const footwear of g.footwear) {
    if (!comboAllowed({ top, footwear }, ctx.occasion)) continue;
    if (!layered) {
      const bottom = [...g.bottom, ...g.both].find((b) => comboAllowed({ top, bottom: b, footwear }, ctx.occasion));
      if (bottom) return { top, bottom, footwear };
      continue;
    }
    for (const bottom of g.bottom) {
      if (!comboAllowed({ top, bottom, footwear }, ctx.occasion)) continue;
      const layer = g.layer.find((l) => l.id !== top.id && comboAllowed({ top, bottom, layer: l, footwear }, ctx.occasion));
      if (layer) return { top, bottom, footwear, layer };
    }
    const suit = g.both.find((b) => comboAllowed({ top, bottom: b, layer: b, footwear }, ctx.occasion));
    if (suit) return { top, bottom: suit, footwear, layer: suit };
  }
  return null;
}

/**
 * Trimming to the best eight can drop every top, bottom, layer or pair of shoes that R1 lets the others go with (nine
 * shorts and one pair of jeans under Casual with formal shoes; eight T-shirts and one shirt with formal shoes; eight
 * hoodies and one jacket with formal shoes in winter). If the kept ones form no allowed outfit but untrimmed ones do,
 * the first such outfit (by pre-score order) is added back. Where a layer is wanted (D-A) the outfit looked for is a
 * layered one, so `withRequiredLayer` is decided on all the candidates, not only on the best eight.
 */
function keepOneOutfit(c: Candidates, full: Pool, ctx: Ctx): Candidates {
  const wantLayer = layerRequiredIfAvailable(ctx);
  const pick = (wantLayer && !firstOutfit(c, ctx, true) ? firstOutfit(full, ctx, true) : null) ?? (firstOutfit(c, ctx, false) ? null : firstOutfit(full, ctx, false));
  if (!pick) return c;
  const add = (list: Item[], x: Item): Item[] => (list.includes(x) ? list : [...list, x]);
  const suit = full.both.includes(pick.bottom);
  const next = { ...c, top: add(c.top, pick.top), footwear: add(c.footwear, pick.footwear) };
  if (pick.layer && !suit) next.layer = add(c.layer, pick.layer);
  return suit ? { ...next, both: add(c.both, pick.bottom) } : { ...next, bottom: add(c.bottom, pick.bottom) };
}

/**
 * Step 3: every top x bottom x footwear x optional layer, plus top x (Suit or Tuxedo) x footwear.
 * Rule violations are pruned as early as they can be seen (pair rule before the layer loop, an item
 * that is both a top and a layer never used twice). Belts are not placed here. Order follows the
 * sorted candidates, so it does not depend on the input order.
 */
export function enumerateOutfits(c: Candidates, ctx: Ctx): Outfit[] {
  const out: Outfit[] = [];
  const ok = (o: Partial<Record<Slot, Item>>): boolean => comboAllowed(o, ctx.occasion);
  for (const top of c.top) {
    for (const footwear of c.footwear) {
      if (!ok({ top, footwear })) continue;
      for (const bottom of c.bottom) {
        if (!ok({ top, bottom, footwear })) continue;
        out.push({ ...emptyOutfit(), top, bottom, footwear });
        for (const layer of c.layer) if (layer.id !== top.id && ok({ top, bottom, layer, footwear })) out.push({ ...emptyOutfit(), top, bottom, layer, footwear });
      }
      for (const suit of c.both) {
        if (ok({ top, bottom: suit, layer: suit, footwear })) out.push({ ...emptyOutfit(), top, bottom: suit, layer: suit, footwear });
      }
    }
  }
  return out;
}

/**
 * "Layer if available" (D-A): Formal ("blazer if available", FDD R1) and the cool seasons (FDD R2) drop outfits without
 * a layer, a Suit or Tuxedo counting as one, but only when some outfit in the list has a layer; else the list is as it was.
 */
export function withRequiredLayer(outfits: Outfit[], ctx: Ctx): Outfit[] {
  if (!layerRequiredIfAvailable(ctx)) return outfits;
  const layered = outfits.filter((o) => o.layer !== null);
  return layered.length > 0 ? layered : outfits;
}

/**
 * The hard rules an outfit breaks, empty when it is valid: SLOTS (a top, a bottom and footwear),
 * R2 (season, active), R1 (occasion, per slot and the pieces together) and DUPLICATE (an item in
 * slots it cannot fill together, so an item is never used twice; a Suit is one item in two slots).
 */
export function outfitProblems(outfit: Outfit, ctx: Ctx): string[] {
  const problems = new Set<string>();
  if (!outfit.top || !outfit.bottom || !outfit.footwear) problems.add('SLOTS');
  const season = seasonFor(ctx.date, ctx.hemisphere);
  const held = new Map<string, { item: Item; slots: Slot[] }>();
  for (const slot of SLOTS) {
    const item = outfit[slot];
    if (!item) continue;
    held.set(item.id, { item, slots: [...(held.get(item.id)?.slots ?? []), slot] });
    if (item.status !== 'active' || !passesSeason(item, season, ctx.occasion)) problems.add('R2');
    if (!allowedInSlot(item, slot, ctx.occasion)) problems.add('R1');
  }
  for (const { item, slots } of held.values()) {
    const key = [...slots].sort().join();
    if (!placementsOf(item).some((p) => [...p].sort().join() === key)) problems.add('DUPLICATE');
  }
  if (!comboAllowed(outfit, ctx.occasion)) problems.add('R1');
  return [...problems].sort();
}
