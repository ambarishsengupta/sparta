import type { ColourFamily } from '@sparta/taxonomy';
import { anchorReason, anchored, anchoredOutfits, checkAnchor } from './anchor.js';
import { enumerateOutfits, slotCandidates, withRequiredLayer } from './combinations.js';
import type { Candidates, Outfit } from './combinations.js';
import { eligibleItems, usablePlacements } from './eligibility.js';
import { parsePrior } from './pairing.js';
import { pickVariety, toScored } from './rank.js';
import type { Scored } from './rank.js';
import { reasonsFor } from './reasons.js';
import { createScorer, itemsOf } from './score.js';
import type { ScoreParts } from './score.js';
import type { Ctx, Item, Missing, Slot, Suggestion, SuggestOpts } from './types.js';

/** A suggestion with the parts of its score, for the review pack and for tests (an extension of LLD 9.5). */
export type RankedSuggestion = Suggestion & { parts: ScoreParts };

const BELTS_PER_FAMILY = 8;
const SLOTS: readonly Slot[] = ['top', 'bottom', 'layer', 'footwear', 'accessory'];

/** FR-54: the slots with no candidate; when every slot has one, R1 forbids each pairing of bottom and footwear. */
export function missingSlots(c: Candidates): string[] {
  const missing = [
    ...(c.top.length === 0 ? ['top'] : []),
    ...(c.bottom.length === 0 && c.both.length === 0 ? ['bottom'] : []),
    ...(c.footwear.length === 0 ? ['footwear'] : []),
  ];
  return missing.length > 0 ? missing : ['bottom', 'footwear'];
}

export const isMissing = (result: RankedSuggestion[] | Missing): result is Missing => !Array.isArray(result);

/**
 * Steps 1 to 4 for every outfit that passes the hard rules, scored and not yet picked from (also what the tests compare with and without the prior).
 * With `anchor`, only that item is a candidate for its slot or slots and both placements of a Sweater, Cardigan or Hoodie are merged (LLD 9.5.2).
 * With a valid `prior`, `pairing` is added to the score parts and `weights_with_pairing` apply; the prior never takes part in the hard rules.
 */
export function rankedPool(items: readonly Item[], ctx: Ctx, opts: SuggestOpts = {}): { pool: Scored[]; anchor?: Item } | Missing {
  const anchor = opts.anchor === undefined ? undefined : checkAnchor(items, opts.anchor, ctx);
  if (anchor && 'missing' in anchor) return anchor;
  const eligible = eligibleItems(items, ctx).filter((i) => i.id !== anchor?.id);
  const placements = anchor ? usablePlacements(anchor, ctx.occasion) : [];
  const outfitsFor = (c: Candidates): Outfit[] => (anchor ? placements.flatMap((p) => anchoredOutfits(c, anchor, p, ctx)) : enumerateOutfits(c, ctx));
  let candidates = slotCandidates(eligible, ctx);
  let all = outfitsFor(candidates);
  if (anchor && all.length === 0) {
    candidates = slotCandidates(eligible, ctx, Infinity); // the best eight may have hidden every partner of the anchor
    all = outfitsFor(candidates);
  }
  const outfits = withRequiredLayer(all, ctx);
  if (outfits.length === 0) return { missing: missingSlots(anchor ? anchored(candidates, anchor, placements[0]!) : candidates) };
  const scorer = createScorer(ctx, candidates.belts.length > 0, parsePrior(opts.prior));
  const beltsByFamily = new Map<ColourFamily, Item[]>();
  for (const belt of candidates.belts) {
    const list = beltsByFamily.get(belt.colourFamily) ?? [];
    if (list.length < BELTS_PER_FAMILY) beltsByFamily.set(belt.colourFamily, [...list, belt]);
  }
  const withBelt = (outfit: Outfit): Outfit => {
    const options = outfit.footwear ? beltsByFamily.get(outfit.footwear.colourFamily) ?? [] : [];
    let best: Item | undefined;
    let bestHarmony = -1;
    for (const belt of options) {
      const harmony = scorer.harmony([...itemsOf(outfit), belt]);
      if (harmony > bestHarmony) [best, bestHarmony] = [belt, harmony];
    }
    return best ? { ...outfit, accessory: best } : outfit;
  };
  return { pool: outfits.map((o) => withBelt(o)).map((o) => toScored(o, scorer.evaluate(o))), anchor };
}

/**
 * LLD 9.5 steps 1 to 7: hard rules (WO-0003), R3 to R6 scoring with the best belt in the shoes' colour family, R7 picks up to three,
 * R8 reasons. `opts.anchor` is Complete the look (LLD 9.5.2: `anchor_not_offered` or `anchor_not_valid` come back as `missing`);
 * `opts.prior` is the pairing prior as plain data (a missing or invalid one means the prior is off). Pure and deterministic (FR-58, FR-59).
 */
export function suggest(items: readonly Item[], ctx: Ctx, opts: SuggestOpts = {}): RankedSuggestion[] | Missing {
  const ranked = rankedPool(items, ctx, opts);
  if ('missing' in ranked) return ranked;
  const { anchor } = ranked;
  return pickVariety(ranked.pool).map((s) => {
    const { reasons, ruleIds } = reasonsFor(s.evaluation, ctx);
    const ids = Object.fromEntries(SLOTS.map((k) => [k, s.outfit[k]?.id ?? null])) as Record<Slot, string | null>;
    return { items: ids, score: s.evaluation.score, reasons: anchor ? [anchorReason(anchor), ...reasons] : reasons, ruleIds: anchor ? ['ANCHOR', ...ruleIds] : ruleIds, parts: s.evaluation.parts };
  });
}
