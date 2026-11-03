import { OCCASIONS, SEASONS, SUB_TYPES, categoryOfSubType, rgbToLab } from '@sparta/taxonomy';
import type { Occasion, Season, SubType } from '@sparta/taxonomy';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { enumerateOutfits, outfitProblems, slotCandidates } from './combinations.js';
import type { Outfit } from './combinations.js';
import { eligibleItems } from './eligibility.js';
import type { Ctx, Hemisphere, Item } from './types.js';

const NAVY = [31, 42, 68] as const;
const mk = (subType: SubType, id: string, o: Partial<Item> = {}): Item => ({
  id, name: id, category: categoryOfSubType(subType)!, subType, rgb: NAVY, colourFamily: 'Navy',
  pattern: 'Solid', seasons: [], occasions: [], condition: null, favourite: false, status: 'active', ...o,
});
const ctx = (occasion: Occasion, month = 4, hemisphere: Hemisphere = 'north'): Ctx => ({
  occasion, hemisphere, date: new Date(Date.UTC(2026, month - 1, 15)),
});
const outfitsFor = (items: Item[], c: Ctx): Outfit[] => enumerateOutfits(slotCandidates(eligibleItems(items, c), c), c);
const key = (o: Outfit): string => (['top', 'bottom', 'layer', 'footwear', 'accessory'] as const).map((s) => o[s]?.id ?? '-').join('/');
const keys = (items: Item[], c: Ctx): string[] => outfitsFor(items, c).map(key);
const many = (sub: SubType, n: number): Item[] => [...Array(n).keys()].map((i) => mk(sub, `${sub}${String(i).padStart(2, '0')}`));

describe('R2 season and status', () => {
  const tee = (seasons: Season[]) => [mk('T-shirt', 't', { seasons }), mk('Jeans', 'j'), mk('Sneakers', 's')];
  it.each([
    [[], 1], [['All year'], 1], [['Spring'], 1], [['Spring', 'Winter'], 1], [['Winter'], 0], [['Summer', 'Autumn'], 0],
  ] as [Season[], number][])('top tagged %j in spring gives %i outfit(s)', (seasons, n) => {
    expect(outfitsFor(tee(seasons), ctx('Casual', 4))).toHaveLength(n);
  });
  it.each([['Coat'], ['Sweater'], ['Cardigan']] as [SubType][])('Summer drops %s (even tagged Summer); spring and winter keep it', (sub) => {
    const layer = mk(sub, 'l', { seasons: ['Summer', 'Spring', 'Winter'] });
    expect(eligibleItems([layer], ctx('Casual', 7))).toEqual([]);
    expect(eligibleItems([layer], ctx('Casual', 4))).toEqual([layer]);
    expect(eligibleItems([layer], ctx('Casual', 1))).toEqual([layer]);
  });
  it('flips with the hemisphere: December is winter in the north and summer in the south', () => {
    expect(outfitsFor(tee(['Winter']), ctx('Casual', 12, 'north'))).toHaveLength(1);
    expect(outfitsFor(tee(['Winter']), ctx('Casual', 12, 'south'))).toHaveLength(0);
    expect(outfitsFor(tee(['Winter']), ctx('Casual', 6, 'south'))).toHaveLength(1);
    expect(eligibleItems([mk('Coat', 'c')], ctx('Casual', 12, 'north'))).toHaveLength(1);
    expect(eligibleItems([mk('Coat', 'c')], ctx('Casual', 12, 'south'))).toHaveLength(0);
  });
  it('excludes archived items', () => {
    expect(outfitsFor([mk('T-shirt', 't', { status: 'archived' }), mk('Jeans', 'j'), mk('Sneakers', 's')], ctx('Casual'))).toEqual([]);
  });
  it('never places underwear and socks or accessories other than belts', () => {
    const odd = [mk('Socks', 'x'), mk('Briefs', 'y'), mk('Watch', 'w'), mk('Tie', 'ti'), mk('Belt', 'b')];
    expect(eligibleItems(odd, ctx('Casual')).map((i) => i.id)).toEqual(['b']);
  });
});

