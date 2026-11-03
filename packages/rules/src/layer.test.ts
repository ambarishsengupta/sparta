import { describe, expect, it } from 'vitest';
import { withRequiredLayer } from './combinations.js';
import { RULES } from './eligibility.js';
import { independentProblems } from './fixtures/checker.js';
import { at, mk } from './fixtures/items.js';
import rules from '../data/rules.json';
import { isMissing, suggest } from './suggest.js';
import type { Item, Slot } from './types.js';

const layers = (items: Item[], c = at('Casual', 1)): (string | null)[] => {
  const r = suggest(items, c);
  return isMissing(r) ? expect.fail(`missing ${r.missing.join()}`) : r.map((s) => s.items.layer);
};
const outfit = (o: Partial<Record<Slot, Item>>): Record<Slot, Item | null> => ({ top: null, bottom: null, layer: null, footwear: null, accessory: null, ...o });
const base = [mk('T-shirt', 't'), mk('Jeans', 'j'), mk('Sneakers', 's')];
const formal = [mk('Shirt', 't'), mk('Trousers', 'tr'), mk('Formal shoes', 's')];

describe('a layer is required when one is available (D-A, WO-0006 item 3)', () => {
  it('rules.json carries the flags: Formal and the cool seasons, no other occasion', () => {
    const flagged = Object.entries(rules.occasions).filter(([, o]) => 'layer_required_if_available' in o).map(([k]) => k);
    expect(flagged).toEqual(['Formal']);
    expect([rules.cool_season_layer_required_if_available, rules.cool_seasons]).toEqual([true, ['Autumn', 'Winter']]);
    expect(rules.layer_decision_note).toMatch(/FDD.*LLD|LLD.*FDD/);
  });
  it.each([[1, 'Winter'], [10, 'Autumn']])('Casual in month %i (%s) with a coat: every suggestion has the coat', (month) => {
    expect(layers([...base, mk('Coat', 'c')], at('Casual', month))).toEqual(['c']);
  });
  it.each([[4, 'Spring'], [7, 'Summer']])('Casual in month %i (%s): the layer-less outfit stays', (month) => {
    expect(layers([...base, mk('Jacket', 'c')], at('Casual', month))).toContain(null);
  });
  it('flips with the hemisphere: January in the south is summer, so no layer is required', () => {
    expect(layers([...base, mk('Jacket', 'c')], at('Casual', 1, 'south'))).toContain(null);
    expect(layers([...base, mk('Jacket', 'c')], at('Casual', 7, 'south'))).toEqual(['c']);
  });
  it('winter with no eligible layer (archived, out of season, or none at all) keeps the layer-less outfit', () => {
    for (const none of [[], [mk('Coat', 'c', { status: 'archived' })], [mk('Coat', 'c', { seasons: ['Summer'] })]]) expect(layers([...base, ...none])).toEqual([null]);
  });
  it('an item that is the only top and the only layer cannot be both: the layer-less outfit stays and the result is not "missing"', () => {
    expect(layers([mk('Sweater', 'sw'), mk('Jeans', 'j'), mk('Sneakers', 's')])).toEqual([null]);
  });
  it('Formal: with a blazer every suggestion has it; without one the layer-less outfit is fine', () => {
    expect(layers([...formal, mk('Blazer', 'bl')], at('Formal', 4))).toEqual(['bl']);
    expect(layers(formal, at('Formal', 4))).toEqual([null]);
  });
  it('Formal: a Suit counts as the layer, so the trousers-only outfit goes when a suit exists', () => {
    const r = suggest([...formal, mk('Suit', 'su')], at('Formal', 4));
    expect(isMissing(r) ? [] : r.map((s) => [s.items.bottom, s.items.layer])).toEqual([['su', 'su']]);
  });
  it('Work, Party, Sport are not asked for a layer outside the cool seasons', () => {
    expect(layers([mk('Shirt', 't'), mk('Chinos', 'c'), mk('Boots', 'b'), mk('Jacket', 'l')], at('Work', 4))).toContain(null);
  });
  it('reads the flags from rules.json: with both off the layer-less outfits come back', () => {
    const data = RULES as unknown as { cool_season_layer_required_if_available: boolean; occasions: { Formal: { layer_required_if_available?: boolean } } };
    const [cool, formalFlag] = [data.cool_season_layer_required_if_available, data.occasions.Formal.layer_required_if_available];
    try {
      data.cool_season_layer_required_if_available = false;
      data.occasions.Formal.layer_required_if_available = false;
      expect(layers([...base, mk('Coat', 'c')])).toEqual(['c', null]);
      expect(layers([...formal, mk('Blazer', 'bl')], at('Formal', 4))).toEqual(['bl', null]);
    } finally {
      data.cool_season_layer_required_if_available = cool;
      data.occasions.Formal.layer_required_if_available = formalFlag;
    }
  });
  it('withRequiredLayer leaves the list alone when the rule does not apply or no outfit has a layer', () => {
    const [plain, layered] = [outfit({ top: base[0]!, bottom: base[1]!, footwear: base[2]! }), outfit({ top: base[0]!, bottom: base[1]!, footwear: base[2]!, layer: mk('Coat', 'c') })];
    expect(withRequiredLayer([plain, layered], at('Casual', 4))).toEqual([plain, layered]);
    expect(withRequiredLayer([plain, layered], at('Casual', 1))).toEqual([layered]);
    expect(withRequiredLayer([plain], at('Casual', 1))).toEqual([plain]);
  });
});

