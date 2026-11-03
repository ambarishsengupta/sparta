import { OCCASIONS, PATTERNS, SEASONS, categoryOfSubType, colourFamily, hexToRgb, swatches } from '@sparta/taxonomy';
import type { SubType } from '@sparta/taxonomy';
import type { Item } from '../types.js';

/** mulberry32: a tiny seeded generator, so a failing wardrobe can be rebuilt from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mostly shorts, a few jeans and mostly formal shoes: the mix where trimming to the best eight once hid the only valid pair. */
export const PAIR_HEAVY: SubType[] = ['T-shirt', 'T-shirt', 'Shorts', 'Shorts', 'Shorts', 'Shorts', 'Sports shorts', 'Jeans', 'Formal shoes', 'Formal shoes', 'Sneakers'];
const SUB_TYPES: SubType[] = [
  'T-shirt', 'Shirt', 'Polo', 'Sweater', 'Cardigan', 'Hoodie', 'Sports T-shirt', 'Jeans', 'Chinos', 'Trousers', 'Shorts', 'Joggers', 'Track pants',
  'Sports shorts', 'Jacket', 'Blazer', 'Coat', 'Track jacket', 'Sneakers', 'Formal shoes', 'Boots', 'Sandals', 'Suit', 'Tuxedo', 'Waistcoat',
  'Belt', 'Belt', 'Watch', 'Tie', 'Socks', 'Kurta',
];

/** A random wardrobe of `min` to `min + 22` items: any suggestible or ignored sub-type, any colour, some archived, tagged or unrated. */
export function randomWardrobe(seed: number, pool: readonly SubType[] = SUB_TYPES, min = 4): Item[] {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const some = <T>(xs: readonly T[]): T[] => (r() < 0.5 ? [] : xs.filter(() => r() < 0.4));
  return Array.from({ length: min + Math.floor(r() * 23) }, (_, n) => {
    const subType = pick(pool);
    const rgb = r() < 0.5 ? hexToRgb(pick(swatches).hex) : ([0, 0, 0].map(() => Math.floor(r() * 256)) as [number, number, number]);
    return {
      id: `r${seed}-${n}`, name: `${subType} ${n}`, category: categoryOfSubType(subType)!, subType, rgb, colourFamily: colourFamily(...rgb)!,
      pattern: r() < 0.2 ? null : pick(PATTERNS), seasons: some(SEASONS), occasions: some(OCCASIONS),
      condition: r() < 0.3 ? null : Math.floor(r() * 101), favourite: r() < 0.2, status: r() < 0.1 ? 'archived' : 'active',
    } satisfies Item;
  });
}

/** The same items in a seeded random order. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const r = rng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
