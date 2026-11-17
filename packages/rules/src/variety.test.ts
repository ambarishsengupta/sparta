import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { enumerateOutfits, slotCandidates } from './combinations.js';
import { eligibleItems } from './eligibility.js';
import { FOOTWEAR_HEAVY, randomWardrobe, shuffled } from './fixtures/random.js';
import { at, mk } from './fixtures/items.js';
import { pickVariety } from './rank.js';
import type { Scored } from './rank.js';
import type { Evaluation } from './score.js';
import { isMissing, suggest } from './suggest.js';
import type { RankedSuggestion } from './suggest.js';

const sugg = (items: Parameters<typeof suggest>[0], c = at('Casual', 4)): RankedSuggestion[] => {
  const r = suggest(items, c);
  return isMissing(r) ? expect.fail(`missing ${r.missing.join()}`) : r;
};
const sets = (r: RankedSuggestion[]): string[] => r.map((s) => Object.values(s.items).filter(Boolean).sort().join());
/** A hand-made scored outfit: only its item IDs, score and arrangement matter to pickVariety. */
const S = (ids: string[], score: number, order = ids.join()): Scored =>
  ({ outfit: null as never, evaluation: { score } as Evaluation, ids, key: [...ids].sort().join('\u0001'), order });
const firsts = (pool: Scored[], limit = 3): string[] => pickVariety(pool, limit).map((s) => s.ids.join('+'));

describe('no duplicate suggestions (WO-0006 item 2)', () => {
  const formal = Array.from({ length: 9 }, (_, n) => mk('Formal shoes', `f${n}`, { occasions: ['Casual'] }));
  const wardrobe = [mk('T-shirt', 't'), mk('Shorts', 'sh'), ...formal, mk('Sneakers', 'zs')];
  it('repro: a tee, one pair of shorts, nine Casual-tagged formal shoes and sneakers give one outfit, not two identical ones', () => {
    expect(sugg(wardrobe).map((s) => s.items)).toEqual([{ top: 't', bottom: 'sh', layer: null, footwear: 'zs', accessory: null }]);
  });
  it('combinations: the kept bottom is not added a second time, so each outfit is enumerated once', () => {
    const c = slotCandidates(eligibleItems(wardrobe, at('Casual', 4)), at('Casual', 4));
    expect(c.bottom.map((i) => i.id)).toEqual(['sh']);
    const keys = enumerateOutfits(c, at('Casual', 4)).map((o) => `${o.top?.id}/${o.bottom?.id}/${o.footwear?.id}`);
    expect(keys).toEqual(['t/sh/zs']);
  });
  it('ranking: outfits with the same items in other slots (sweater and cardigan swapped) count once', () => {
    const items = [mk('Sweater', 'sw'), mk('Cardigan', 'cd'), mk('Jeans', 'j'), mk('Sneakers', 's')];
    expect(sugg(items, at('Casual', 1)).map((s) => s.items)).toHaveLength(1);
  });
  it('pickVariety skips a candidate whose item set was already chosen', () => {
    expect(firsts([S(['a', 'b'], 0.9, 'x'), S(['b', 'a'], 0.8, 'y'), S(['c', 'd'], 0.1)])).toEqual(['a+b', 'c+d']);
  });
  it('property: wardrobes with nine or more shoes never give two suggestions with the same items (200 wardrobes x 3 occasions x 4 seasons)', () => {
    let many = 0;
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
      const items = randomWardrobe(seed, FOOTWEAR_HEAVY, 12);
      many += items.filter((i) => i.category === 'Footwear' && i.status === 'active').length >= 9 ? 1 : 0;
      for (const o of ['Casual', 'Date', 'Travel'] as const) for (const m of [1, 4, 7, 10]) {
        const r = suggest(items, at(o, m));
        if (!isMissing(r)) expect(new Set(sets(r)).size).toBe(r.length);
      }
    }), { numRuns: 200, seed: 20261106 });
    expect(many).toBeGreaterThan(100);
  });
});

describe('R7 variety (WO-0006 item 4)', () => {
  const stripy = [0, 1, 2].map((n) => mk('T-shirt', `t${n}`, { pattern: 'Striped', occasions: ['Casual'] }));
  const jeans = mk('Jeans', 'J', { occasions: ['Casual'] });
  const other = mk('Jeans', 'j2', { occasions: ['Formal'], condition: 95, pattern: 'Checked' });
  const repro = [...stripy, jeans, other, mk('Sneakers', 'S')];
  it('repro: the best jeans are not in all three suggestions when the other jeans can be used (the shoes cannot be avoided, so they are not counted)', () => {
    const r = sugg(repro);
    expect(r.map((s) => s.items.bottom)).toEqual(['J', 'J', 'j2']);
    expect(r.map((s) => s.items.footwear)).toEqual(['S', 'S', 'S']);
  });
  it('the result does not depend on the input order', () => {
    expect(sugg(shuffled(repro, 5))).toEqual(sugg(repro));
  });
  it('variety_reuse: the second pick shares as little as possible with the first, even at a lower score', () => {
    const items = [mk('T-shirt', 't1', { favourite: true }), mk('T-shirt', 't2'), mk('Jeans', 'J1', { favourite: true }), mk('Jeans', 'J2'), mk('Sneakers', 'S')];
    expect(sugg(items).map((s) => [s.items.top, s.items.bottom])).toEqual([['t1', 'J1'], ['t2', 'J2'], ['t2', 'J1']]);
  });
  it('the reuse penalty is taken once per item already chosen', () => {
    // A (score 1) is chosen; B shares two ids (0.95 - 0.2), C shares one (0.9 - 0.1): C wins only with a penalty above 0.05 per shared item.
    expect(firsts([S(['a', 'b', 'x'], 1), S(['a', 'b', 'y'], 0.95), S(['a', 'z', 'w'], 0.9)], 2)).toEqual(['a+b+x', 'a+z+w']);
  });
  it('third pick: avoids ids in both earlier picks that a remaining outfit can avoid, fewest first, before looking at the score', () => {
    // X and Y are in the first two picks. C1 holds both, C2 only X, C3 only Y; none avoids both, and C1 has the best score.
    const pool = [S(['X', 'Y', 'p'], 1), S(['X', 'Y', 'q'], 0.99), S(['X', 'Y', 'r'], 0.95), S(['X', 'z'], 0.8), S(['Y', 'w'], 0.7)];
    expect(firsts(pool)).toEqual(['X+Y+p', 'X+Y+q', 'X+z']);
  });
  it('third pick: an id no remaining outfit can avoid is ignored', () => {
    expect(firsts([S(['X', 'Y', 'p'], 1), S(['X', 'Y', 'q'], 0.99), S(['X', 'a'], 0.5), S(['X', 'Y', 'r'], 0.9)])).toEqual(['X+Y+p', 'X+Y+q', 'X+a']);
  });
  it('ties go to the smaller sorted ids, then the smaller slot order, whatever the pool order (M10)', () => {
    for (const pool of [[S(['z'], 0.5), S(['a'], 0.5)], [S(['a'], 0.5), S(['z'], 0.5)]]) expect(firsts(pool, 1)).toEqual(['a']);
    for (const pool of [[S(['a', 'b'], 0.5, 'b,a'), S(['a', 'b'], 0.5, 'a,b')], [S(['a', 'b'], 0.5, 'a,b'), S(['a', 'b'], 0.5, 'b,a')]]) {
      expect(pickVariety(pool, 1)[0]!.order).toBe('a,b');
    }
  });
});
