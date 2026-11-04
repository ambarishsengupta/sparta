import { COLOUR_FAMILIES, OCCASIONS, SUB_TYPES, conditionBandOf, hexToRgb, swatches } from '@sparta/taxonomy';
import type { SubType } from '@sparta/taxonomy';
import { describe, expect, it } from 'vitest';
import fallbackJson from '../data/unlock-fallback.json';
import priorJson from '../data/fixtures/pairing-prior.fixture.json';
import rules from '../data/rules.json';
import type { Outfit } from './combinations.js';
import { engineConfig } from './config.js';
import { independentFits, independentProblems } from './fixtures/checker.js';
import { at, deepFreeze, mk } from './fixtures/items.js';
import { randomWardrobe, shuffled } from './fixtures/random.js';
import { WARDROBES } from './fixtures/wardrobes.js';
import { createScorer } from './score.js';
import { FALLBACK_LIST, pretendItem, unlock } from './unlock.js';
import type { Candidate } from './unlock.js';
import type { Ctx, Item } from './types.js';

const isSuit = (i: Item): boolean => ['Suit', 'Tuxedo'].includes(i.subType);
const J = JSON.stringify;

/**
 * An independent counter, written from LLD 9.5.2 and nothing else in the engine except the score of an outfit (`evaluate().parts.rule_fit`):
 * add one pretend item, bound each slot to the 20 best existing items by pre-score then id, try every combination that holds the pretend item,
 * count those that pass the independent hard-rule checker and have rule_fit of at least 0.6. Returns the count and how many passed the hard rules.
 */
function brute(items: Item[], ctx: Ctx, cand: Candidate): { n: number; hard: number } {
  const p = mk(cand.sub_type, 'pretend', { rgb: hexToRgb(swatches.find((s) => s.family === cand.colour_family)!.hex), colourFamily: cand.colour_family, seasons: ['All year'] });
  const pre = (i: Item): number => 2 * (i.occasions.length === 0 ? 0.5 : i.occasions.includes(ctx.occasion) ? 1 : 0) + (i.condition !== null && conditionBandOf(i.condition) === 'Falling apart' ? 0 : 1);
  const bounded = (keep: (i: Item) => boolean): Item[] => items.filter(keep).sort((a, b) => pre(b) - pre(a) || (a.id < b.id ? -1 : 1)).slice(0, 20);
  const [top, bottom, layer, footwear] = (['top', 'bottom', 'layer', 'footwear'] as const).map((s) => [...bounded((i) => !isSuit(i) && independentFits(i, ctx, s)), ...(!isSuit(p) && independentFits(p, ctx, s) ? [p] : [])]);
  const suits = [...bounded((i) => isSuit(i) && independentFits(i, ctx)), ...(isSuit(p) && independentFits(p, ctx) ? [p] : [])];
  const scorer = createScorer(ctx, false);
  let [n, hard] = [0, 0];
  const tally = (o: Outfit): void => {
    if (![o.top, o.bottom, o.layer, o.footwear].includes(p) || independentProblems(o, ctx).length > 0) return;
    hard++;
    if (scorer.evaluate(o).parts.rule_fit >= rules.unlock_min_rule_fit) n++;
  };
  for (const t of top!) for (const f of footwear!) {
    for (const b of bottom!) for (const l of [null, ...layer!]) tally({ top: t, bottom: b, layer: l, footwear: f, accessory: null });
    for (const s of suits) tally({ top: t, bottom: s, layer: s, footwear: f, accessory: null });
  }
  return { n, hard };
}

const TOPS_HEAVY: SubType[] = ['T-shirt', 'T-shirt', 'T-shirt', 'T-shirt', 'Shirt', 'Polo', 'Sweater', 'Jeans', 'Chinos', 'Sneakers', 'Boots'];
const BOTTOMS_HEAVY: SubType[] = ['Jeans', 'Jeans', 'Jeans', 'Chinos', 'Chinos', 'Trousers', 'Shorts', 'T-shirt', 'Shirt', 'Sneakers', 'Boots', 'Hoodie'];

