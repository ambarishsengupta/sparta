import { conditionBandOf } from '@sparta/taxonomy';
import { allowedInSlot, pairAllowed, passesSeason, placementsOf, usablePlacements } from './eligibility.js';
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

/** Step 2: group eligible items by slot, best first (pre-score, then item ID), best eight per slot. */
export function slotCandidates(eligible: readonly Item[], ctx: Ctx): Candidates {
  const groups: Candidates = { top: [], bottom: [], layer: [], footwear: [], both: [], belts: [] };
  for (const item of eligible) {
    for (const p of usablePlacements(item, ctx.occasion)) {
      groups[p.length === 2 ? 'both' : p[0] === 'accessory' ? 'belts' : (p[0] as keyof Candidates)].push(item);
    }
  }
  const order = (a: Item, b: Item): number => preScore(b, ctx) - preScore(a, ctx) || cmp(a.id, b.id);
  for (const key of Object.keys(groups) as (keyof Candidates)[]) groups[key].sort(order);
  const full = { bottom: groups.bottom, both: groups.both, footwear: groups.footwear };
  for (const key of Object.keys(groups) as (keyof Candidates)[]) {
    if (key !== 'belts') groups[key] = groups[key].slice(0, BEST_PER_SLOT);
  }
  return keepOnePair(groups, full, ctx);
}

/**
 * Trimming to the best eight can drop the only bottom that R1 lets a kept pair of shoes go with (nine shorts
 * and one pair of jeans under Casual, with formal shoes). If no kept bottom or suit pairs with a kept pair of
 * shoes but an untrimmed one does, the best such pair (by pre-score order) is added back.
 */
function keepOnePair(c: Candidates, full: Pick<Candidates, 'bottom' | 'both' | 'footwear'>, ctx: Ctx): Candidates {
  const ok = (bottoms: Item[], shoes: Item[]): boolean => bottoms.some((b) => shoes.some((f) => pairAllowed(b, f, ctx.occasion)));
  if (ok([...c.bottom, ...c.both], c.footwear)) return c;
  for (const f of full.footwear) {
    const b = full.bottom.find((x) => pairAllowed(x, f, ctx.occasion));
    const suit = full.both.find((x) => pairAllowed(x, f, ctx.occasion));
    const slot = b ? 'bottom' : 'both';
    const pick = b ?? suit;
    if (pick) return { ...c, footwear: c.footwear.includes(f) ? c.footwear : [...c.footwear, f], [slot]: [...c[slot], pick] };
  }
  return c;
}

/**
 * Step 3: every top x bottom x footwear x optional layer, plus top x (Suit or Tuxedo) x footwear.
 * Rule violations are pruned as early as they can be seen (pair rule before the layer loop, an item
 * that is both a top and a layer never used twice). Belts are not placed here. Order follows the
 * sorted candidates, so it does not depend on the input order.
 */
export function enumerateOutfits(c: Candidates, ctx: Ctx): Outfit[] {
  const out: Outfit[] = [];
  for (const top of c.top) {
    for (const footwear of c.footwear) {
      for (const bottom of c.bottom) {
        if (!pairAllowed(bottom, footwear, ctx.occasion)) continue;
        out.push({ ...emptyOutfit(), top, bottom, footwear });
        for (const layer of c.layer) if (layer.id !== top.id) out.push({ ...emptyOutfit(), top, bottom, layer, footwear });
      }
      for (const suit of c.both) {
        if (pairAllowed(suit, footwear, ctx.occasion)) out.push({ ...emptyOutfit(), top, bottom: suit, layer: suit, footwear });
      }
    }
  }
  return out;
}

/**
 * The hard rules an outfit breaks, empty when it is valid: SLOTS (a top, a bottom and footwear),
 * R2 (season, active), R1 (occasion, per slot and footwear with bottom) and DUPLICATE (an item in
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
    if (item.status !== 'active' || !passesSeason(item, season)) problems.add('R2');
    if (!allowedInSlot(item, slot, ctx.occasion)) problems.add('R1');
  }
  for (const { item, slots } of held.values()) {
    const key = [...slots].sort().join();
    if (!placementsOf(item).some((p) => [...p].sort().join() === key)) problems.add('DUPLICATE');
  }
  if (outfit.bottom && outfit.footwear && !pairAllowed(outfit.bottom, outfit.footwear, ctx.occasion)) problems.add('R1');
  return [...problems].sort();
}
