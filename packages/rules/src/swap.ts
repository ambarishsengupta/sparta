import { rgbToLab } from '@sparta/taxonomy';
import { outfitProblems } from './combinations.js';
import type { Outfit } from './combinations.js';
import { usablePlacements } from './eligibility.js';
import type { Ctx, Item, ItemId, Slot, Suggestion } from './types.js';

/** Shape numbers of a photo item (LLD 9.5.1); absent for other items. */
export interface ShapeFeatures {
  modelVersion: string;
  embedding: number[];
}

const SLOTS: readonly Slot[] = ['top', 'bottom', 'layer', 'footwear', 'accessory'];

/**
 * Swap choices (LLD 9.5.1): active items outside the outfit that fill `slot` and keep it valid under R1, R2
 * and the slots (a Suit swapped out leaves its other slot empty), ordered by `0.6 * shape + 0.4 * colour`,
 * ties by item ID. Shape is 1 for the same sub-type, else 0.4: no embeddings exist yet, so `features` is
 * accepted but not read until the learned part (R4). Colour is `1 - min(deltaE / 100, 1)` (CIE76).
 */
export function swapChoices(
  outfit: Suggestion, slot: Slot, items: readonly Item[], features: Readonly<Record<ItemId, ShapeFeatures>>, ctx: Ctx,
): ItemId[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const base = Object.fromEntries(SLOTS.map((s) => [s, byId.get(outfit.items[s] ?? '') ?? null])) as Outfit;
  const replaced = base[slot];
  const taken = new Set(SLOTS.flatMap((s) => base[s]?.id ?? []));
  const valid = (candidate: Item): boolean =>
    usablePlacements(candidate, ctx.occasion).some((placement) => {
      if (!placement.includes(slot)) return false;
      const next = { ...base };
      for (const s of SLOTS) if (replaced && next[s]?.id === replaced.id) next[s] = null;
      for (const s of placement) next[s] = candidate;
      return outfitProblems(next, ctx).length === 0;
    });
  const similarity = (c: Item): number => {
    if (!replaced) return 0;
    const shape = c.subType === replaced.subType ? 1 : 0.4;
    const [p, q] = [rgbToLab(...replaced.rgb), rgbToLab(...c.rgb)];
    const deltaE = Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2);
    return 0.6 * shape + 0.4 * (1 - Math.min(deltaE / 100, 1));
  };
  return items
    .filter((i) => i.status === 'active' && !taken.has(i.id) && valid(i))
    .map((i) => ({ id: i.id, sim: similarity(i) }))
    .sort((a, b) => b.sim - a.sim || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => c.id);
}