describe('Wardrobe unlock: "exactly N new outfits" (CC8)', () => {
  it('equals the independent brute-force count over the same bounded sets, on 60 random and 12 crowded wardrobes (some slots over the bound of 20)', () => {
    let [wardrobes, claimed, withResults, dropped, over20] = [0, 0, 0, 0, 0];
    for (let seed = 1; seed <= 72; seed++) {
      const heavy = seed > 60, pool = seed % 2 ? TOPS_HEAVY : BOTTOMS_HEAVY;
      const items = heavy ? randomWardrobe(seed, pool, 60) : randomWardrobe(seed, undefined, 8);
      const ctx = at(OCCASIONS[seed % 7]!, [1, 4, 7, 10][seed % 4]!, seed % 3 ? 'north' : 'south');
      const hm = Array.from({ length: 8 }, (_, k) => FALLBACK_LIST[(seed * 5 + k) % FALLBACK_LIST.length]!);
      const counts = hm.map((c) => ({ c, ...brute(items, ctx, c) }));
      const best = new Map<string, number>();
      for (const { c, n } of counts) best.set(c.sub_type, Math.max(best.get(c.sub_type) ?? 0, n));
      const result = unlock(items, ctx, { unlockList: 'hm', hm });
      expect(result.map((r) => r.newOutfits), `seed ${seed}`).toEqual([...best.values()].filter((n) => n > 0).sort((a, b) => b - a).slice(0, 3));
      for (const r of result) expect(counts.find(({ c }) => c.sub_type === r.subType && c.colour_family === r.colourFamily)?.n).toBe(r.newOutfits);
      wardrobes++; claimed += result.length; withResults += result.length > 0 ? 1 : 0; dropped += counts.reduce((s, x) => s + x.hard - x.n, 0);
      over20 += items.filter((i) => !isSuit(i) && independentFits(i, ctx, 'top')).length > 20 || items.filter((i) => !isSuit(i) && independentFits(i, ctx, 'bottom')).length > 20 ? 1 : 0;
    }
    expect(wardrobes).toBeGreaterThanOrEqual(50);
    expect(withResults).toBeGreaterThan(40);
    expect(claimed).toBeGreaterThan(100);
    expect(dropped).toBeGreaterThan(0); // the rule_fit threshold removes outfits that pass the hard rules, so colour matters
    expect(over20).toBeGreaterThanOrEqual(6); // the bound of 20 is really exercised
  }, 120_000);
  it('a Suit pretend fills layer and bottom at once, a Sweater is tried as top and as layer: both match the brute force on the fixture wardrobes', () => {
    for (const items of Object.values(WARDROBES)) for (const o of ['Casual', 'Work', 'Formal'] as const) {
      const hm = [{ sub_type: 'Suit', colour_family: 'Navy' }, { sub_type: 'Sweater', colour_family: 'Grey' }, { sub_type: 'Blazer', colour_family: 'Grey' }, { sub_type: 'Formal shoes', colour_family: 'Black' }] as Candidate[];
      for (const r of unlock(items, at(o, 4), { unlockList: 'hm', hm })) expect(brute(items, at(o, 4), { sub_type: r.subType, colour_family: r.colourFamily }).n).toBe(r.newOutfits);
    }
  });
});

describe('Wardrobe unlock: the bound of 20', () => {
  it('is exact: it is never widened to keep an allowed outfit (20 T-shirts hide the only shirt from the formal shoes under Casual)', () => {
    const items = [...Array.from({ length: 20 }, (_, n) => mk('T-shirt', `t${String(n).padStart(2, '0')}`)), mk('Shirt', 'z'), mk('Jeans', 'j'), mk('Formal shoes', 'f')];
    const opts = { unlockList: 'hm' as const, hm: [{ sub_type: 'Chinos', colour_family: 'Navy' }] };
    expect([unlock(items, at('Casual', 4), opts), brute(items, at('Casual', 4), opts.hm[0] as Candidate).n]).toEqual([[], 0]);
    expect(unlock(items.slice(1), at('Casual', 4), opts)).toEqual([{ subType: 'Chinos', colourFamily: 'Navy', newOutfits: 1 }]); // 19 T-shirts leave room for the shirt
  });
});

