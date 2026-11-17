import { describe, expect, it } from 'vitest';
import { NO_FILTER, filterItems, isNeverWorn } from './filters';
import type { StoredItem } from './repository';

const item = (id: string, over: Partial<StoredItem>): StoredItem => ({
  id, name: id, category: 'Tops', subType: 'Shirt', hex: '#000000', rgb: [0, 0, 0], colourFamily: 'Black', pattern: null, seasons: [],
  occasions: [], condition: null, favourite: false, status: 'active', fit: null, material: null, neverWorn: false,
  archiveReason: null, createdAt: '', updatedAt: '', ...over,
});
const items = [
  item('shirt', {}),
  item('jeans', { category: 'Bottoms', subType: 'Jeans', colourFamily: 'Blue', favourite: true }),
  item('old', { colourFamily: 'Blue', status: 'archived', archiveReason: 'sold' }),
  item('new', { condition: 0, colourFamily: 'Navy' }),
  item('flagged', { neverWorn: true, condition: 50 }),
];
const ids = (f: Partial<typeof NO_FILTER>) => filterItems(items, { ...NO_FILTER, ...f }).map((i) => i.id);

describe('wardrobe filters', () => {
  it('shows the active wardrobe by default, in list order', () => {
    expect(ids({})).toEqual(['shirt', 'jeans', 'new', 'flagged']);
  });
  it('shows only archived items when asked', () => {
    expect(ids({ archived: true })).toEqual(['old']);
  });
  it('filters by category', () => {
    expect(ids({ category: 'Bottoms' })).toEqual(['jeans']);
  });
  it('filters by colour family', () => {
    expect(ids({ colourFamily: 'Blue' })).toEqual(['jeans']);
    expect(ids({ colourFamily: 'Blue', archived: true })).toEqual(['old']);
  });
  it('combines filters with AND', () => {
    expect(ids({ category: 'Tops', colourFamily: 'Blue' })).toEqual([]);
    expect(ids({ category: 'Bottoms', favourite: true })).toEqual(['jeans']);
  });
  it('treats condition 0 like the never-worn flag (FR-14)', () => {
    expect(isNeverWorn(items[3]!)).toBe(true);
    expect(ids({ neverWorn: true })).toEqual(['new', 'flagged']);
  });
  it('does not change the input list', () => {
    const before = items.map((i) => i.id);
    filterItems(items, { ...NO_FILTER, favourite: true });
    expect(items.map((i) => i.id)).toEqual(before);
  });
});
