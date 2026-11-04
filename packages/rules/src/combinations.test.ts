import { categoryOfSubType } from '@sparta/taxonomy';
import type { SubType } from '@sparta/taxonomy';
import { describe, expect, it } from 'vitest';
import { slotCandidates } from './combinations.js';
import { shuffled } from './fixtures/random.js';
import { isMissing, suggest } from './suggest.js';
import type { Ctx, Item } from './types.js';

const mk = (subType: SubType, id: string, o: Partial<Item> = {}): Item => ({
  id, name: id, category: categoryOfSubType(subType)!, subType, rgb: [31, 42, 68], colourFamily: 'Navy', pattern: 'Solid',
  seasons: [], occasions: [], condition: null, favourite: false, status: 'active', ...o,
});
const casual: Ctx = { occasion: 'Casual', hemisphere: 'north', date: new Date(Date.UTC(2026, 3, 15)) };
const shorts = Array.from({ length: 9 }, (_, n) => mk('Shorts', `s${n}`, { occasions: ['Casual'] })); // tagged, so they outrank the jeans

describe('best-eight trimming never causes a false "missing" (WO-0005)', () => {
  const wardrobe = [mk('Shirt', 't'), ...shorts, mk('Jeans', 'jeans'), mk('Formal shoes', 'shoes')]; // a shirt: a T-shirt may not go with formal shoes in Casual (AI style review)
  it('9 shorts + formal shoes + 1 jeans under Casual still gives the jeans outfit', () => {
    const result = suggest(wardrobe, casual);
    expect(isMissing(result)).toBe(false);
    expect(isMissing(result) ? [] : result.map((s) => s.items.bottom)).toEqual(['jeans']);
  });
  it('the rescue does not depend on the input order', () => {
    expect(suggest(shuffled(wardrobe, 3), casual)).toEqual(suggest(wardrobe, casual));
  });
  it('the rescue adds one bottom and at most one pair of shoes; the best eight stay as they were', () => {
    const c = slotCandidates(wardrobe, casual);
    expect(c.bottom.map((i) => i.id)).toEqual([...shorts.slice(0, 8).map((i) => i.id), 'jeans']);
    expect(c.footwear.map((i) => i.id)).toEqual(['shoes']);
  });
  it('when the pair really is forbidden (only shorts and formal shoes) it is still missing', () => {
    expect(suggest([mk('Shirt', 't'), ...shorts, mk('Formal shoes', 'shoes')], casual)).toEqual({ missing: ['bottom', 'footwear'] });
  });
  it('a suit rescues the pair as well (under Date: Suit and Tuxedo are no longer Casual or Travel bottoms)', () => {
    const r = suggest([mk('Shirt', 't'), ...shorts, mk('Suit', 'suit'), mk('Formal shoes', 'shoes')], { ...casual, occasion: 'Date' });
    expect(isMissing(r) ? [] : r.map((s) => s.items.bottom)).toEqual(['suit']);
  });
});
