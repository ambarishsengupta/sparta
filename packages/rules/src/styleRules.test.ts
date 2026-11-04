import { OCCASIONS } from '@sparta/taxonomy';
import type { ColourFamily, Occasion, Pattern, SubType } from '@sparta/taxonomy';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import rules from '../data/rules.json';
import { enumerateOutfits, outfitProblems, slotCandidates } from './combinations.js';
import type { Outfit } from './combinations.js';
import { eligibleItems } from './eligibility.js';
import { independentProblems } from './fixtures/checker.js';
import { at, mk } from './fixtures/items.js';
import { randomWardrobe } from './fixtures/random.js';
import { reasonsFor } from './reasons.js';
import { createScorer } from './score.js';
import type { Evaluation } from './score.js';
import { isMissing, suggest } from './suggest.js';
import type { Hemisphere, Item } from './types.js';

// The AI style review of 2026-11-04 (draft rules, pending Arpan Shah). Every hard rule is a row in HARD below and is
// asserted three times over: against the engine's outfitProblems, the engine's enumeration and the independent checker.
type P = SubType | [SubType, Partial<Item>];
type Row = [occasion: Occasion, month: number, top: P, bottom: P, shoes: P, layer: P | null, ok: boolean, hemisphere?: Hemisphere];
const RED = { rgb: [214, 40, 40], colourFamily: 'Red' } as const, GREEN = { rgb: [40, 160, 70], colourFamily: 'Green' } as const;
const name = (p: P | null): string => (p === null ? '-' : typeof p === 'string' ? p : `${p[0]} ${Object.values(p[1]).join('/')}`);
const build = (r: Row): { outfit: Outfit; items: Item[] } => {
  const one = (p: P | null, id: string): Item | null => (p === null ? null : typeof p === 'string' ? mk(p, id) : mk(p[0], id, p[1]));
  const [top, bottom, footwear, layer] = [one(r[2], 't'), one(r[3], 'b'), one(r[4], 's'), one(r[5], 'l')];
  const suit = bottom !== null && ['Suit', 'Tuxedo'].includes(bottom.subType);
  const outfit = { top, bottom, layer: suit ? bottom : layer, footwear, accessory: null } as Outfit;
  return { outfit, items: [top, bottom, footwear, layer].filter((i): i is Item => i !== null) };
};
const key = (o: Outfit): string => (['top', 'bottom', 'layer', 'footwear'] as const).map((s) => o[s]?.id ?? '-').join('/');
const enumerated = (items: Item[], c: ReturnType<typeof at>): Outfit[] => enumerateOutfits(slotCandidates(eligibleItems(items, c), c), c);