describe('R1 occasion filter', () => {
  type Row = [top: SubType, bottom: SubType, shoe: SubType];
  const allowed: [Occasion, Row[], Row[]][] = [
    ['Casual', [['T-shirt', 'Jeans', 'Sandals'], ['Hoodie', 'Joggers', 'Sneakers'], ['T-shirt', 'Shorts', 'Sandals'], ['T-shirt', 'Jeans', 'Formal shoes']], [['T-shirt', 'Shorts', 'Formal shoes'], ['Sports T-shirt', 'Sports shorts', 'Formal shoes']]],
    ['Date', [['Polo', 'Chinos', 'Boots']], [['T-shirt', 'Shorts', 'Formal shoes']]],
    ['Travel', [['Hoodie', 'Joggers', 'Sandals']], [['T-shirt', 'Shorts', 'Formal shoes']]],
    ['Work', [['Shirt', 'Chinos', 'Formal shoes'], ['Polo', 'Trousers', 'Boots'], ['Polo', 'Chinos', 'Sneakers']], [['T-shirt', 'Chinos', 'Formal shoes'], ['Shirt', 'Jeans', 'Formal shoes'], ['Shirt', 'Chinos', 'Sandals']]],
    ['Formal', [['Shirt', 'Trousers', 'Formal shoes']], [['Polo', 'Trousers', 'Formal shoes'], ['Shirt', 'Chinos', 'Formal shoes'], ['Shirt', 'Trousers', 'Sneakers']]],
    ['Party', [['Shirt', 'Jeans', 'Sneakers'], ['Shirt', 'Trousers', 'Boots']], [['Shirt', 'Chinos', 'Sneakers'], ['Shirt', 'Jeans', 'Sandals']]],
    ['Sport', [['Sports T-shirt', 'Track pants', 'Sneakers'], ['Sports T-shirt', 'Sports shorts', 'Sneakers']], [['T-shirt', 'Track pants', 'Sneakers'], ['Sports T-shirt', 'Jeans', 'Sneakers'], ['Sports T-shirt', 'Track pants', 'Boots']]],
  ];
  const rows = allowed.flatMap(([o, yes, no]) => [...yes.map((r) => [o, ...r, 1] as const), ...no.map((r) => [o, ...r, 0] as const)]);
  it.each(rows)('%s: %s + %s + %s gives %i outfit(s)', (occasion, top, bottom, shoe, n) => {
    expect(outfitsFor([mk(top, 'top'), mk(bottom, 'bottom'), mk(shoe, 'shoe')], ctx(occasion))).toHaveLength(n);
  });
  it.each([[[214, 40, 40], 1], [[31, 42, 68], 1], [[232, 220, 194], 0], [[255, 255, 255], 0]] as [[number, number, number], number][])(
    'Party top %j (dark navy and vivid red pass, pale beige and white do not) gives %i outfit(s)', (rgb, n) => {
      expect(outfitsFor([mk('T-shirt', 't', { rgb }), mk('Jeans', 'j'), mk('Sneakers', 's')], ctx('Party'))).toHaveLength(n);
    },
  );
  it('lets a tag alone not break R1: a Work-tagged pair of sandals is still no Work footwear', () => {
    expect(outfitsFor([mk('Shirt', 't'), mk('Chinos', 'c'), mk('Sandals', 's', { occasions: ['Work'] })], ctx('Work'))).toEqual([]);
  });
  it('allows a layer only where R1 allows it (Formal: blazer yes, hoodie no; Work: any layer)', () => {
    const formal = [mk('Shirt', 't'), mk('Trousers', 'b'), mk('Formal shoes', 's')];
    expect(keys([...formal, mk('Blazer', 'l')], ctx('Formal'))).toEqual(['t/b/-/s/-', 't/b/l/s/-']);
    expect(keys([...formal, mk('Hoodie', 'l')], ctx('Formal'))).toEqual(['t/b/-/s/-']);
    expect(keys([mk('Shirt', 't'), mk('Chinos', 'b'), mk('Boots', 's'), mk('Jacket', 'l')], ctx('Work'))).toHaveLength(2);
  });
});

