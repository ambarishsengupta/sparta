import type { SubType } from '@sparta/taxonomy';
import { unlock } from '@sparta/rules';
import type { Ctx, Item, UnlockOpts, UnlockSuggestion } from '@sparta/rules';
import type { EventLog } from './events';
import type { WardrobeRepository, WishlistEntry, WishlistInput } from './repository';
import { activeItems, seasonOf } from './suggestions-view-model';

/**
 * The count the future vendor aggregate may use (FR-74, FR-81): entries made by Wardrobe unlock are left out (CC9).
 * An entry with no origin was made by the person (saved before R4). Nothing here is sent anywhere.
 */
export function wishlistAggregate(entries: readonly Pick<WishlistEntry, 'subType' | 'origin'>[]): { total: number; bySubType: Partial<Record<SubType, number>>; excludedUnlock: number } {
  const counted = entries.filter((e) => e.origin !== 'unlock');
  const bySubType: Partial<Record<SubType, number>> = {};
  for (const e of counted) bySubType[e.subType] = (bySubType[e.subType] ?? 0) + 1;
  return { total: counted.length, bySubType, excludedUnlock: entries.length - counted.length };
}

/** "Add Navy Chinos: 6 new outfits" (FR-59b): attributes and the exact count only; no photo, price or store. */
export const unlockLabel = (e: UnlockSuggestion): string => `Add ${e.colourFamily} ${e.subType}: ${e.newOutfits} new outfit${e.newOutfits === 1 ? '' : 's'}`;
export const unlockKey = (e: { subType: string; colourFamily?: string | null }): string => `${e.subType}|${e.colourFamily ?? ''}`;

/** Up to three entries from the engine over the active items; computed here from the wardrobe, nothing leaves the browser. */
export const unlockEntries = (items: readonly Item[], ctx: Ctx, opts: UnlockOpts): UnlockSuggestion[] => unlock(activeItems(items), ctx, opts);

/** The ordinary wishlist entry (FR-34) with sub-type and colour family filled in and no brand or price, marked as coming from Wardrobe unlock. */
export const unlockWishlistInput = (e: UnlockSuggestion): WishlistInput => ({
  name: `${e.colourFamily} ${e.subType}`, subType: e.subType, colourFamily: e.colourFamily, note: null, origin: 'unlock',
});

/**
 * One tap on "Add to wishlist": creates the entry through the repository and records `wishlist_added` with origin 'unlock' (occasion and season, no names).
 * An unlock entry for the same sub-type and colour family that is already there is not added twice.
 */
export async function addUnlockToWishlist(repo: WardrobeRepository, log: EventLog, e: UnlockSuggestion, ctx: Ctx): Promise<{ added: boolean }> {
  const have = (await repo.wishlist.list()).some((w) => w.origin === 'unlock' && unlockKey(w) === unlockKey(e));
  if (have) return { added: false };
  await repo.wishlist.create(unlockWishlistInput(e));
  log.record('wishlist_added', { origin: 'unlock', occasion: ctx.occasion, season: seasonOf(ctx) });
  return { added: true };
}
