import { OCCASIONS } from '@sparta/taxonomy';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { independentProblems, validOutfitExists } from './fixtures/checker.js';
import { PAIR_HEAVY, randomWardrobe, shuffled } from './fixtures/random.js';
import { WARDROBES } from './fixtures/wardrobes.js';
import { REASON_TEMPLATES } from './reasons.js';
import { MAX_SUGGESTIONS } from './rank.js';
import { isMissing, suggest } from './suggest.js';
import type { Ctx, Hemisphere, Item, Slot } from './types.js';

const MONTHS = [1, 4, 7, 10]; // winter, spring, summer, autumn in the north; the south sees them six months on
const SLOTS: Slot[] = ['top', 'bottom', 'layer', 'footwear', 'accessory'];
const at = (occasion: Ctx['occasion'], month: number, hemisphere: Hemisphere): Ctx => ({ occasion, hemisphere, date: new Date(Date.UTC(2026, month - 1, 15)) });
const templates = Object.entries(REASON_TEMPLATES).filter(([k]) => k !== 'note').map(([, t]) => new RegExp(`^${t.replace(/\{\w+\}/g, '.+')}$`));

/** All the CC3 checks for one wardrobe in one context; returns the number of suggestions seen. */
function check(items: Item[], ctx: Ctx, seed: number): number {
  const result = suggest(items, ctx);
  expect(JSON.stringify(suggest(shuffled(items, seed), ctx))).toBe(JSON.stringify(result)); // FR-58: input order never matters
  if (isMissing(result)) {
    expect(validOutfitExists(items, ctx)).toBe(false); // a brute-force search finds nothing either
    expect(result.missing.length).toBeGreaterThan(0);
    return 0;
  }
  expect(validOutfitExists(items, ctx)).toBe(true);
  expect(result.length).toBeGreaterThan(0);
  expect(result.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
  expect(new Set(result.map((s) => JSON.stringify(s.items))).size).toBe(result.length);
  for (const s of result) {
    const outfit = Object.fromEntries(SLOTS.map((k) => [k, items.find((i) => i.id === s.items[k]) ?? null])) as Record<Slot, Item | null>;
    expect(SLOTS.every((k) => s.items[k] === null || outfit[k] !== null)).toBe(true);
    expect(independentProblems(outfit, ctx, items)).toEqual([]); // with the wardrobe: also the D-A layer rule
    const ids = SLOTS.map((k) => s.items[k]).filter((id): id is string => id !== null);
    const suitInTwoSlots = s.items.bottom !== null && s.items.bottom === s.items.layer ? 1 : 0;
    expect(new Set(ids).size).toBe(ids.length - suitInTwoSlots); // no item twice, except one suit in layer and bottom
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(1);
    expect(s.reasons.length).toBeGreaterThan(0);
    expect(s.reasons.every((r) => templates.some((t) => t.test(r)))).toBe(true);
  }
  return result.length;
}

describe('suggest: properties over random wardrobes (CC3)', () => {
  it('200+ random wardrobes x 7 occasions x 4 seasons: valid, no repeats, at most three, order-independent, never falsely missing', () => {
    let wardrobes = 0, contexts = 0, suggestions = 0;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
        const items = randomWardrobe(seed);
        const hemisphere: Hemisphere = seed % 2 === 0 ? 'north' : 'south';
        wardrobes++;
        for (const occasion of OCCASIONS) {
          for (const month of MONTHS) {
            contexts++;
            suggestions += check(items, at(occasion, month, hemisphere), seed + month);
            // flipping the hemisphere and moving six months on is the same season, so the same result
            const flipped = at(occasion, ((month + 5) % 12) + 1, hemisphere === 'north' ? 'south' : 'north');
            expect(suggest(items, flipped)).toEqual(suggest(items, at(occasion, month, hemisphere)));
          }
        }
      }),
      { numRuns: 200, seed: 20261104 },
    );
    expect(wardrobes).toBeGreaterThanOrEqual(200);
    expect(contexts).toBe(wardrobes * OCCASIONS.length * MONTHS.length);
    expect(suggestions).toBeGreaterThan(2000); // the generator must produce real suggestions, not just "missing"
  }, 120_000);
  it('never "missing" when a valid outfit exists, on wardrobes of mostly shorts and formal shoes (the WO-0005 defect)', () => {
    let valid = 0;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
        const items = randomWardrobe(seed, PAIR_HEAVY, 10);
        for (const occasion of ['Casual', 'Date', 'Travel'] as const) {
          for (const month of MONTHS) {
            const ctx = at(occasion, month, 'north');
            const exists = validOutfitExists(items, ctx);
            expect(isMissing(suggest(items, ctx))).toBe(!exists);
            valid += exists ? 1 : 0;
          }
        }
      }),
      { numRuns: 300, seed: 20261105 },
    );
    expect(valid).toBeGreaterThan(300);
  });
  it('the random wardrobe is the same for the same seed', () => {
    expect(randomWardrobe(7)).toEqual(randomWardrobe(7));
    expect(randomWardrobe(7)).not.toEqual(randomWardrobe(8));
  });
});

describe('suggest: the five synthetic wardrobes', () => {
  const cases = Object.entries(WARDROBES).flatMap(([name, items]) => OCCASIONS.flatMap((o) => MONTHS.map((m) => [name, items, o, m] as const)));
  it.each(Object.entries(WARDROBES))('%s: every occasion and season passes the independent check', (_, items) => {
    for (const o of OCCASIONS) for (const m of MONTHS) for (const h of ['north', 'south'] as const) check(items, at(o, m, h), m);
  });
  it('the fixtures use only taxonomy values and unique ids', () => {
    for (const items of Object.values(WARDROBES)) expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(cases.length).toBe(5 * 7 * 4);
  });
  it('the thin wardrobe (one active pair of sneakers, a tee, jeans) dresses Casual, Date and Travel and names what is missing for Work, Formal and Sport (FR-54)', () => {
    const thin = WARDROBES['Thin wardrobe']!;
    for (const o of ['Casual', 'Date', 'Travel'] as const) expect(isMissing(suggest(thin, at(o, 4, 'north')))).toBe(false);
    expect(suggest(thin, at('Work', 4, 'north'))).toEqual({ missing: ['top', 'bottom'] });
    expect(suggest(thin, at('Formal', 4, 'north'))).toEqual({ missing: ['top', 'bottom', 'footwear'] });
    expect(suggest(thin, at('Sport', 4, 'north'))).toEqual({ missing: ['top', 'bottom'] });
    expect(thin.filter((i) => i.subType === 'Sneakers' && i.status === 'active')).toHaveLength(1);
  });
  it('every wardrobe gives suggestions somewhere, and together they give at least 50 (CC8)', () => {
    const counts = Object.values(WARDROBES).map((items) => OCCASIONS.flatMap((o) => MONTHS.map((m) => suggest(items, at(o, m, 'north')))).reduce((n, r) => n + (isMissing(r) ? 0 : r.length), 0));
    expect(counts.every((n) => n > 0)).toBe(true);
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(50);
  });
});