describe('slots, two-slot items and no item twice', () => {
  const formal = [mk('Shirt', 't'), mk('Formal shoes', 's')];
  it('places a Suit in layer and bottom at once, and never with a second layer or bottom', () => {
    const list = outfitsFor([...formal, mk('Suit', 'su'), mk('Blazer', 'bl'), mk('Trousers', 'tr')], ctx('Formal'));
    expect(list.map(key).sort()).toEqual(['t/su/su/s/-', 't/tr/-/s/-', 't/tr/bl/s/-']);
  });
  it('treats a Tuxedo like a Suit, and needs a top and footwear with it', () => {
    expect(keys([...formal, mk('Tuxedo', 'tu')], ctx('Formal'))).toEqual(['t/tu/tu/s/-']);
    expect(keys([mk('Tuxedo', 'tu'), mk('Formal shoes', 's')], ctx('Formal'))).toEqual([]);
    expect(keys([mk('Shirt', 't'), mk('Tuxedo', 'tu')], ctx('Formal'))).toEqual([]);
  });
  it('does not allow a Suit for Work or Party (its trousers are not on those lists)', () => {
    expect(keys([mk('Shirt', 't'), mk('Suit', 'su'), mk('Boots', 's')], ctx('Work'))).toEqual([]);
    expect(keys([mk('Shirt', 't'), mk('Suit', 'su'), mk('Boots', 's')], ctx('Party'))).toEqual([]);
  });
  it('puts a sweater as top or as layer, never both in one outfit', () => {
    const items = [mk('T-shirt', 't'), mk('Sweater', 'sw'), mk('Jeans', 'j'), mk('Sneakers', 's')];
    expect(keys(items, ctx('Casual', 1)).sort()).toEqual(['sw/j/-/s/-', 't/j/-/s/-', 't/j/sw/s/-']);
  });
  it('keeps belts in their own list and does not place them in the enumeration', () => {
    const items = [mk('T-shirt', 't'), mk('Jeans', 'j'), mk('Sneakers', 's'), mk('Belt', 'b'), mk('Watch', 'w')];
    expect(slotCandidates(eligibleItems(items, ctx('Casual')), ctx('Casual')).belts.map((i) => i.id)).toEqual(['b']);
    expect(outfitsFor(items, ctx('Casual')).every((o) => o.accessory === null)).toBe(true);
  });
  it.each([
    ['no bottom', [mk('T-shirt', 't'), mk('Sneakers', 's')]],
    ['no top', [mk('Jeans', 'j'), mk('Sneakers', 's')]],
    ['no footwear', [mk('T-shirt', 't'), mk('Jeans', 'j')]],
    ['only layers', [mk('Jacket', 'l'), mk('Blazer', 'b')]],
    ['empty', []],
  ] as [string, Item[]][])('a thin wardrobe (%s) gives no outfit', (_, items) => {
    expect(outfitsFor(items, ctx('Casual'))).toEqual([]);
  });
  it('flags broken outfits with outfitProblems and passes good ones', () => {
    const ok: Outfit = { top: mk('Shirt', 't'), bottom: mk('Chinos', 'b'), layer: null, footwear: mk('Boots', 's'), accessory: null };
    const sw = mk('Sweater', 'sw');
    expect(outfitProblems(ok, ctx('Work'))).toEqual([]);
    expect(outfitProblems({ ...ok, footwear: null }, ctx('Work'))).toEqual(['SLOTS']);
    expect(outfitProblems({ ...ok, top: mk('Shirt', 't', { status: 'archived' }) }, ctx('Work'))).toEqual(['R2']);
    expect(outfitProblems({ ...ok, footwear: mk('Sandals', 's') }, ctx('Work'))).toEqual(['R1']);
    expect(outfitProblems({ ...ok, top: sw, layer: sw }, ctx('Casual'))).toEqual(['DUPLICATE']);
    expect(outfitProblems({ ...ok, bottom: mk('Shorts', 'sh'), footwear: mk('Formal shoes', 'fs') }, ctx('Casual'))).toEqual(['R1']);
  });
});

