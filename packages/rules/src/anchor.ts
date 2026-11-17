import { enumerateOutfits } from './combinations.js';
import type { Candidates, Outfit } from './combinations.js';
import { eligibleItems, placementsOf } from './eligibility.js';
import type { Ctx, Item, ItemId, Missing, Slot } from './types.js';

/** The reason that names the anchor (R8 for Complete the look; not a rules.json template, because WO-0011 may add only unlock and pairing keys there). */
export const anchorReason = (anchor: Item): string => `Built around your ${anchor.name}`;

/** Complete the look is offered only for an item that fills a top, bottom, layer or footwear slot, never for accessories, underwear or socks (FR-59a). */
export const isOffered = (item: Item | undefined): item is Item => !!item && placementsOf(item).some((p) => p[0] !== 'accessory');

/** The anchor item, or `anchor_not_offered` (unknown id, accessory, underwear, socks) or `anchor_not_valid` (it fails R1 or R2 for this occasion and season, or is archived). */
export function checkAnchor(items: readonly Item[], id: ItemId, ctx: Ctx): Item | Missing {
  const item = items.find((i) => i.id === id);
  if (!isOffered(item)) return { missing: ['anchor_not_offered'] };
  return eligibleItems([item], ctx).length > 0 ? item : { missing: ['anchor_not_valid'] };
}

/**
 * Step 2 with only the anchor in its slot or slots (LLD 9.5.2): `c` holds the other items (the anchor is not in it).
 * A Suit or Tuxedo (two slots) is the only `both` item and leaves bottom and layer empty; an anchor in bottom or layer
 * rules out the other suits and tuxedos, which would fill the same slots. Wardrobe unlock reuses this for its pretend item.
 */
export function anchored(c: Candidates, anchor: Item, placement: Slot[]): Candidates {
  const both = placement.length === 2;
  const slot = both ? 'both' : (placement[0] as 'top' | 'bottom' | 'layer' | 'footwear');
  return { ...c, ...(both ? { bottom: [], layer: [] } : slot === 'bottom' || slot === 'layer' ? { both: [] } : {}), [slot]: [anchor] };
}

/** Every outfit of an anchored enumeration that holds the anchor (`enumerateOutfits` also yields the layer-less outfit when the anchor is a layer, which does not). */
export function anchoredOutfits(c: Candidates, anchor: Item, placement: Slot[], ctx: Ctx): Outfit[] {
  return enumerateOutfits(anchored(c, anchor, placement), ctx).filter((o) => [o.top, o.bottom, o.layer, o.footwear].includes(anchor));
}
