import { OCCASIONS, categoryOfSubType } from '@sparta/taxonomy';
import type { Occasion, SubType } from '@sparta/taxonomy';
import { describe, expect, it } from 'vitest';
import { independentFits, independentProblems } from './fixtures/checker.js';
import { at, deepFreeze, mk } from './fixtures/items.js';
import { LAYER_HEAVY, PAIR_HEAVY, randomWardrobe, shuffled } from './fixtures/random.js';
import { WARDROBES } from './fixtures/wardrobes.js';
import { isMissing, rankedPool, suggest } from './suggest.js';
import type { Ctx, Item, Slot } from './types.js';

const SLOTS: Slot[] = ['top', 'bottom', 'layer', 'footwear', 'accessory'];
const isSuit = (i: Item | null): boolean => !!i && ['Suit', 'Tuxedo'].includes(i.subType);
const heldBy = (items: Item[], s: { items: Record<Slot, string | null> }): Record<Slot, Item | null> =>
  Object.fromEntries(SLOTS.map((k) => [k, items.find((i) => i.id === s.items[k]) ?? null])) as Record<Slot, Item | null>;

/** Brute force over every item of the wardrobe, with the independent checker: is there any valid outfit that holds the anchor? */
function existsWith(items: Item[], ctx: Ctx, anchor: Item): boolean {
  const fit = (slot: Slot): Item[] => items.filter((i) => independentFits(i, ctx, slot));
  const [tops, bottoms, layers, shoes] = [fit('top'), fit('bottom'), fit('layer'), fit('footwear')];
  return tops.some((top) => shoes.some((footwear) => bottoms.some((bottom) => (isSuit(bottom) ? [bottom] : [null, ...layers]).some((layer) =>
    [top, bottom, layer, footwear].includes(anchor) && independentProblems({ top, bottom, layer, footwear, accessory: null }, ctx).length === 0))));
}

/** Every CC7 check for one anchor; returns how many outfits came back. */
function check(items: Item[], ctx: Ctx, anchor: Item): number {
  const result = suggest(items, ctx, { anchor: anchor.id });
  expect(J(suggest(shuffled(items, 7), ctx, { anchor: anchor.id }))).toBe(J(result)); // FR-58: input order never matters
  if (['Accessories', 'Underwear and socks'].includes(anchor.category)) return expect(result).toEqual({ missing: ['anchor_not_offered'] }), 0;
  if (!independentFits(anchor, ctx)) return expect(result).toEqual({ missing: ['anchor_not_valid'] }), 0;
  expect(isMissing(result)).toBe(!existsWith(items, ctx, anchor)); // never falsely missing, never an outfit when none exists
  if (isMissing(result)) return expect(result.missing.length > 0 && result.missing.every((m) => !m.startsWith('anchor_'))).toBe(true), 0;
  expect(result.length).toBeLessThanOrEqual(3);
  expect(new Set(result.map((s) => J(s.items))).size).toBe(result.length);
  for (const s of result) {
    const outfit = heldBy(items, s);
    expect(SLOTS.filter((k) => outfit[k]?.id === anchor.id).length).toBe(isSuit(anchor) ? 2 : 1); // the anchor is in its slot (both slots for a suit), once
    expect(independentProblems(outfit, ctx)).toEqual([]);
    expect([s.ruleIds[0], s.reasons[0]]).toEqual(['ANCHOR', `Built around your ${anchor.name}`]);
  }
  return result.length;
}
const J = JSON.stringify;