describe('Wardrobe unlock: the result list', () => {
  const ctxs = OCCASIONS.map((o) => at(o, 4));
  it('has at most three entries, one per sub-type, ordered by count, all above zero, and two runs (also on shuffled and frozen input) give the same list', () => {
    let seen = 0;
    for (const [name, items] of Object.entries(WARDROBES)) for (const ctx of ctxs) {
      const r = unlock(items, ctx);
      expect(r.length, name).toBeLessThanOrEqual(3);
      expect(new Set(r.map((x) => x.subType)).size).toBe(r.length);
      expect(r.every((x, i) => x.newOutfits > 0 && (i === 0 || r[i - 1]!.newOutfits >= x.newOutfits))).toBe(true);
      expect(J(unlock(deepFreeze(structuredClone(items)), ctx))).toBe(J(r));
      expect(J(unlock(shuffled(items, 3), ctx))).toBe(J(r));
      seen += r.length;
    }
    expect(seen).toBeGreaterThan(20);
  });
  it('keeps the best colour of a sub-type, and breaks ties by mean rule_fit, then the pairing prior, then name', () => {
    const items = [mk('T-shirt', 't', { colourFamily: 'White', rgb: [255, 255, 255] }), mk('Sneakers', 's')];
    const list = (...c: [SubType, string][]): { unlockList: 'hm'; hm: Candidate[] } => ({ unlockList: 'hm', hm: c.map(([sub_type, colour_family]) => ({ sub_type, colour_family })) as Candidate[] });
    const names = (opts: object): string[] => unlock(items, at('Casual'), opts).map((r) => `${r.subType} ${r.colourFamily} ${r.newOutfits}`);
    expect(names(list(['Jeans', 'Blue'], ['Chinos', 'Blue']))).toEqual(['Chinos Blue 1', 'Jeans Blue 1']); // same count and fit: by name
    expect(names({ ...list(['Jeans', 'Blue'], ['Chinos', 'Blue']), prior: priorJson })).toEqual(['Jeans Blue 1', 'Chinos Blue 1']); // the prior likes T-shirt with Jeans
    expect(names(list(['Jeans', 'Blue'], ['Jeans', 'Black'], ['Jeans', 'Red']))).toHaveLength(1); // one entry per sub-type
    expect(names(list(['Jeans', 'Red'], ['Jeans', 'Navy']))).toEqual(['Jeans Navy 1']); // two colours of one sub-type with the same count and fit: the colour name decides
    const two = [...items, mk('Sneakers', 's2'), mk('Boots', 'b')];
    expect(unlock(two, at('Casual'), list(['Jeans', 'Blue'], ['Shorts', 'Khaki'], ['Chinos', 'Beige'], ['Trousers', 'Grey'])).map((r) => r.newOutfits)).toEqual([3, 3, 3]);
  });
});

