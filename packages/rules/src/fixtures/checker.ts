import { rgbToLab } from '@sparta/taxonomy';
import type { Occasion, SubType } from '@sparta/taxonomy';
import type { Ctx, Item, Slot } from '../types.js';

/**
 * An independent check of the hard rules, written from FDD 14.1 and 14.2 with its own tables and its own
 * month-to-season map (nothing is imported from eligibility.ts, combinations.ts or season.ts), so that a bug
 * in the engine's rule code cannot also hide in the check. The property tests use it as the oracle.
 */
const TOPS = ['T-shirt', 'Shirt', 'Polo', 'Sweater', 'Cardigan', 'Hoodie', 'Sports T-shirt', 'Kurta'];
const BOTTOMS = ['Jeans', 'Chinos', 'Trousers', 'Shorts', 'Joggers', 'Pyjama', 'Dhoti', 'Track pants', 'Sports shorts', 'Suit', 'Tuxedo'];
const LAYERS = ['Jacket', 'Blazer', 'Coat', 'Sherwani', 'Nehru jacket', 'Waistcoat', 'Track jacket', 'Sweater', 'Cardigan', 'Hoodie', 'Suit', 'Tuxedo'];
const SHOES = ['Sneakers', 'Formal shoes', 'Boots', 'Sandals'];
const BY_OCCASION: Record<string, { top?: SubType[]; bottom?: SubType[]; layer?: SubType[]; footwear?: SubType[]; dark?: boolean }> = {
  Work: { top: ['Shirt', 'Polo'], bottom: ['Chinos', 'Trousers'], footwear: ['Sneakers', 'Formal shoes', 'Boots'] },
  Formal: { top: ['Shirt'], bottom: ['Trousers', 'Suit', 'Tuxedo'], layer: ['Blazer', 'Suit', 'Tuxedo'], footwear: ['Formal shoes'] },
  Party: { bottom: ['Jeans', 'Trousers'], footwear: ['Sneakers', 'Boots'], dark: true },
  Sport: { top: ['Sports T-shirt'], bottom: ['Track pants', 'Sports shorts'], footwear: ['Sneakers'] },
};
const MONTH_TO_SEASON = ['Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter'];

const season = (ctx: Ctx): string => MONTH_TO_SEASON[(ctx.date.getUTCMonth() + (ctx.hemisphere === 'south' ? 6 : 0)) % 12]!;
const inList = (list: readonly string[] | undefined, s: SubType): boolean => !list || list.includes(s);

function r2(item: Item, ctx: Ctx): boolean {
  const s = season(ctx);
  const okSeason = item.seasons.length === 0 || item.seasons.includes(s as 'Winter') || item.seasons.includes('All year');
  return item.status === 'active' && okSeason && !(s === 'Summer' && ['Coat', 'Sweater', 'Cardigan'].includes(item.subType));
}

function slotOk(item: Item, slot: Slot, occasion: Occasion): boolean {
  const rule = BY_OCCASION[occasion] ?? {};
  const fills = { top: TOPS, bottom: BOTTOMS, layer: LAYERS, footwear: SHOES, accessory: ['Belt'] }[slot];
  if (!fills.includes(item.subType) || (slot !== 'accessory' && !inList(rule[slot], item.subType))) return false;
  if (slot === 'top' && rule.dark) {
    const [L, a, b] = rgbToLab(...item.rgb);
    return L < 40 || Math.hypot(a, b) > 50;
  }
  return true;
}

const pairOk = (bottom: Item, shoes: Item, occasion: Occasion): boolean =>
  !(['Casual', 'Date', 'Travel'].includes(occasion) && shoes.subType === 'Formal shoes' && ['Shorts', 'Sports shorts'].includes(bottom.subType));

const isSuit = (i: Item | null): boolean => !!i && ['Suit', 'Tuxedo'].includes(i.subType);

/**
 * What is wrong with an outfit: SLOTS, R2, R1, DUPLICATE, SUIT (a Suit or Tuxedo must fill layer and bottom together, never one
 * alone) or, when the wardrobe is given, LAYER (decision D-A: Formal and the cool seasons need a layer when a layered outfit exists).
 * An empty list means it is valid.
 */
export function independentProblems(outfit: Record<Slot, Item | null>, ctx: Ctx, wardrobe?: readonly Item[]): string[] {
  const out = new Set<string>();
  const { top, bottom, layer, footwear, accessory } = outfit;
  if (!top || !bottom || !footwear) out.add('SLOTS');
  for (const slot of ['top', 'bottom', 'layer', 'footwear', 'accessory'] as Slot[]) {
    const item = outfit[slot];
    if (!item) continue;
    if (!r2(item, ctx)) out.add('R2');
    if (!slotOk(item, slot, ctx.occasion)) out.add('R1');
  }
  if (bottom && footwear && !pairOk(bottom, footwear, ctx.occasion)) out.add('R1');
  const placed = [top, bottom, layer, footwear, accessory].filter((i): i is Item => !!i);
  const suitIsBoth = !!bottom && bottom === layer && isSuit(bottom);
  if (new Set(placed.map((i) => i.id)).size !== placed.length - (suitIsBoth ? 1 : 0)) out.add('DUPLICATE');
  if (layer && bottom && layer.id === bottom.id && !suitIsBoth) out.add('DUPLICATE');
  if ((isSuit(bottom) || isSuit(layer)) && !suitIsBoth) out.add('SUIT');
  if (wardrobe && !layer && layerWanted(ctx) && layeredOutfitExists(wardrobe, ctx)) out.add('LAYER');
  return [...out].sort();
}

const layerWanted = (ctx: Ctx): boolean => ctx.occasion === 'Formal' || ['Autumn', 'Winter'].includes(season(ctx));
const layered = new WeakMap<readonly Item[], Map<string, boolean>>();

/** Brute force: is there any valid outfit with a layer (or a Suit or Tuxedo as bottom and layer) in this wardrobe and context? */
function layeredOutfitExists(items: readonly Item[], ctx: Ctx): boolean {
  const memo = layered.get(items) ?? new Map<string, boolean>();
  layered.set(items, memo);
  const key = `${ctx.occasion}/${season(ctx)}`;
  if (!memo.has(key)) {
    const fit = (slot: Slot): Item[] => items.filter((i) => r2(i, ctx) && slotOk(i, slot, ctx.occasion));
    const [tops, bottoms, shoes, layers] = [fit('top'), fit('bottom'), fit('footwear'), fit('layer')];
    const pairs = bottoms.flatMap((b) => (isSuit(b) ? [[b, b]] : layers.map((l) => [b, l])));
    memo.set(key, tops.some((top) => shoes.some((footwear) => pairs.some(([bottom, layer]) =>
      independentProblems({ top, bottom: bottom!, layer: layer!, footwear, accessory: null }, ctx).length === 0))));
  }
  return memo.get(key)!;
}

/** Brute force over every top, bottom (or suit) and footwear: does any valid outfit exist at all? */
export function validOutfitExists(items: readonly Item[], ctx: Ctx): boolean {
  const none = { layer: null, accessory: null };
  return items.some((top) => items.some((bottom) => items.some((footwear) => {
    if (new Set([top.id, bottom.id, footwear.id]).size < 3) return false;
    const suit = ['Suit', 'Tuxedo'].includes(bottom.subType);
    return independentProblems({ ...none, top, bottom, footwear, layer: suit ? bottom : null }, ctx).length === 0;
  })));
}
