import { OCCASIONS, categoryOfSubType, rgbToLab } from '@sparta/taxonomy';
import type { ColourFamily, Occasion, Pattern, SubType } from '@sparta/taxonomy';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { outfitProblems } from './combinations.js';
import type { Outfit } from './combinations.js';
import { RULES } from './eligibility.js';
import { REASON_TEMPLATES } from './reasons.js';
import { PART_NAMES, createScorer } from './score.js';
import { isMissing, suggest } from './suggest.js';
import type { RankedSuggestion } from './suggest.js';
import { swapChoices } from './swap.js';
import type { Ctx, Hemisphere, Item, Slot } from './types.js';

type Rgb = readonly [number, number, number];
const NAVY: Rgb = [31, 42, 68], GREY: Rgb = [128, 128, 128], RED: Rgb = [214, 40, 40], GREEN: Rgb = [40, 160, 70], PALE: Rgb = [230, 170, 170], DULL: Rgb = [120, 130, 128];
const mk = (subType: SubType, id: string, o: Partial<Item> = {}): Item => ({
  id, name: id, category: categoryOfSubType(subType)!, subType, rgb: NAVY, colourFamily: 'Navy',
  pattern: 'Solid', seasons: [], occasions: [], condition: null, favourite: false, status: 'active', ...o,
});
const col = (colourFamily: ColourFamily, rgb: Rgb): Partial<Item> => ({ colourFamily, rgb });
const ctx = (occasion: Occasion, month = 4, hemisphere: Hemisphere = 'north'): Ctx => ({ occasion, hemisphere, date: new Date(Date.UTC(2026, month - 1, 15)) });
const WARM = ctx('Casual', 4), COOL = ctx('Casual', 1), MONTHS = [1, 4, 7, 10];
type Parts = Partial<Record<Slot, Item>>;
const base = (t: Partial<Item> = {}, b: Partial<Item> = {}, f: Partial<Item> = {}): Parts => ({ top: mk('T-shirt', 't', t), bottom: mk('Jeans', 'b', b), footwear: mk('Sneakers', 'f', f) });
const ev = (o: Parts, c: Ctx = WARM, belts = false) => createScorer(c, belts).evaluate({ top: null, bottom: null, layer: null, footwear: null, accessory: null, ...o });
const sugg = (items: Item[], c: Ctx): RankedSuggestion[] => {
  const r = suggest(items, c);
  return isMissing(r) ? expect.fail(`missing ${r.missing.join()}`) : r;
};
const asOutfit = (s: RankedSuggestion, items: Item[]): Outfit =>
  Object.fromEntries((Object.keys(s.items) as Slot[]).map((k) => [k, items.find((i) => i.id === s.items[k]) ?? null])) as Outfit;
const near = (a: number, b: number): void => expect(a).toBeCloseTo(b, 12);