const sport = (layer: SubType, ok: boolean): Row => ['Sport', 4, 'Sports T-shirt', 'Track pants', 'Sneakers', layer, ok];
const work = (layer: P | null, ok: boolean, top: P = 'Shirt'): Row => ['Work', 4, top, 'Chinos', 'Boots', layer, ok];
const HARD: Row[] = [
  // (2) activewear: Date and Travel have their own entries; Casual still takes any tops and bottoms; Sport layers are limited
  ...(['Date', 'Travel'] as const).flatMap((o): Row[] => [
    [o, 4, 'Sports T-shirt', 'Jeans', 'Sneakers', null, false], [o, 4, 'T-shirt', 'Sports shorts', 'Sneakers', null, false],
    [o, 4, 'T-shirt', 'Track pants', 'Sneakers', null, false], [o, 4, 'T-shirt', 'Jeans', 'Sneakers', null, true],
  ]),
  ['Casual', 4, 'Sports T-shirt', 'Track pants', 'Sneakers', null, true], ['Casual', 4, 'Sports T-shirt', 'Sports shorts', 'Sneakers', null, true],
  sport('Track jacket', true), sport('Hoodie', true), sport('Jacket', true), ...(['Blazer', 'Coat', 'Cardigan', 'Sweater', 'Waistcoat'] as const).map((l) => sport(l, false)),
  // (3) season: winter and autumn exclusions, the Sport exemption, the southern hemisphere
  ['Casual', 1, 'T-shirt', 'Shorts', 'Sneakers', null, false], ['Casual', 1, 'T-shirt', 'Sports shorts', 'Sneakers', null, false], ['Casual', 1, 'T-shirt', 'Jeans', 'Sandals', null, false],
  ['Sport', 1, 'Sports T-shirt', 'Sports shorts', 'Sneakers', null, true], ['Sport', 1, 'Sports T-shirt', 'Track pants', 'Sneakers', null, true],
  ['Casual', 10, 'T-shirt', 'Jeans', 'Sandals', null, false], ['Casual', 10, 'T-shirt', 'Shorts', 'Sneakers', null, true], ['Casual', 4, 'T-shirt', 'Jeans', 'Sandals', null, true], ['Casual', 7, 'T-shirt', 'Shorts', 'Sandals', null, true],
  ['Casual', 7, 'T-shirt', 'Shorts', 'Sneakers', null, false, 'south'], ['Casual', 1, 'T-shirt', 'Shorts', 'Sneakers', null, true, 'south'], ['Casual', 12, 'T-shirt', 'Shorts', 'Sandals', null, false, 'north'],
  // (4) formality: no Suit or Tuxedo as a Casual or Travel bottom (Date and Formal keep them); formal shoes with a T-shirt, Polo or Hoodie top or layer
  ...(['Suit', 'Tuxedo'] as const).flatMap((s): Row[] => [['Casual', 4, 'Shirt', s, 'Sneakers', null, false], ['Travel', 4, 'Shirt', s, 'Sneakers', null, false], ['Date', 4, 'Shirt', s, 'Sneakers', null, true], ['Formal', 4, 'Shirt', s, 'Formal shoes', null, true]]),
  ...(['Casual', 'Date', 'Travel'] as const).flatMap((o): Row[] => [
    ...(['T-shirt', 'Polo', 'Hoodie'] as const).map((t): Row => [o, 4, t, 'Jeans', 'Formal shoes', null, false]),
    [o, 4, 'Shirt', 'Jeans', 'Formal shoes', 'Hoodie', false], [o, 4, 'Shirt', 'Jeans', 'Formal shoes', null, true], [o, 4, 'T-shirt', 'Jeans', 'Boots', null, true],
  ]),
  ['Work', 4, 'Polo', 'Chinos', 'Formal shoes', null, true],
  // (5) Work: layer list, patterns, one bold item (a bold colour in a neutral family is not bold; Casual has no such cap)
  work('Hoodie', false), work('Track jacket', false), work('Jacket', false), work('Sherwani', false),
  ...(['Blazer', 'Coat', 'Cardigan', 'Sweater', 'Waistcoat', 'Nehru jacket'] as const).map((l) => work(l, true)),
  ...(['Printed', 'Graphic'] as Pattern[]).flatMap((p) => [work(null, false, ['Shirt', { pattern: p }]), work(null, false, ['Polo', { pattern: p }])]),
  ...(['Striped', 'Checked', 'Solid'] as Pattern[]).map((p) => work(null, true, ['Shirt', { pattern: p }])), work(null, true, ['Shirt', { pattern: null }]),
  ['Casual', 4, ['T-shirt', { pattern: 'Graphic' }], 'Jeans', 'Sneakers', null, true],
  ['Work', 4, ['Shirt', RED], ['Chinos', GREEN], 'Boots', null, false], ['Work', 4, ['Shirt', RED], 'Chinos', ['Sneakers', GREEN], null, false],
  ['Work', 4, ['Shirt', RED], 'Chinos', 'Boots', ['Blazer', GREEN], false], ['Work', 4, ['Shirt', RED], 'Chinos', 'Boots', null, true],
  ['Work', 4, ['Shirt', { ...RED, colourFamily: 'Navy' }], ['Chinos', GREEN], 'Boots', null, true], ['Casual', 4, ['T-shirt', RED], ['Jeans', GREEN], 'Sneakers', null, true],
];