describe('the independent checker (WO-0006 items 3 and 6)', () => {
  const [tee, jeans, shoes, coat] = [base[0]!, base[1]!, base[2]!, mk('Coat', 'c')];
  const bare = outfit({ top: tee, bottom: jeans, footwear: shoes });
  it('LAYER: a layer-less winter outfit is wrong only when the wardrobe can make a layered one', () => {
    expect(independentProblems(bare, at('Casual', 1), [...base, coat])).toEqual(['LAYER']);
    expect(independentProblems({ ...bare, layer: coat }, at('Casual', 1), [...base, coat])).toEqual([]);
    expect(independentProblems(bare, at('Casual', 1), base)).toEqual([]);
    expect(independentProblems(bare, at('Casual', 1), [...base, mk('Coat', 'x', { status: 'archived' })])).toEqual([]);
    expect(independentProblems(bare, at('Casual', 1))).toEqual([]);
    expect(independentProblems(bare, at('Casual', 4), [...base, mk('Jacket', 'x')])).toEqual([]);
    expect(independentProblems(bare, at('Casual', 1), [mk('Sweater', 'sw'), jeans, shoes])).toEqual([]);
  });
  it('LAYER: Formal wants the blazer, or a suit as bottom and layer, whatever the season', () => {
    const [shirt, trousers, formalShoes] = formal;
    const plain = outfit({ top: shirt!, bottom: trousers!, footwear: formalShoes! });
    expect(independentProblems(plain, at('Formal', 4), [...formal, mk('Blazer', 'bl')])).toEqual(['LAYER']);
    expect(independentProblems(plain, at('Formal', 7), [...formal, mk('Suit', 'su')])).toEqual(['LAYER']);
    expect(independentProblems(plain, at('Formal', 4), formal)).toEqual([]);
  });
  it('SUIT: a Suit or Tuxedo must fill layer and bottom together, never one slot alone', () => {
    const [shirt, trousers, formalShoes] = formal;
    const suit = mk('Suit', 'su'), tux = mk('Tuxedo', 'tu');
    const f = at('Formal', 4);
    expect(independentProblems(outfit({ top: shirt!, bottom: suit, layer: suit, footwear: formalShoes! }), f)).toEqual([]);
    expect(independentProblems(outfit({ top: shirt!, bottom: tux, layer: tux, footwear: formalShoes! }), f)).toEqual([]);
    expect(independentProblems(outfit({ top: shirt!, bottom: suit, footwear: formalShoes! }), f)).toEqual(['SUIT']);
    expect(independentProblems(outfit({ top: shirt!, bottom: trousers!, layer: suit, footwear: formalShoes! }), f)).toEqual(['SUIT']);
    expect(independentProblems(outfit({ top: shirt!, bottom: suit, layer: tux, footwear: formalShoes! }), f)).toEqual(['SUIT']);
  });
});