describe('best eight per slot and the cheap pre-score', () => {
  it('keeps eight tops, best first: occasion match, then not Falling apart, then item ID', () => {
    const tops = [...'abcdefghij'].map((id) => mk('Shirt', id, id === 'j' ? { occasions: ['Work'] } : id === 'a' ? { condition: 90 } : {}));
    tops.push(mk('Shirt', 'k', { occasions: ['Party'] }));
    expect(slotCandidates(tops, ctx('Work')).top.map((i) => i.id)).toEqual(['j', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });
  it('treats a condition of 84 as fine and 85 as Falling apart', () => {
    const got = slotCandidates([mk('Shirt', 'a', { condition: 85 }), mk('Shirt', 'b', { condition: 84 })], ctx('Work')).top;
    expect(got.map((i) => i.id)).toEqual(['b', 'a']);
  });
  it('caps the enumeration at 8 x 8 x 8 x (8 + 1) outfits plus 8 x 8 x 8 two-slot ones', () => {
    const items = [...many('Shirt', 12), ...many('Trousers', 12), ...many('Blazer', 12), ...many('Formal shoes', 12), ...many('Suit', 12)];
    expect(outfitsFor(items, ctx('Formal'))).toHaveLength(8 * 8 * 8 * 9 + 8 * 8 * 8);
  });
});

describe('determinism and the hard rules on random wardrobes (CC3, hard-rule part)', () => {
  const channel = fc.integer({ min: 0, max: 255 });
  const item = fc.record({
    subType: fc.constantFrom(...(SUB_TYPES as SubType[])),
    rgb: fc.tuple(channel, channel, channel),
    seasons: fc.oneof(fc.constant([] as Season[]), fc.constant(['All year'] as Season[]), fc.subarray([...SEASONS] as Season[])),
    occasions: fc.subarray([...OCCASIONS]),
    condition: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    status: fc.constantFrom('active', 'active', 'active', 'archived') as fc.Arbitrary<'active' | 'archived'>,
  });
  const wardrobe = fc.array(item, { minLength: 8, maxLength: 70 }).map((rows) => rows.map((r, i) => mk(r.subType, `i${String(i).padStart(3, '0')}`, r)));
  const when = fc.record({ month: fc.integer({ min: 1, max: 12 }), hemisphere: fc.constantFrom<Hemisphere>('north', 'south') });

  // An independent statement of R1 and R2, written from FDD 14.1 and not sharing code with the engine.
  function breaks(o: Outfit, c: Ctx): string | null {
    const { top, bottom, layer, footwear } = o;
    if (!top || !bottom || !footwear) return 'slots';
    const month = c.date.getUTCMonth() + 1 + (c.hemisphere === 'south' ? 6 : 0);
    const season = ['Winter', 'Spring', 'Summer', 'Autumn'][Math.floor((month % 12) / 3)] as Season;
    const all = [top, bottom, layer, footwear].filter((i): i is Item => i !== null);
    for (const i of all) {
      if (i.status !== 'active') return 'archived';
      if (i.seasons.length > 0 && !i.seasons.includes(season) && !i.seasons.includes('All year')) return 'season';
      if (season === 'Summer' && ['Coat', 'Sweater', 'Cardigan'].includes(i.subType)) return 'summer';
    }
    const twoSlot = layer !== null && layer === bottom;
    if (new Set(all).size !== all.length - (twoSlot ? 1 : 0) || (twoSlot && !['Suit', 'Tuxedo'].includes(layer.subType))) return 'twice';
    const [t, bot, shoe, lay] = [top.subType, bottom.subType, footwear.subType, layer?.subType];
    const [L, a, b] = rgbToLab(...top.rgb);
    const occ = c.occasion === 'Date' || c.occasion === 'Travel' ? 'Casual' : c.occasion;
    const ok = {
      Casual: !(shoe === 'Formal shoes' && (bot === 'Shorts' || bot === 'Sports shorts')),
      Work: ['Shirt', 'Polo'].includes(t) && ['Chinos', 'Trousers'].includes(bot) && ['Sneakers', 'Formal shoes', 'Boots'].includes(shoe),
      Formal: t === 'Shirt' && ['Trousers', 'Suit', 'Tuxedo'].includes(bot) && shoe === 'Formal shoes' && (!lay || ['Blazer', 'Suit', 'Tuxedo'].includes(lay)),
      Party: ['Jeans', 'Trousers'].includes(bot) && ['Sneakers', 'Boots'].includes(shoe) && (L < 40 || Math.hypot(a, b) > 50),
      Sport: t === 'Sports T-shirt' && ['Track pants', 'Sports shorts'].includes(bot) && shoe === 'Sneakers',
    }[occ as 'Casual'];
    return ok ? null : 'occasion';
  }

  it('every enumerated outfit passes R1, R2 and the slots, with no item twice (200 wardrobes x 7 occasions)', () => {
    let total = 0;
    fc.assert(
      fc.property(wardrobe, when, (items, w) => {
        for (const occasion of OCCASIONS) {
          const c = ctx(occasion, w.month, w.hemisphere);
          for (const o of outfitsFor(items, c)) {
            total++;
            expect(breaks(o, c)).toBeNull();
            expect(outfitProblems(o, c)).toEqual([]);
          }
        }
      }),
      { numRuns: 200, seed: 20261104 },
    );
    expect(total).toBeGreaterThan(100);
  });
  it('gives the same outfits in the same order when the input order is reversed or rotated', () => {
    fc.assert(
      fc.property(wardrobe, when, (items, w) => {
        for (const occasion of OCCASIONS) {
          const c = ctx(occasion, w.month, w.hemisphere);
          const expected = keys(items, c);
          expect(keys([...items].reverse(), c)).toEqual(expected);
          expect(keys([...items.slice(3), ...items.slice(0, 3)], c)).toEqual(expected);
        }
      }),
      { numRuns: 100, seed: 20261104 },
    );
  });
});
