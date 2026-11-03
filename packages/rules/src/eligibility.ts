import { isSuggestable, rgbToLab, slotAssignmentOf } from '@sparta/taxonomy';
import type { Occasion } from '@sparta/taxonomy';
import rulesJson from '../data/rules.json';
import { seasonFor } from './season.js';
import type { CurrentSeason, Ctx, Item, OccasionRule, Rules, Slot } from './types.js';

export const RULES = rulesJson as unknown as Rules;

/** CIELAB lightness L* and chroma C* of the primary colour (same conversion as the colour family). */
export function lightnessAndChroma(item: Item): { L: number; C: number } {
  const [L, a, b] = rgbToLab(...item.rgb);
  return { L, C: Math.sqrt(a * a + b * b) };
}

/** The R1 rule of an occasion; Date and Travel use the Casual entry (FDD 14.1). */
export function occasionRule(occasion: Occasion): OccasionRule {
  const entry = RULES.occasions[occasion];
  return 'uses' in entry ? occasionRule(entry.uses) : entry;
}

/** R2: the item's seasons include the current season or All year, or none are set; Summer drops coats and heavy knits. */
export function passesSeason(item: Item, season: CurrentSeason): boolean {
  const { seasons } = item;
  if (seasons.length > 0 && !seasons.includes(season) && !seasons.includes('All year')) return false;
  return !(RULES.season_rules[season]?.excluded_sub_types ?? []).includes(item.subType);
}

/**
 * Each way an item can sit in an outfit, as the slots it then occupies (FDD 14.1 slot map):
 * Top-or-Layer items have two single-slot placements, Suit and Tuxedo one placement of two slots,
 * Belt the accessory slot. Other accessories, and underwear and socks, are never placed.
 */
export function placementsOf(item: Item): Slot[][] {
  if (item.category === 'Accessories') return item.subType === 'Belt' ? [['accessory']] : [];
  const a = slotAssignmentOf(item.subType);
  if (!a || !isSuggestable(item.subType)) return [];
  const slots = a.slots.map((s) => s.toLowerCase() as Slot);
  return a.fill === 'either' ? slots.map((s) => [s]) : [slots];
}

/** R1 for one item in one slot: sub-type allowed there, and for Party tops a dark or bold colour. */
export function allowedInSlot(item: Item, slot: Slot, occasion: Occasion): boolean {
  if (slot === 'accessory') return true;
  const rule = occasionRule(occasion);
  const list = rule.slots[slot];
  if (list && !list.includes(item.subType)) return false;
  if (slot === 'top' && rule.top_colour === 'dark_or_bold') {
    const { L, C } = lightnessAndChroma(item);
    return L < RULES.thresholds.dark_lightness_below || C > RULES.thresholds.bold_chroma_above;
  }
  return true;
}

/** R1 for a footwear and bottom together (casual: no formal shoes with shorts). */
export function pairAllowed(bottom: Item, footwear: Item, occasion: Occasion): boolean {
  return !occasionRule(occasion).forbidden_pairs.some(
    ([f, b]) => footwear.subType === f && bottom.subType === b,
  );
}

/** The placements of an item that R1 allows for the occasion. */
export function usablePlacements(item: Item, occasion: Occasion): Slot[][] {
  return placementsOf(item).filter((p) => p.every((s) => allowedInSlot(item, s, occasion)));
}

/**
 * Step 1, hard rules R1 and R2: active items that pass the season filter and can sit in at least one
 * slot under the occasion's R1 rule. LLD 9.5 step 1 also keeps items whose occasion tags match; a tag
 * alone never lets an item break R1 (FDD 14.1), so tags are used for scoring only (an item admitted
 * by a tag alone could not appear in any outfit, so the suggestions are the same either way).
 */
export function eligibleItems(items: readonly Item[], ctx: Ctx): Item[] {
  const season = seasonFor(ctx.date, ctx.hemisphere);
  return items.filter(
    (i) => i.status === 'active' && passesSeason(i, season) && usablePlacements(i, ctx.occasion).length > 0,
  );
}
