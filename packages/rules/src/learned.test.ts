import { OCCASIONS } from '@sparta/taxonomy';
import { describe, expect, it } from 'vitest';
import baselineJson from '../data/fixtures/suggest-baseline.fixture.json';
import priorJson from '../data/fixtures/pairing-prior.fixture.json';
import rules from '../data/rules.json';
import { engineConfig } from './config.js';
import type { Outfit } from './combinations.js';
import { independentProblems } from './fixtures/checker.js';
import { at, deepFreeze, mk } from './fixtures/items.js';
import { randomWardrobe } from './fixtures/random.js';
import { WARDROBES } from './fixtures/wardrobes.js';
import { outfitPairing, pairScore, parsePrior } from './pairing.js';
import { PART_NAMES } from './score.js';
import { isMissing, rankedPool, suggest } from './suggest.js';
import type { Slot } from './types.js';

const baseline = baselineJson as unknown as { months: number[]; wardrobes: Record<string, Record<string, unknown>>; random_digests: string[] };
const prior = priorJson as unknown;
const J = JSON.stringify;
/** The same 53-bit string hash the frozen snapshot was made with. */
const cyrb53 = (s: string): string => {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(16);
};
const logit = (x: number): number => Math.log(x / (1 - x));
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
const BAD: [string, unknown][] = [
  ['undefined', undefined], ['null', null], ['a string', 'prior'], ['a number', 42], ['an array', []], ['an empty object', {}],
  ['version 2', { ...(prior as object), version: 2 }], ['negative min_pairs', { ...(prior as object), min_pairs: -1 }], ['text min_pairs', { ...(prior as object), min_pairs: '30' }],
  ['an extra (date) field', { ...(prior as object), built: '2026-11-04' }], ['colour_pairs missing', { version: 1, min_pairs: 30, type_pairs: {} }],
  ['an unknown slot pair', { ...(prior as object), type_pairs: { 'Top+Layer': {} } }], ['an unknown sub-type', { ...(prior as object), type_pairs: { 'Top+Bottom': { Cape: { Jeans: 0.5 } } } }],
  ['an unknown colour', { ...(prior as object), colour_pairs: { 'Top+Bottom': { Mauve: { Blue: 0.5 } } } }], ['x above 1', { ...(prior as object), type_pairs: { 'Top+Bottom': { 'T-shirt': { Jeans: 1.5 } } } }],
  ['x as text', { ...(prior as object), type_pairs: { 'Top+Bottom': { 'T-shirt': { Jeans: '0.5' } } } }], ['x NaN', { ...(prior as object), type_pairs: { 'Top+Bottom': { 'T-shirt': { Jeans: NaN } } } }],
  // WO-0014 (Model QC Q1, Q2): the second-level key and a negative number
  ['an unknown second-level sub-type', { ...(prior as object), type_pairs: { 'Top+Bottom': { 'T-shirt': { Cape: 0.5 } } } }],
  ['an unknown second-level colour', { ...(prior as object), colour_pairs: { 'Top+Bottom': { White: { Mauve: 0.5 } } } }],
  ['x below 0', { ...(prior as object), type_pairs: { 'Top+Bottom': { 'T-shirt': { Jeans: -0.1 } } } }],
  ['x infinite', { ...(prior as object), type_pairs: { 'Top+Bottom': { 'T-shirt': { Jeans: Infinity } } } }],
];

describe('prior off: the output is byte-identical to the engine before the learned layer (CC6)', () => {
  const snap = (name: string, o: string, m: number): string => J(baseline.wardrobes[name]![`${o}|${m}`]);
  it.each(Object.keys(WARDROBES))('%s: every occasion and season equals the frozen snapshot', (name) => {
    for (const o of OCCASIONS) for (const m of baseline.months) expect(J(suggest(WARDROBES[name]!, at(o, m)))).toBe(snap(name, o, m));
  });
  it('the snapshot covers five fixtures x 7 occasions x 4 seasons, suggestions and missing results alike', () => {
    const all = Object.values(baseline.wardrobes).flatMap((w) => Object.values(w));
    expect([Object.keys(baseline.wardrobes).length, all.length]).toEqual([5, 140]);
    expect([all.filter(Array.isArray).length > 60, all.filter((r) => !Array.isArray(r)).length > 5]).toEqual([true, true]);
  });
  it('200 random wardrobes x 7 occasions x 4 seasons equal the frozen digests, with no opts, empty opts and every invalid prior', () => {
    expect(baseline.random_digests).toHaveLength(200);
    baseline.random_digests.forEach((digest, n) => {
      const seed = n + 1, items = randomWardrobe(seed), h = seed % 2 === 0 ? 'north' : 'south';
      const run = (prior?: unknown): string => J(OCCASIONS.flatMap((o) => baseline.months.map((m) => suggest(items, at(o, m, h), prior === undefined ? undefined : { prior }))));
      expect(cyrb53(run()), `seed ${seed}`).toBe(digest);
      if (seed % 20 === 0) for (const [, bad] of BAD) expect(run(bad)).toBe(run());
    });
  }, 120_000);
});