describe('Complete the look (FR-59a, CC7)', () => {
  it('on 150 random wardrobes and crowded ones, every outfit holds the anchor and passes R1, R2 and the slots; missing exactly when no valid outfit exists', () => {
    let outfits = 0, anchors = 0;
    const pools: (readonly SubType[] | undefined)[] = [undefined, PAIR_HEAVY, LAYER_HEAVY];
    for (let seed = 1; seed <= 150; seed++) {
      const items = randomWardrobe(seed, pools[seed % 3], 10);
      for (const o of [OCCASIONS[seed % 7]!, OCCASIONS[(seed + 3) % 7]!]) {
        for (const anchor of items.slice(0, 6)) { outfits += check(items, at(o, [1, 4, 7, 10][seed % 4]!, seed % 2 ? 'north' : 'south'), anchor); anchors++; }
      }
    }
    expect(anchors).toBe(1800);
    expect(outfits).toBeGreaterThan(1000);
  }, 120_000);
  it('every item of the five fixture wardrobes, in every occasion and two seasons', () => {
    let outfits = 0;
    for (const items of Object.values(WARDROBES)) for (const o of OCCASIONS) for (const m of [1, 7]) for (const a of items) outfits += check(items, at(o, m), a);
    expect(outfits).toBeGreaterThan(1000);
  }, 120_000);
  it.each([
    ['an accessory', 'anchor_not_offered', mk('Belt', 'x')], ['socks', 'anchor_not_offered', mk('Socks', 'x')], ['underwear', 'anchor_not_offered', mk('Boxers', 'x')],
    ['an id not in the wardrobe', 'anchor_not_offered', mk('Tie', 'gone')],
    ['shorts in winter (R2)', 'anchor_not_valid', mk('Shorts', 'x'), 1], ['a Winter-only coat in April (R2)', 'anchor_not_valid', mk('Coat', 'x', { seasons: ['Winter'] })],
    ['sandals for Work (R1)', 'anchor_not_valid', mk('Sandals', 'x'), 4, 'Work'], ['a T-shirt for Work (R1)', 'anchor_not_valid', mk('T-shirt', 'x'), 4, 'Work'], ['a Suit for Casual (R1)', 'anchor_not_valid', mk('Suit', 'x')],
    ['an archived T-shirt', 'anchor_not_valid', mk('T-shirt', 'x', { status: 'archived' })],
  ] as [string, string, Item, number?, Occasion?][])('%s gives missing: [%s]', (_, code, anchor, month = 4, occasion: Occasion = 'Casual') => {
    const items = [mk('T-shirt', 't'), mk('Jeans', 'j'), mk('Sneakers', 's'), mk('Shirt', 'h'), mk('Chinos', 'c'), mk('Formal shoes', 'f'), ...(anchor.id === 'gone' ? [] : [anchor])];
    expect(suggest(items, at(occasion, month), { anchor: anchor.id })).toEqual({ missing: [code] });
  });
  it.each(['Sweater', 'Cardigan', 'Hoodie'] as const)('a %s is tried as a top and as a layer, and the best of both are merged', (sub) => {
    const items = [mk('T-shirt', 't'), mk('Shirt', 'h', { colourFamily: 'Grey', rgb: [128, 128, 128] }), mk('Jeans', 'j'), mk('Sneakers', 's'), mk(sub, 'a', { colourFamily: 'Brown', rgb: [92, 64, 51] })];
    const ranked = rankedPool(items, at('Casual', 4), { anchor: 'a' });
    if ('missing' in ranked) throw new Error('missing');
    expect(ranked.pool.some((c) => c.outfit.top?.id === 'a')).toBe(true);
    expect(ranked.pool.some((c) => c.outfit.layer?.id === 'a' && c.outfit.top !== null)).toBe(true);
    expect(ranked.pool.every((c) => [c.outfit.top, c.outfit.layer].some((i) => i?.id === 'a'))).toBe(true); // no layer-less outfit slips in
    expect(check(items, at('Casual', 4), items[4]!)).toBeGreaterThan(1);
  });
  it('a Suit anchor fills layer and bottom at once; the swap list is the caller\'s, the anchor stays in its slot', () => {
    const items = [mk('Shirt', 'h'), mk('Formal shoes', 'f'), mk('Suit', 'a'), mk('Tuxedo', 'u'), mk('Trousers', 't'), mk('Blazer', 'b')];
    const result = suggest(items, at('Formal'), { anchor: 'a' });
    if (isMissing(result)) throw new Error('missing');
    expect(result.every((s) => s.items.bottom === 'a' && s.items.layer === 'a')).toBe(true);
    expect(check(items, at('Formal'), items[2]!)).toBeGreaterThan(0);
  });
  it('the best eight cannot hide the anchor\'s only partner: formal shoes under Casual with nine T-shirts and one shirt', () => {
    const items = [...Array.from({ length: 9 }, (_, n) => mk('T-shirt', `t${n}`)), mk('Shirt', 'z'), mk('Jeans', 'j'), mk('Formal shoes', 'a')];
    const result = suggest(items, at('Casual'), { anchor: 'a' });
    expect(isMissing(result) ? [] : result.map((s) => s.items.top)).toEqual(['z']);
  });
  it('the reasons name the anchor, the input is never changed, and a wardrobe with no partner says what is missing', () => {
    const items = deepFreeze([mk('T-shirt', 'a', { name: 'Blue tee' }), mk('Jeans', 'j')]);
    expect(suggest(items, at('Casual'), { anchor: 'a' })).toEqual({ missing: ['footwear'] });
    const more = deepFreeze([...items, mk('Sneakers', 's')]);
    const result = suggest(more, at('Casual'), { anchor: 'a' });
    expect(isMissing(result) ? [] : result[0]!.reasons[0]).toBe('Built around your Blue tee');
  });
  it('Complete the look on 500 items takes under 300 ms (median of 9 runs)', () => {
    const subs: SubType[] = ['T-shirt', 'Shirt', 'Polo', 'Jeans', 'Chinos', 'Trousers', 'Sneakers', 'Boots', 'Formal shoes', 'Coat', 'Blazer', 'Sweater'];
    const big = Array.from({ length: 500 }, (_, i) => mk(subs[i % 12]!, `item-${i}`, { category: categoryOfSubType(subs[i % 12]!)!, rgb: [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256] }));
    const times = Array.from({ length: 9 }, () => { const t = Date.now(); suggest(big, at('Casual', 1), { anchor: 'item-11' }); return Date.now() - t; }).sort((a, b) => a - b);
    expect(times[4]).toBeLessThan(300);
  });
});
