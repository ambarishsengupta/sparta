export { seasonFor } from './season.js';
export {
  RULES, allowedInSlot, eligibleItems, lightnessAndChroma, occasionRule, pairAllowed,
  passesSeason, placementsOf, usablePlacements,
} from './eligibility.js';
export { enumerateOutfits, outfitProblems, preScore, slotCandidates } from './combinations.js';
export type { Candidates, Outfit } from './combinations.js';
export type {
  Ctx, CurrentSeason, Hemisphere, Item, ItemId, Missing, OccasionRule, Rules, Slot, Suggestion,
} from './types.js';
export { MAX_SUGGESTIONS } from './rank.js';
export { PART_NAMES } from './score.js';
export type { ScoreParts } from './score.js';
export { isMissing, suggest } from './suggest.js';
export type { RankedSuggestion } from './suggest.js';
export { swapChoices } from './swap.js';
export type { ShapeFeatures } from './swap.js';
