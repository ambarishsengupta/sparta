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