describe('the style review hard rules: the engine and the independent checker agree on every row', () => {
  it.each(HARD.map((r) => [`${r[0]} m${r[1]}${r[7] === 'south' ? 's' : ''}: ${name(r[2])} + ${name(r[3])} + ${name(r[4])} + ${name(r[5])} -> ${r[6] ? 'ok' : 'refused'}`, r] as const))('%s', (_, r) => {
    const { outfit, items } = build(r);
    const c = at(r[0], r[1], r[7] ?? 'north');
    expect(outfitProblems(outfit, c).length === 0, 'engine outfitProblems').toBe(r[6]);
    expect(independentProblems(outfit, c).length === 0, 'independent checker').toBe(r[6]);
    expect(enumerated(items, c).some((o) => key(o) === key(outfit)), 'engine enumeration').toBe(r[6]);
  });
  it('every outfit the engine enumerates for random wardrobes passes the independent checker', () => {
    let seen = 0;
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
      const items = randomWardrobe(seed, undefined, 12);
      for (const occasion of OCCASIONS) for (const month of [1, 4, 7, 10]) {
        const c = at(occasion, month);
        for (const o of enumerated(items, c)) { seen++; expect(independentProblems(o, c), `${occasion} ${month} ${key(o)}`).toEqual([]); }
      }
    }), { numRuns: 60, seed: 20261106 });
    expect(seen).toBeGreaterThan(2000);
  });
  it('best-eight trimming keeps a trio R1 allows: eight tops that may not go with formal shoes, then one shirt', () => {
    const tees = Array.from({ length: 9 }, (_, n) => mk('T-shirt', `t${n}`, { occasions: ['Casual'] }));
    const r = suggest([...tees, mk('Shirt', 'zshirt'), mk('Jeans', 'j'), mk('Formal shoes', 'f')], at('Casual', 4));
    expect(isMissing(r) ? [] : r.map((s) => s.items.top)).toEqual(['zshirt']);
    expect(suggest([...tees, mk('Jeans', 'j'), mk('Formal shoes', 'f')], at('Casual', 4))).toEqual({ missing: ['bottom', 'footwear'] });
  });
});

describe('R3 colour: clashing families and the family limit (scored, draft)', () => {
  const PALE = [230, 170, 170] as const;
  const r3 = (occasion: Occasion, ...families: ColourFamily[]): number => {
    const [top, bottom, footwear, layer] = families.map((colourFamily, n) => mk((['Shirt', 'Chinos', 'Boots', 'Blazer'] as const)[n]!, `x${n}`, { colourFamily, rgb: PALE }));
    return createScorer(at(occasion, 4), false).evaluate({ top: top!, bottom: bottom!, footwear: footwear!, layer: layer ?? null, accessory: null }).rules.R3;
  };
  it('rules.json lists the five pairs and a penalty of 0.3, marked as the AI style review draft', () => {
    expect(rules.clashing_family_pairs).toEqual([['Red', 'Purple'], ['Red', 'Yellow'], ['Pink', 'Yellow'], ['Pink', 'Purple'], ['Green', 'Red']]);
    expect(rules.penalties.clashing_pair).toBe(0.3);
    expect(rules.clashing_family_pairs_note).toContain('AI style review 2026-11-04, pending Arpan Shah');
  });
  it.each([['Red', 'Purple'], ['Red', 'Yellow'], ['Pink', 'Yellow'], ['Pink', 'Purple'], ['Green', 'Red']] as [ColourFamily, ColourFamily][])('%s with %s takes 0.3 off R3, in either order', (a, b) => {
    expect(r3('Casual', a, b, 'Navy')).toBeCloseTo(0.7, 12);
    expect(r3('Casual', b, 'Navy', a)).toBeCloseTo(0.7, 12);
  });
  it('other pairs, and a clashing family beside a neutral, take nothing; each pair present counts once', () => {
    expect([r3('Casual', 'Red', 'Blue', 'Navy'), r3('Casual', 'Red', 'Grey', 'Black'), r3('Casual', 'Purple', 'Yellow', 'Navy')]).toEqual([1, 1, 1]);
    expect(r3('Casual', 'Red', 'Purple', 'Yellow')).toBeCloseTo(0.4, 12);
  });
  it('allows two non-neutral families for Work, Formal and Date and three elsewhere (0.34 off for each family over)', () => {
    for (const o of ['Work', 'Formal', 'Date'] as const) expect([o, r3(o, 'Pink', 'Teal', 'Blue')]).toEqual([o, expect.closeTo(0.66, 12)]);
    for (const o of ['Casual', 'Travel', 'Party', 'Sport'] as const) expect([o, r3(o, 'Pink', 'Teal', 'Blue')]).toEqual([o, 1]);
    expect(r3('Work', 'Pink', 'Teal', 'Navy')).toBe(1);
  });
  it('ranks the outfit without a clash first, though the clashing one would win the ID tie-break', () => {
    const items = [mk('T-shirt', 'a-red', RED), mk('T-shirt', 'b-blue', { colourFamily: 'Blue', rgb: PALE }), mk('Jeans', 'j', { colourFamily: 'Purple', rgb: PALE }), mk('Sneakers', 's')];
    const r = suggest(items, at('Casual', 4));
    expect(isMissing(r) ? [] : r.map((s) => s.items.top)).toEqual(['b-blue', 'a-red']);
  });
});