describe('the pairing prior (LLD 7.9, 9.5.1)', () => {
  const tee = mk('T-shirt', 't', { colourFamily: 'White' }), jeans = mk('Jeans', 'j', { colourFamily: 'Blue' }), shoes = mk('Sneakers', 's', { colourFamily: 'White' });
  const p = parsePrior(prior)!;
  it('the fixture is a valid prior, parsing copies it and never changes the input', () => {
    expect(parsePrior(deepFreeze(structuredClone(prior)))).toEqual(prior);
    expect(parsePrior(prior)).not.toBe(prior);
    for (const [name, bad] of BAD) expect(parsePrior(bad), name).toBeNull();
  });
  it('x of exactly 0 and exactly 1 are valid, and are kept as written', () => {
    const edge = { ...(prior as object), type_pairs: { 'Top+Bottom': { 'T-shirt': { Jeans: 0, Shorts: 1 } } } };
    expect(parsePrior(edge)).toEqual(edge);
  });
  it('a pair scores sigmoid(logit type + logit colour); a missing entry is neutral', () => {
    expect(pairScore(p, 'Top+Bottom', tee, jeans)).toBeCloseTo(sigmoid(logit(0.8) + logit(0.7)), 12);
    expect(pairScore(p, 'Top+Bottom', jeans, tee)).toBe(0.5);
    expect(pairScore(p, 'Top+Footwear', mk('Polo', 'p'), shoes)).toBe(0.5);
    expect(pairScore(parsePrior({ version: 1, min_pairs: 30, type_pairs: {}, colour_pairs: {} })!, 'Top+Bottom', tee, jeans)).toBe(0.5);
  });
  it('an outfit scores the mean over its available slot pairs, the layer pair only when there is a layer', () => {
    const o: Outfit = { top: tee, bottom: jeans, layer: null, footwear: shoes, accessory: null };
    const [tb, tf, bf] = [sigmoid(logit(0.8) + logit(0.7)), sigmoid(logit(0.7) + logit(0.6)), sigmoid(logit(0.6) + logit(0.7))];
    expect(outfitPairing(p, o)).toBeCloseTo((tb + tf + bf) / 3, 12);
    const blazer = mk('Blazer', 'b', { colourFamily: 'Navy' }), shirt = mk('Shirt', 'h', { colourFamily: 'White' });
    const lp = sigmoid(logit(0.7) + logit(0.7));
    const [ts, tbs, tfs, bfs] = [pairScore(p, 'Top+Bottom', shirt, jeans), pairScore(p, 'Top+Footwear', shirt, shoes), pairScore(p, 'Bottom+Footwear', jeans, shoes), lp];
    expect(outfitPairing(p, { ...o, top: shirt, layer: blazer })).toBeCloseTo((ts + tbs + tfs + bfs) / 4, 12);
  });
  it('with a valid prior the score parts include pairing and the score uses weights_with_pairing; without, there is no pairing part', () => {
    for (const items of Object.values(WARDROBES)) for (const o of OCCASIONS) {
      const [on, off] = [suggest(items, at(o), { prior }), suggest(items, at(o))];
      if (isMissing(on) || isMissing(off)) { expect(on).toEqual(off); continue; }
      for (const s of on) {
        expect(s.parts.pairing).toBeGreaterThanOrEqual(0);
        expect(s.parts.pairing).toBeLessThanOrEqual(1);
        const w = rules.weights_with_pairing as Record<string, number>;
        expect(s.score).toBeCloseTo([...PART_NAMES, 'pairing' as const].reduce((n, k) => n + w[k]! * s.parts[k]!, 0), 12);
      }
      for (const s of off) expect(Object.keys(s.parts)).toEqual([...PART_NAMES]);
    }
  });
  it('the prior reorders outfits that already pass the hard rules (tee with jeans beats shirt with jeans only when the prior says so)', () => {
    const items = [mk('Shirt', 'a'), mk('T-shirt', 'b'), mk('Jeans', 'j'), mk('Sneakers', 's')];
    const top = (opts?: { prior: unknown }): string | null => { const r = suggest(items, at('Casual'), opts); return isMissing(r) ? null : r[0]!.items.top; };
    expect([top(), top({ prior })]).toEqual(['a', 'b']);
  });
  it('the prior never admits an invalid outfit: on random wardrobes, with the fixture and with a prior that loves every forbidden pair, the valid outfits are the same and only scores change', () => {
    const loves = { version: 1, min_pairs: 30, colour_pairs: {}, type_pairs: { 'Top+Footwear': { 'T-shirt': { 'Formal shoes': 0.88 }, Hoodie: { 'Formal shoes': 0.88 } }, 'Bottom+Footwear': { Shorts: { 'Formal shoes': 0.88 } }, 'Top+Bottom': { 'T-shirt': { Suit: 0.88 } } } };
    let changed = 0, pools = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const items = randomWardrobe(seed);
      for (const [pr, o] of OCCASIONS.flatMap((o) => [prior, loves].map((pr) => [pr, o] as const))) {
        const ctx = at(o, [1, 4, 7, 10][seed % 4]!, seed % 3 ? 'north' : 'south'), off = rankedPool(items, ctx);
        const on = rankedPool(items, ctx, { prior: pr });
        expect('missing' in on).toBe('missing' in off);
        if ('missing' in on || 'missing' in off) { expect(on).toEqual(off); continue; }
        pools++;
        expect(on.pool.map((c) => c.order)).toEqual(off.pool.map((c) => c.order)); // the same outfits in the same enumeration order
        changed += on.pool.filter((c, i) => c.evaluation.score !== off.pool[i]!.evaluation.score).length;
        const picked = suggest(items, ctx, { prior: pr });
        for (const s of isMissing(picked) ? [] : picked) {
          const outfit = Object.fromEntries(Object.entries(s.items).map(([k, id]) => [k, items.find((i) => i.id === id) ?? null])) as Record<Slot, (typeof items)[number] | null>;
          expect(independentProblems(outfit, ctx, items)).toEqual([]);
        }
      }
    }
    expect(pools).toBeGreaterThan(600);
    expect(changed).toBeGreaterThan(500); // the prior does change scores, so the test is not vacuous
  }, 60_000);
});