describe('Wardrobe unlock: the candidate list (LLD 9.5.2)', () => {
  const items = WARDROBES['Office regular']!, ctx = at('Casual', 4);
  const hm = [{ sub_type: 'Polo', colour_family: 'Red' }, { sub_type: 'Chinos', colour_family: 'Navy' }];
  const names = (r: ReturnType<typeof unlock>): string[] => r.map((x) => x.subType);
  it('uses the committed fallback list by default and when it is asked for, whatever hm holds', () => {
    expect(unlock(items, ctx, { unlockList: 'fallback' })).toEqual(unlock(items, ctx));
    expect(J(unlock(items, ctx, { unlockList: 'fallback', hm }))).toBe(J(unlock(items, ctx)));
    expect(unlock(items, ctx, { hm })).toEqual(unlock(items, ctx));
    expect(unlock(items, ctx).length).toBeGreaterThan(0);
  });
  it('uses the H&M list when asked for and valid', () => {
    expect(names(unlock(items, ctx, { unlockList: 'hm', hm })).every((n) => ['Polo', 'Chinos'].includes(n))).toBe(true);
    expect(unlock(items, ctx, { unlockList: 'hm', hm }).length).toBeGreaterThan(0);
  });
  it.each([
    ['missing', undefined], ['null', null], ['not an array', { sub_type: 'Polo', colour_family: 'Red' }], ['41 entries', Array.from({ length: 41 }, () => hm[0])],
    ['an unknown sub-type', [{ sub_type: 'Cape', colour_family: 'Red' }]], ['an unknown colour', [{ sub_type: 'Polo', colour_family: 'Mauve' }]], ['an extra field', [{ ...hm[0], count: 5 }]],
  ])('an H&M list that is %s falls back to the committed list', (_, bad) => {
    expect(J(unlock(items, ctx, { unlockList: 'hm', hm: bad }))).toBe(J(unlock(items, ctx)));
  });
  it('works with every learned part off: no prior, fallback list, base config, on every fixture wardrobe', () => {
    expect(engineConfig({})).toBe('gm1;emb0;pair0;ul:fb;w:base');
    expect(Object.values(WARDROBES).filter((w) => OCCASIONS.some((o) => unlock(w, at(o, 4)).length > 0)).length).toBe(5);
    expect(unlock(WARDROBES['Thin wardrobe']!, at('Casual', 4)).length).toBeGreaterThan(0);
  });
  it('the pretend item is all year, solid, in the first swatch of its colour family, with the occasions the table gives its sub-type, and is never added to the wardrobe', () => {
    const p = pretendItem({ sub_type: 'Chinos', colour_family: 'Navy' })!;
    expect([p.id, p.seasons, p.pattern, p.rgb, p.condition, p.favourite, p.category]).toEqual(['__unlock:Chinos:Navy', ['All year'], 'Solid', hexToRgb('#1F2A44'), null, false, 'Bottoms']);
    expect(p.occasions).toEqual(['Casual', 'Work', 'Date', 'Travel']);
    expect(pretendItem({ sub_type: 'Chinos', colour_family: 'Multi' })).toBeNull();
    const frozen = deepFreeze(structuredClone(items));
    unlock(frozen, ctx);
    expect(frozen).toEqual(items);
  });
  it('finishes under 1 s on 500 items (median of 9 runs), in four occasions', () => {
    const subs: SubType[] = ['T-shirt', 'Shirt', 'Polo', 'Jeans', 'Chinos', 'Trousers', 'Sneakers', 'Boots', 'Formal shoes', 'Coat', 'Blazer', 'Belt', 'Suit', 'Hoodie', 'Sweater'];
    const big = Array.from({ length: 500 }, (_, i) => mk(subs[i % 15]!, `item-${i}`, { colourFamily: (['Navy', 'Red', 'Grey', 'Brown', 'Green'] as const)[i % 5]!, rgb: [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256], pattern: i % 7 ? 'Solid' : 'Striped' }));
    for (const o of ['Casual', 'Work', 'Formal', 'Party'] as const) {
      const times = Array.from({ length: 9 }, () => { const t = Date.now(); unlock(big, at(o, 1)); return Date.now() - t; }).sort((a, b) => a - b);
      expect(times[4], o).toBeLessThan(1000);
    }
  }, 60_000);
});

describe('unlock-fallback.json (the style specialist\'s list, FOI-11)', () => {
  const list = fallbackJson as { sub_type: string; colour_family: string }[];
  it('has at most 40 entries, every one a taxonomy sub-type and colour family, none twice, and the pieces the H&M types cannot express', () => {
    expect(list.length).toBeLessThanOrEqual(40);
    expect(list.every((c) => SUB_TYPES.includes(c.sub_type as SubType) && COLOUR_FAMILIES.includes(c.colour_family as never) && Object.keys(c).length === 2)).toBe(true);
    expect(new Set(list.map((c) => `${c.sub_type}/${c.colour_family}`)).size).toBe(list.length);
    for (const sub of ['Chinos', 'Joggers', 'Formal shoes', 'Sandals']) expect(list.some((c) => c.sub_type === sub), sub).toBe(true);
    expect(list.every((c) => c.colour_family !== 'Multi' && pretendItem(c as Candidate) !== null)).toBe(true);
  });
});
