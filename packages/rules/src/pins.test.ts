import { describe, expect, it } from 'vitest';
import { reasonsFor } from './reasons.js';
import { createScorer } from './score.js';
import type { Evaluation } from './score.js';
import { isMissing, suggest } from './suggest.js';
import { swapChoices } from './swap.js';
import { at, deepFreeze, grey, mk } from './fixtures/items.js';
import { WARDROBES } from './fixtures/wardrobes.js';
import { OCCASIONS } from '@sparta/taxonomy';
import type { Item, Slot } from './types.js';

describe('swap shape fallback (M17)', () => {
  // Replaced: black jeans. Same sub-type scores 0.6 + 0.4 * colour; a different sub-type in the same colour scores 0.6 * fallback + 0.4 = 0.64.
  // Grey 226 is just under 90 away in L* (0.6405) and grey 227 just over (0.6391), so the fallback must be 0.4 to put chinos between them.
  const wardrobe = [mk('T-shirt', 't'), mk('Jeans', 'j', { rgb: [0, 0, 0] }), mk('Sneakers', 's'), mk('Jeans', 'a226', grey(226)), mk('Jeans', 'a227', grey(227)), mk('Chinos', 'b', { rgb: [0, 0, 0] })];
  it('a different sub-type in the same colour ranks between two same sub-types at colour distances 89.9 and 90.2', () => {
    const outfit = suggest(wardrobe.slice(0, 3), at('Casual', 4));
    if (isMissing(outfit)) throw new Error('missing');
    expect(swapChoices(outfit[0]!, 'bottom', wardrobe, {}, at('Casual', 4))).toEqual(['a226', 'b', 'a227']);
  });
});

describe('reasons only for rules fully met (M32)', () => {
  const ev = (rules: Evaluation['rules'], o: Partial<Evaluation> = {}): Evaluation =>
    ({ score: 0, parts: {} as Evaluation['parts'], rules, neutrals: ['Navy'], cool: true, beltMatches: true, ...o });
  const ids = (rules: Evaluation['rules'], o?: Partial<Evaluation>): string[] => reasonsFor(ev(rules, o), at('Casual', 1)).ruleIds;
  it('R3 to R6 each give a reason at exactly 1 and none below 1, however close', () => {
    expect(ids({ R3: 1, R4: 1, R5: 1, R6: 1 })).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6']);
    for (const bad of [0.99, 0.66, 0.5, 0.01, 0]) {
      expect(ids({ R3: bad, R4: 1, R5: 1, R6: 1 })).toEqual(['R1', 'R2', 'R4', 'R5', 'R6']);
      expect(ids({ R3: 1, R4: bad, R5: 1, R6: 1 })).toEqual(['R1', 'R2', 'R3', 'R5', 'R6']);
      expect(ids({ R3: 1, R4: 1, R5: bad, R6: 1 })).toEqual(['R1', 'R2', 'R3', 'R4', 'R6']);
      expect(ids({ R3: 1, R4: 1, R5: 1, R6: bad })).toEqual(['R1', 'R2', 'R3', 'R4', 'R5']);
    }
  });
  it('R1 and R2 always remain, so there is always a reason', () => {
    expect(reasonsFor(ev({ R3: 0, R4: 0, R5: 0, R6: 0 }), at('Casual', 1)).reasons).toEqual(['Meets the Casual dress rule', 'Nothing is out of season for Winter']);
  });
  it('through suggest: two bold items (R3 0.66) give no colour reason', () => {
    const r = suggest([mk('T-shirt', 't', { rgb: [214, 40, 40], colourFamily: 'Red' }), mk('Jeans', 'j', { rgb: [40, 160, 70], colourFamily: 'Green' }), mk('Sneakers', 's', { rgb: [255, 255, 255], colourFamily: 'White' })], at('Casual', 4));
    if (isMissing(r)) throw new Error('missing');
    expect(r[0]!.parts.rule_fit).toBeLessThan(1);
    expect(r[0]!.ruleIds).toEqual(['R1', 'R2', 'R4']);
  });
});

describe('suggest and swapChoices leave their input alone (M41)', () => {
  it('deeply frozen wardrobes are accepted, give the same result as plain copies, and are unchanged afterwards', () => {
    for (const [name, original] of Object.entries(WARDROBES)) {
      const copy = (): Item[] => JSON.parse(JSON.stringify(original)) as Item[];
      const plain = copy(), frozen = deepFreeze(copy());
      for (const occasion of OCCASIONS) for (const month of [1, 7]) {
        const c = at(occasion, month), r = suggest(frozen, c);
        expect(r, name).toEqual(suggest(plain, c));
        if (!isMissing(r)) for (const slot of ['top', 'bottom', 'layer', 'footwear', 'accessory'] as Slot[]) expect(swapChoices(r[0]!, slot, frozen, {}, c)).toEqual(swapChoices(r[0]!, slot, plain, {}, c));
      }
      expect(frozen).toEqual(original);
      expect(frozen.map((i) => i.id)).toEqual(original.map((i) => i.id));
    }
  });
});

describe('rule_fit is the mean of R3 to R6 (M48)', () => {
  const score = createScorer(at('Casual', 4), false);
  it('two bold items (R3 0.66) and two patterns (R4 0.5) give (0.66 + 0.5 + 1 + 1) / 4, not the minimum', () => {
    const e = score.evaluate({
      top: mk('T-shirt', 't', { rgb: [214, 40, 40], colourFamily: 'Red', pattern: 'Striped' }), bottom: mk('Jeans', 'j', { rgb: [40, 160, 70], colourFamily: 'Teal', pattern: 'Checked' }),
      layer: null, footwear: mk('Sneakers', 's'), accessory: null,
    });
    expect([e.rules.R3, e.rules.R4, e.rules.R5, e.rules.R6]).toEqual([0.66, 0.5, 1, 1].map((n) => expect.closeTo(n, 12)));
    expect(e.parts.rule_fit).toBeCloseTo((0.66 + 0.5 + 1 + 1) / 4, 12);
  });
});