describe('timing', () => {
  it('suggest with the prior on, on about 500 items, takes under 300 ms (median of 9 runs)', () => {
    const big = randomWardrobe(11, undefined, 480);
    const times = Array.from({ length: 9 }, () => { const t = Date.now(); suggest(big, at('Casual', 1), { prior }); return Date.now() - t; }).sort((a, b) => a - b);
    expect(big.length).toBeGreaterThanOrEqual(480);
    expect(times[4]).toBeLessThan(300);
  });
});

describe('engine_config (LLD 12.3)', () => {
  it.each([
    [{}, 'gm1;emb0;pair0;ul:fb;w:base'], [{ garmentModel: 1 as const }, 'gm1;emb0;pair0;ul:fb;w:base'], [{ garmentModel: 2 as const }, 'gm2;emb0;pair0;ul:fb;w:base'], [{ prior }, 'gm1;emb0;pair1;ul:fb;w:pairing'], [{ prior: BAD[7]![1] }, 'gm1;emb0;pair0;ul:fb;w:base'],
    [{ unlockList: 'hm' as const, hm: [{ sub_type: 'Chinos', colour_family: 'Navy' }] }, 'gm1;emb0;pair0;ul:hm;w:base'],
    [{ unlockList: 'hm' as const }, 'gm1;emb0;pair0;ul:fb;w:base'], [{ unlockList: 'fallback' as const, hm: [{ sub_type: 'Chinos', colour_family: 'Navy' }] }, 'gm1;emb0;pair0;ul:fb;w:base'],
    [{ garmentModel: 2 as const, embeddingSwap: true, prior, unlockList: 'hm' as const, hm: [{ sub_type: 'Jeans', colour_family: 'Blue' }] }, 'gm2;emb1;pair1;ul:hm;w:pairing'],
  ])('%j gives %s', (opts, expected) => expect(engineConfig(opts)).toBe(expected));
});