describe('score parts', () => {
  const four = (rgb: Rgb): Parts => ({ ...base(col('Pink', rgb), col('Teal', rgb), col('Purple', rgb)), layer: mk('Blazer', 'l', col('Orange', rgb)) });
  it.each([
    ['all neutral', base({}, col('Grey', GREY)), 1], ['three non-neutral families', base(col('Pink', PALE), col('Teal', PALE), col('Purple', PALE)), 1],
    ['four non-neutral families', four(PALE), 0.66], ['one bold item', base(col('Red', RED)), 1], ['two bold items', base(col('Red', RED), col('Green', GREEN)), 0.66],
    ['a bold colour in a neutral family is not bold', base(col('Navy', RED), col('Red', RED)), 1],
    ['a non-neutral family with chroma under 10 is neutral', four(DULL), 1],
  ] as [string, Parts, number][])('R3 colour: %s', (_, o, r3) => near(ev(o).rules.R3, r3));
  it.each([
    [['Solid', 'Solid', 'Solid'], 1], [['Striped', 'Solid', null], 1], [['Striped', 'Checked', 'Solid'], 0.5], [['Striped', 'Checked', 'Printed'], 0],
  ] as [(Pattern | null)[], number][])('R4 pattern %j gives %f', ([t, b, f], r4) => near(ev(base({ pattern: t }, { pattern: b }, { pattern: f })).rules.R4, r4));
  it.each([
    ['cool, no layer', COOL, undefined, 0.5], ['cool, layer in the top colour', COOL, col('Navy', NAVY), 0.7], ['cool, layer in another colour', COOL, col('Grey', GREY), 1],
    ['warm, no layer', WARM, undefined, 1], ['warm, layer in the top colour', WARM, col('Navy', NAVY), 1],
  ] as [string, Ctx, Partial<Item> | undefined, number][])('R5 layering: %s', (_, c, layer, r5) => near(ev({ ...base(), ...(layer ? { layer: mk('Coat', 'l', layer) } : {}) }, c).rules.R5, r5));
  it.each([['no belt', undefined, 1], ['belt in the shoes family', 'Navy', 1], ['belt in another family', 'Brown', 0.6]] as [string, ColourFamily | undefined, number][])(
    'R6 footwear and belt: %s', (_, family, r6) => near(ev({ ...base(), ...(family ? { accessory: mk('Belt', 'x', { colourFamily: family }) } : {}) }).rules.R6, r6));
  it('occasion_fit: tag match 1, no tags 0.5, other tags 0', () => near(ev(base({ occasions: ['Casual'] }, { occasions: ['Work'] })).parts.occasion_fit, 0.5));
  it.each([
    ['warm, no belts: nothing applies', WARM, false, base(), 1], ['cool, no layer', COOL, false, base(), 0], ['cool, layer', COOL, false, { ...base(), layer: mk('Coat', 'l') }, 1],
    ['belt in the wardrobe, matching belt worn', WARM, true, { ...base(), accessory: mk('Belt', 'x') }, 1], ['belt in the wardrobe, none worn', WARM, true, base(), 0],
    ['cool with layer, belt in the wardrobe, none worn', COOL, true, { ...base(), layer: mk('Coat', 'l') }, 0.5],
  ] as [string, Ctx, boolean, Parts, number][])('completeness: %s', (_, c, belts, o, expected) => near(ev(o, c, belts).parts.completeness, expected));
  it('condition: unrated 0.7, rated 1 - c/100, Falling apart 0; favourites: the share of favourite items', () => {
    near(ev(base({ condition: null }, { condition: 20 }, { condition: 90, favourite: true })).parts.condition, 1.5 / 3);
    near(ev(base({ favourite: true })).parts.favourites, 1 / 3);
  });
  it('a Suit in two slots counts once', () => {
    const suit = mk('Suit', 's', { favourite: true });
    near(ev({ top: mk('Shirt', 't'), bottom: suit, layer: suit, footwear: mk('Formal shoes', 'f') }).parts.favourites, 1 / 3);
  });
});
describe('base weights', () => {
  it('score is the weighted sum of exactly five parts from weights_base; there is no pairing part', () => {
    const e = ev(base({ favourite: true, occasions: ['Casual'] }, { condition: 10 }), COOL);
    expect(Object.keys(e.parts).sort()).toEqual([...PART_NAMES].sort());
    near(e.score, 0.5 * e.parts.rule_fit + 0.2 * e.parts.occasion_fit + 0.1 * e.parts.completeness + 0.1 * e.parts.condition + 0.1 * e.parts.favourites);
  });
  it('reads the weights from rules.json data, not from constants in code', () => {
    const saved = { ...RULES.weights_base };
    try {
      Object.assign(RULES.weights_base, { rule_fit: 0, occasion_fit: 0, completeness: 0, condition: 1, favourites: 0 });
      near(ev(base({ condition: 40 }, { condition: 40 }, { condition: 40 })).score, 0.6);
    } finally {
      Object.assign(RULES.weights_base, saved);
    }
  });
});
const TOPS = ['T-shirt', 'Shirt', 'Polo', 'Sweater', 'Hoodie', 'Sports T-shirt'] as const;
const POOL: Item[] = [
  ...TOPS.map((s, i) => mk(s, `top-${s}`, { ...col(i % 2 ? 'Red' : 'Pink', i % 2 ? RED : PALE), pattern: i === 2 ? 'Striped' : 'Solid', occasions: i < 3 ? ['Casual', 'Work'] : [] })),
  mk('Jeans', 'j1'), mk('Chinos', 'j2', col('Beige', PALE)), mk('Trousers', 'j3', col('Grey', GREY)), mk('Shorts', 'j4'), mk('Track pants', 'j5'), mk('Sports shorts', 'j6'),
  mk('Sneakers', 's1', col('Brown', GREY)), mk('Formal shoes', 's2', col('Black', GREY)), mk('Boots', 's3'), mk('Sandals', 's4'),
  mk('Coat', 'l1', col('Grey', GREY)), mk('Blazer', 'l2'), mk('Cardigan', 'l3', { seasons: ['Winter'] }), mk('Suit', 'su'), mk('Tuxedo', 'tu', col('Black', DULL)),
  mk('Belt', 'b1', col('Brown', GREY)), mk('Belt', 'b2', col('Black', GREY)), mk('Socks', 'x1'), mk('Watch', 'x2'), mk('Jeans', 'j7', { status: 'archived' }), mk('Coat', 'l4', { seasons: ['Summer'] }),
];
describe('suggest', () => {
  it('is the same whatever the input order, and every suggestion is valid with no item twice (FR-58)', () => {
    fc.assert(fc.property(fc.shuffledSubarray(POOL, { minLength: 0 }), fc.constantFrom(...OCCASIONS), fc.constantFrom(...MONTHS), fc.constantFrom<Hemisphere>('north', 'south'), (items, occasion, month, hemi) => {
      const c = ctx(occasion, month, hemi), result = suggest(items, c);
      expect(suggest([...items].sort((a, b) => (a.id < b.id ? 1 : -1)), c)).toEqual(result);
      if (isMissing(result)) return;
      expect(result.length).toBeLessThanOrEqual(3);
      for (const s of result) {
        expect(outfitProblems(asOutfit(s, items), c)).toEqual([]);
        const ids = Object.values(s.items).filter((x) => x !== null);
        expect(new Set(ids).size).toBe(s.items.layer !== null && s.items.layer === s.items.bottom ? ids.length - 1 : ids.length);
      }
    }), { numRuns: 300 });
  });
  it('breaks ties by item ID, not by input order', () => {
    const items = [mk('T-shirt', 'tb'), mk('T-shirt', 'ta'), mk('Jeans', 'j'), mk('Sneakers', 's')];
    expect(sugg(items, WARM).map((s) => s.items.top)).toEqual(['ta', 'tb']);
  });
  it('R7 variety: three different outfits, and no item in all three where an alternative exists', () => {
    const result = sugg(POOL.filter((i) => ['top-T-shirt', 'top-Shirt', 'top-Polo', 'j1', 'j2', 's1', 's3'].includes(i.id)), WARM);
    expect(new Set(result.map((s) => JSON.stringify(s.items))).size).toBe(3);
    const idSets = result.map((s) => new Set(Object.values(s.items)));
    expect([...idSets[0]!].filter((id) => id && idSets.every((set) => set.has(id)))).toEqual([]);
  });
  it('R7 variety: with one bottom and one pair of shoes they are reused, because there is no alternative', () => {
    const items = [mk('T-shirt', 'a'), mk('Shirt', 'b'), mk('Polo', 'c'), mk('Jeans', 'j'), mk('Sneakers', 's')];
    expect(sugg(items, WARM).map((s) => s.items.bottom)).toEqual(['j', 'j', 'j']);
  });
  it('in a cool season the outfit with a layer ranks first', () => {
    const items = [mk('T-shirt', 't'), mk('Jeans', 'j', col('Grey', GREY)), mk('Sneakers', 's', col('Grey', GREY)), mk('Coat', 'c', col('Beige', PALE))];
    expect(sugg(items, COOL).map((s) => s.items.layer)).toEqual(['c', null]);
  });
  it('adds the belt in the shoes colour family (ties by ID), and no belt that does not match', () => {
    const items = [mk('T-shirt', 't'), mk('Jeans', 'j'), mk('Boots', 's', col('Brown', GREY))];
    expect(sugg([...items, mk('Belt', 'b1', col('Brown', GREY)), mk('Belt', 'b0', col('Brown', GREY))], WARM)[0]!.items.accessory).toBe('b0');
    const black = sugg([...items, mk('Belt', 'b2', col('Black', GREY))], WARM)[0]!;
    expect([black.items.accessory, black.parts.completeness]).toEqual([null, 0]);
  });
});
describe('reasons (R8)', () => {
  const regexes = Object.entries(REASON_TEMPLATES).filter(([k]) => k !== 'note').map(([, t]) => new RegExp(`^${t.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '.+')}$`));
  it('states the rules met, in the fixed wording', () => {
    const items = [mk('T-shirt', 't'), mk('Jeans', 'j', col('Grey', GREY)), mk('Sneakers', 's', col('Black', GREY))];
    const first = sugg(items, WARM)[0]!;
    expect(first.reasons).toEqual(['Every piece suits Casual', 'Every piece suits Spring', 'Navy, grey and black are neutral and go with anything', 'At most one pattern, so nothing clashes']);
    expect(first.ruleIds).toEqual(['R1', 'R2', 'R3', 'R4']);
    expect(sugg([...items, mk('Coat', 'c', col('Beige', PALE))], COOL)[0]!.reasons).toContain('Layer works for cool weather');
  });
  it('every suggestion has at least one reason and each comes from a template (CC5)', () => {
    for (const o of OCCASIONS) for (const m of MONTHS) {
      const result = suggest(POOL, ctx(o, m));
      if (!isMissing(result)) for (const s of result) {
        expect(s.reasons.length).toBeGreaterThan(0);
        expect(s.reasons.length).toBe(s.ruleIds.length);
        for (const r of s.reasons) expect(regexes.some((re) => re.test(r))).toBe(true);
      }
    }
  });
});
describe('thin wardrobe (FR-54)', () => {
  const tee = mk('T-shirt', 't'), jeans = mk('Jeans', 'j'), shoes = mk('Sneakers', 's');
  it.each([
    ['empty', [], WARM, ['top', 'bottom', 'footwear']], ['no footwear', [tee, jeans], WARM, ['footwear']], ['no top or bottom', [shoes], WARM, ['top', 'bottom']],
    ['archived items do not count', [{ ...tee, status: 'archived' }, jeans, shoes], WARM, ['top']], ['out of season', [{ ...tee, seasons: ['Winter'] }, jeans, shoes], WARM, ['top']],
    ['a Suit is the bottom', [mk('Shirt', 't'), mk('Suit', 'su')], ctx('Formal'), ['footwear']], ['a Suit needs a top', [mk('Suit', 'su'), mk('Formal shoes', 'f')], ctx('Formal'), ['top']],
    ['sandals are not closed shoes for Work', [mk('Shirt', 't'), mk('Chinos', 'c'), mk('Sandals', 's')], ctx('Work'), ['footwear']],
    ['only formal shoes and shorts for Casual', [tee, mk('Shorts', 'sh'), mk('Formal shoes', 'f')], WARM, ['bottom', 'footwear']],
  ] as [string, Item[], Ctx, string[]][])('%s', (_, items, c, missing) => expect(suggest(items, c)).toEqual({ missing }));
});
describe('swapChoices (CC9)', () => {
  const swapCtx = ctx('Casual', 4);
  const wardrobe = [
    mk('T-shirt', 't'), mk('Jeans', 'j'), mk('Sneakers', 's'), mk('Jeans', 'j-z'), mk('Jeans', 'j-a'), mk('Chinos', 'c-red', col('Red', RED)), mk('Chinos', 'c-navy'),
    mk('Jeans', 'j-pale', col('Pink', PALE)), mk('Shorts', 'sh'), mk('Jeans', 'j-old', { status: 'archived' }), mk('Jeans', 'j-winter', { seasons: ['Winter'] }), mk('Boots', 'bo'), mk('Socks', 'so'),
  ];
  const outfit = sugg(wardrobe.slice(0, 3), swapCtx)[0]!;
  const likeness = (a: Item, b: Item): number => {
    const [p, q] = [rgbToLab(...a.rgb), rgbToLab(...b.rgb)];
    return 0.6 * (a.subType === b.subType ? 1 : 0.4) + 0.4 * (1 - Math.min(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 100, 1));
  };
  it('lists only valid items outside the outfit, most alike first, ties by item ID', () => {
    const expected = wardrobe.filter((i) => ['j-z', 'j-a', 'c-red', 'c-navy', 'j-pale', 'sh'].includes(i.id)).sort((a, b) => likeness(wardrobe[1]!, b) - likeness(wardrobe[1]!, a) || (a.id < b.id ? -1 : 1)).map((i) => i.id);
    const got = swapChoices(outfit, 'bottom', wardrobe, {}, swapCtx);
    expect(got).toEqual(expected);
    expect(got.slice(0, 2)).toEqual(['j-a', 'j-z']);
    expect(got.indexOf('c-navy')).toBeLessThan(got.indexOf('c-red'));
  });
  it.each(OCCASIONS.map((o) => [o]))('every %s choice keeps the outfit valid under R1, R2 and the slots', (o) => {
    const c = ctx(o, 10), result = suggest(POOL, c);
    if (isMissing(result)) return;
    for (const s of result) for (const slot of ['top', 'bottom', 'layer', 'footwear', 'accessory'] as Slot[]) {
      for (const id of swapChoices(s, slot, POOL, {}, c)) {
        const next = asOutfit(s, POOL), item = POOL.find((i) => i.id === id)!, before = next[slot];
        for (const k of Object.keys(next) as Slot[]) if (before && next[k]?.id === before.id) next[k] = null;
        next[slot] = item;
        if (item.subType === 'Suit' || item.subType === 'Tuxedo') next.layer = next.bottom = item;
        expect(outfitProblems(next, c)).toEqual([]);
      }
    }
  });
  it('respects the occasion table, and a Suit swapped out leaves a valid outfit or nothing', () => {
    const items = [mk('Shirt', 't'), mk('Chinos', 'c'), mk('Boots', 'b'), mk('Sandals', 'sa'), mk('Sneakers', 'sn'), mk('Formal shoes', 'fs')];
    const work = { ...sugg(items, ctx('Work'))[0]!, items: { top: 't', bottom: 'c', layer: null, footwear: 'b', accessory: null } };
    expect(swapChoices(work, 'footwear', items, {}, ctx('Work'))).toEqual(['fs', 'sn']);
    const formal = [mk('Shirt', 't'), mk('Suit', 'su'), mk('Tuxedo', 'tu'), mk('Trousers', 'tr'), mk('Blazer', 'bl'), mk('Formal shoes', 'f')];
    const s = { ...work, items: { top: 't', bottom: 'su', layer: 'su', footwear: 'f', accessory: null } };
    expect(swapChoices(s, 'bottom', formal, {}, ctx('Formal')).sort()).toEqual(['tr', 'tu']);
    expect(swapChoices(s, 'layer', formal, {}, ctx('Formal'))).toEqual(['tu']);
  });
});
describe('timing (CC7)', () => {
  const subs = ['T-shirt', 'Shirt', 'Polo', 'Jeans', 'Chinos', 'Trousers', 'Sneakers', 'Boots', 'Formal shoes', 'Coat', 'Blazer', 'Belt', 'Suit'] as const;
  const big = Array.from({ length: 500 }, (_, i) => mk(subs[i % 13]!, `item-${i}`, { ...col((['Navy', 'Red', 'Grey', 'Brown', 'Green'] as const)[i % 5]!, [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256]), pattern: i % 7 ? 'Solid' : 'Striped', condition: i % 3 ? (i * 7) % 100 : null }));
  const median = (run: () => unknown): number => {
    const times = Array.from({ length: 20 }, () => { const t = Date.now(); run(); return Date.now() - t; }).sort((a, b) => a - b);
    return (times[9]! + times[10]!) / 2;
  };
  it('suggest and swapChoices on 500 items each take under 300 ms (median of 20 runs)', () => {
    const c = ctx('Casual', 1), first = sugg(big, c)[0]!;
    expect(median(() => suggest(big, c))).toBeLessThan(300);
    expect(median(() => swapChoices(first, 'bottom', big, {}, c))).toBeLessThan(300);
  });
});