describe('R8 reasons: wording, and the tag sentence only when occasion_fit is 1', () => {
  const ev = (occasion_fit: number): Evaluation => ({ score: 0, parts: { occasion_fit } as Evaluation['parts'], rules: { R3: 0, R4: 0, R5: 0, R6: 0 }, neutrals: [], cool: false, beltMatches: false });
  it('has the new r1 and r2 wording and the r_tagged template, marked as draft', () => {
    expect([rules.reason_templates.r1, rules.reason_templates.r2, rules.reason_templates.r_tagged]).toEqual(['Meets the {occasion} dress rule', 'Nothing is out of season for {season}', 'Every piece is tagged for {occasion}']);
    expect(rules.reason_templates.note).toContain('AI style review 2026-11-04, pending Arpan Shah');
  });
  it('gives the tag sentence at exactly 1 and not at 0.99, 0.5 or 0', () => {
    expect(reasonsFor(ev(1), at('Work', 4)).reasons).toEqual(['Meets the Work dress rule', 'Nothing is out of season for Spring', 'Every piece is tagged for Work']);
    for (const n of [0.99, 0.5, 0]) expect(reasonsFor(ev(n), at('Work', 4)).reasons).toEqual(['Meets the Work dress rule', 'Nothing is out of season for Spring']);
  });
  it('through suggest: all pieces tagged gives it, one untagged, one tagged for another occasion or none tagged does not', () => {
    const tagged = (o: Occasion[]): Item[] => [mk('T-shirt', 't', { occasions: ['Casual'] }), mk('Jeans', 'j', { occasions: ['Casual'] }), mk('Sneakers', 's', { occasions: o })];
    const reasons = (items: Item[]): string[] => { const r = suggest(items, at('Casual', 4)); return isMissing(r) ? [] : r[0]!.reasons; };
    expect(reasons(tagged(['Casual', 'Work']))).toContain('Every piece is tagged for Casual');
    expect(reasons(tagged(['Work']))).not.toContain('Every piece is tagged for Casual');
    expect(reasons(tagged([]))).not.toContain('Every piece is tagged for Casual');
    expect(reasons([mk('T-shirt', 't'), mk('Jeans', 'j'), mk('Sneakers', 's')])).not.toContain('Every piece is tagged for Casual');
  });
});

describe('draft marking (decision D-B)', () => {
  it('every rule adopted from the AI style review carries the marker in its notes', () => {
    const mark = 'AI style review 2026-11-04, pending Arpan Shah';
    const notes = [rules.season_rules.Autumn.note, rules.season_rules.Winter.note, ...(['Casual', 'Work', 'Formal', 'Sport', 'Date', 'Travel'] as const).map((o) => (rules.occasions[o] as { note: string }).note), rules.penalties.clashing_pair_note, rules.clashing_family_pairs_note];
    expect(notes.filter((n) => !n.includes(mark))).toEqual([]);
  });
});
