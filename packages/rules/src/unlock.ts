import { COLOUR_FAMILIES, OCCASIONS, SUB_TYPES, categoryOfSubType, hexToRgb, referenceSwatch } from '@sparta/taxonomy';
import type { ColourFamily, SubType } from '@sparta/taxonomy';
import fallbackJson from '../data/unlock-fallback.json';
import { anchoredOutfits } from './anchor.js';
import { firstOutfit, slotCandidates } from './combinations.js';
import { RULES, eligibleItems, layerRequiredIfAvailable, usablePlacements } from './eligibility.js';
import { outfitPairing, parsePrior } from './pairing.js';
import { MAX_SUGGESTIONS } from './rank.js';
import { createScorer } from './score.js';
import type { Ctx, Item } from './types.js';

export interface Candidate { sub_type: SubType; colour_family: ColourFamily }
/** `newOutfits` is exact over the bounded sets (LLD 9.5.2). */
export interface UnlockSuggestion { subType: SubType; colourFamily: ColourFamily; newOutfits: number }
/** `unlockList: 'hm'` with a valid `hm` list (the contents of `unlock-candidates.json`) uses it; anything else uses the committed fallback list. */
export interface UnlockOpts { unlockList?: 'fallback' | 'hm'; hm?: unknown; prior?: unknown }

export const MAX_CANDIDATES = 40;
export const FALLBACK_LIST = fallbackJson as Candidate[];

/** A candidate list read defensively: an array of at most 40 `{sub_type, colour_family}` taxonomy values, else null. */
export function parseCandidates(raw: unknown): Candidate[] | null {
  const valid = (c: unknown): c is Candidate => {
    const o = c as Record<string, unknown> | null;
    return typeof o === 'object' && o !== null && Object.keys(o).sort().join() === 'colour_family,sub_type' && SUB_TYPES.includes(o.sub_type as SubType) && COLOUR_FAMILIES.includes(o.colour_family as ColourFamily);
  };
  return Array.isArray(raw) && raw.length <= MAX_CANDIDATES && raw.every(valid) ? raw.map((c) => ({ sub_type: c.sub_type, colour_family: c.colour_family })) : null;
}

/** The list in use and its name: the H&M list only when it is asked for and valid (LLD 9.5.2). */
export function candidateList(opts: UnlockOpts = {}): { list: Candidate[]; source: 'fallback' | 'hm' } {
  const hm = opts.unlockList === 'hm' ? parseCandidates(opts.hm) : null;
  return hm ? { list: hm, source: 'hm' } : { list: FALLBACK_LIST, source: 'fallback' };
}

/** The pretend item: all year, solid, the first swatch of the family, the occasions the table allows its sub-type for; null if the family has no swatch (Multi). */
export function pretendItem(c: Candidate): Item | null {
  const swatch = referenceSwatch(c.colour_family);
  if (!swatch) return null;
  const id = `__unlock:${c.sub_type}:${c.colour_family}`;
  const item: Item = {
    id, name: id, category: categoryOfSubType(c.sub_type)!, subType: c.sub_type, rgb: hexToRgb(swatch.hex), colourFamily: c.colour_family, pattern: 'Solid',
    seasons: ['All year'], occasions: [], condition: null, favourite: false, status: 'active',
  };
  return { ...item, occasions: OCCASIONS.filter((o) => usablePlacements(item, o).length > 0) };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Wardrobe unlock (LLD 9.5.2): for each candidate, count the outfits that contain one pretend item, built from the eligible items bounded at
 * `unlock_bound_per_slot` per slot, that pass the hard rules (R1, R2, the slots) and have `rule_fit` of at least `unlock_min_rule_fit`
 * (outfits are the top, bottom, footwear and optional layer of step 3, with no belt). One entry per sub-type (its best colour), the three with
 * the largest count, ties by mean rule_fit of the counted outfits, then mean pairing if a valid prior is passed, then names.
 * Decision D-A applies, so unlock never promises an outfit that `suggest` would not show: where a layer is wanted (`layerRequiredIfAvailable`)
 * and a layered outfit exists among the wardrobe and the pretend item (same bounded sets), only layered outfits are counted.
 */
export function unlock(items: readonly Item[], ctx: Ctx, opts: UnlockOpts = {}): UnlockSuggestion[] {
  const prior = parsePrior(opts.prior);
  const base = slotCandidates(eligibleItems(items, ctx), ctx, RULES.unlock_bound_per_slot, false);
  const scorer = createScorer(ctx, false);
  const wardrobeLayered = layerRequiredIfAvailable(ctx) && firstOutfit(base, ctx, true) !== null; // any outfit without the pretend item sees it
  const rows = candidateList(opts).list.flatMap((c) => {
    const pretend = pretendItem(c);
    if (!pretend || eligibleItems([pretend], ctx).length === 0) return [];
    let [n, fit, pair] = [0, 0, 0];
    const outfits = usablePlacements(pretend, ctx.occasion).flatMap((placement) => anchoredOutfits(base, pretend, placement, ctx));
    const layeredOnly = layerRequiredIfAvailable(ctx) && (wardrobeLayered || outfits.some((o) => o.layer !== null)); // D-A
    for (const outfit of layeredOnly ? outfits.filter((o) => o.layer !== null) : outfits) {
      const f = scorer.ruleFit(outfit);
      if (f < RULES.unlock_min_rule_fit) continue;
      [n, fit, pair] = [n + 1, fit + f, pair + (prior ? outfitPairing(prior, outfit) : 0)];
    }
    return n > 0 ? [{ c, n, fit: fit / n, pair: pair / n }] : [];
  });
  rows.sort((a, b) => b.n - a.n || b.fit - a.fit || b.pair - a.pair || cmp(a.c.sub_type, b.c.sub_type) || cmp(a.c.colour_family, b.c.colour_family));
  const firstOfEach = rows.filter((r, i) => rows.findIndex((o) => o.c.sub_type === r.c.sub_type) === i);
  return firstOfEach.slice(0, MAX_SUGGESTIONS).map((r) => ({ subType: r.c.sub_type, colourFamily: r.c.colour_family, newOutfits: r.n }));
}
