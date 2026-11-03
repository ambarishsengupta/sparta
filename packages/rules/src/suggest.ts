import type { ColourFamily } from '@sparta/taxonomy';
import { enumerateOutfits, slotCandidates } from './combinations.js';
import type { Candidates, Outfit } from './combinations.js';
import { eligibleItems } from './eligibility.js';
import { pickVariety, toScored } from './rank.js';
import { reasonsFor } from './reasons.js';
import { createScorer, itemsOf } from './score.js';
import type { ScoreParts } from './score.js';
import type { Ctx, Item, Missing, Slot, Suggestion } from './types.js';

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
 * LLD 9.5 steps 1 to 7, base weights only: hard rules (WO-0003), R3 to R6 scoring with the best belt in the
 * shoes' colour family, R7 picks up to three, R8 reasons. Pure and deterministic (FR-58, FR-59).
 */
export function suggest(items: readonly Item[], ctx: Ctx): RankedSuggestion[] | Missing {
  const candidates = slotCandidates(eligibleItems(items, ctx), ctx);
  const outfits = enumerateOutfits(candidates, ctx);
  if (outfits.length === 0) return { missing: missingSlots(candidates) };
  const scorer = createScorer(ctx, candidates.belts.length > 0);
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
  const pool = outfits.map((o) => withBelt(o)).map((o) => toScored(o, scorer.evaluate(o)));
  return pickVariety(pool).map((s) => {
    const { reasons, ruleIds } = reasonsFor(s.evaluation, ctx);
    const ids = Object.fromEntries(SLOTS.map((k) => [k, s.outfit[k]?.id ?? null])) as Record<Slot, string | null>;
    return { items: ids, score: s.evaluation.score, reasons, ruleIds, parts: s.evaluation.parts };
  });
}
