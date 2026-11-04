import { isSuggestable, rgbToLab, slotAssignmentOf } from '@sparta/taxonomy';
import type { Occasion, Pattern, SubType } from '@sparta/taxonomy';
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

/**
 * Fix loop 1 (D-A) flags in rules.json: Formal ("blazer if available") and the `cool_seasons` ask for a layer
 * when one is possible. They are typed here, not in types.ts, because that file is outside WO-0006.
 */
export function layerRequiredIfAvailable(ctx: Ctx): boolean {
  const flags = RULES as unknown as { cool_season_layer_required_if_available?: boolean };
  const formal = (occasionRule(ctx.occasion) as OccasionRule & { layer_required_if_available?: boolean }).layer_required_if_available;
  return !!formal || (!!flags.cool_season_layer_required_if_available && RULES.cool_seasons.includes(seasonFor(ctx.date, ctx.hemisphere)));
}

/**
 * The style fields WO-0007 added to an occasion entry (AI style review, draft data). They are typed here, not in
 * types.ts, because that file is outside WO-0007: sub-types a slot refuses, formal shoes with a top or layer,
 * patterns a top may not have, the bold-item cap (hard) and the non-neutral colour family limit (scored in R3).
 */
export interface StyleRule extends OccasionRule {
  excluded_sub_types?: Partial<Record<Exclude<Slot, 'accessory'>, SubType[]>>;
  forbidden_top_footwear?: [footwear: SubType, top: SubType][];
  top_forbidden_patterns?: Pattern[];
  max_bold_items?: number;
  max_non_neutral_families?: number;
}
export const styleRule = (occasion: Occasion): StyleRule => occasionRule(occasion);

/** Sub-types a season refuses, minus those an occasion keeps (`exempt`: Sport keeps Sports shorts in winter). */
type SeasonRule = { excluded_sub_types: SubType[]; exempt?: Partial<Record<Occasion, SubType[]>> };

/**
 * R2: the item's seasons include the current season or All year, or none are set; the season may refuse sub-types
 * (Summer: coats and heavy knits; draft winter and autumn exclusions), except those the occasion is exempt for.
 */
export function passesSeason(item: Item, season: CurrentSeason, occasion?: Occasion): boolean {
  const { seasons } = item;
  if (seasons.length > 0 && !seasons.includes(season) && !seasons.includes('All year')) return false;
  const rule = RULES.season_rules[season] as SeasonRule | undefined;
  const kept = (occasion && rule?.exempt?.[occasion]) || [];
  return !(rule?.excluded_sub_types ?? []).includes(item.subType) || kept.includes(item.subType);
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
  const rule = styleRule(occasion);
  const list = rule.slots[slot];
  if (list && !list.includes(item.subType)) return false;
  if (rule.excluded_sub_types?.[slot]?.includes(item.subType)) return false;
  if (slot === 'top' && item.pattern && rule.top_forbidden_patterns?.includes(item.pattern)) return false;
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

const boldCache = new WeakMap<Item, boolean>();
/** Bold: a non-neutral colour family with chroma above the bold threshold (the same test R3 scores with). */
const isBold = (item: Item): boolean => {
  let bold = boldCache.get(item);
  if (bold === undefined) {
    bold = !RULES.neutral_colour_families.includes(item.colourFamily) && lightnessAndChroma(item).C > RULES.thresholds.bold_chroma_above;
    boldCache.set(item, bold);
  }
  return bold;
};

/**
 * R1 across the pieces of one outfit: the bottom and footwear pair, formal shoes with a forbidden top or layer
 * (Casual, Date, Travel), and the bold-item cap (Work: at most one among top, bottom, layer and footwear; a Suit counts once).
 * Missing pieces are skipped, so it can prune a partly built outfit.
 */
export function comboAllowed(o: Partial<Record<Slot, Item | null>>, occasion: Occasion): boolean {
  const { top, bottom, layer, footwear } = o;
  const rule = styleRule(occasion);
  if (bottom && footwear && !pairAllowed(bottom, footwear, occasion)) return false;
  if (footwear && [top, layer].some((p) => p && rule.forbidden_top_footwear?.some(([f, t]) => f === footwear.subType && t === p.subType))) return false;
  return rule.max_bold_items === undefined || new Set([top, bottom, layer, footwear].filter((i) => i && isBold(i))).size <= rule.max_bold_items;
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
    (i) => i.status === 'active' && passesSeason(i, season, ctx.occasion) && usablePlacements(i, ctx.occasion).length > 0,
  );
}
