import { colourFamily, isCategory, isSubType, rgbToHex } from '@sparta/taxonomy';
import type { Category, Occasion, Season, SubType } from '@sparta/taxonomy';
import type { Item } from '@sparta/rules';
import { HM_DEMO_SOURCE } from './catalogue';
import type { CatalogueItem } from './catalogue';
import { hmDemoArticles } from './pilot-config';

/**
 * H&M ARTICLES FOR THE NO-LOGIN DEMO (WO-0122, local only). The start script puts a generated, git-ignored list of about 200 articles into the build environment
 * (`start-demo.sh --no-login --hm`); with no list, everything here is empty and the demo is the synthetic one. Nothing H&M is stored in the repository.
 * The wardrobes follow the pattern of the accounts mode (demo-data.sh --hm): 60 and 12 items, picked from the articles by category.
 */
export interface HmArticle { sku: string; name: string; category: Category; subType: SubType; rgb: [number, number, number] | null }
const GREY: [number, number, number] = [110, 120, 130];
const byte = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255;

/** `[[sku, name, category, subType, r, g, b], ...]`; a row that is not exactly that (10-digit sku, known category and sub-type) is dropped, and bad JSON gives an empty list. */
export function parseHmArticles(raw: string | null): HmArticle[] {
  let rows: unknown;
  try { rows = raw === null ? [] : JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r: unknown): HmArticle[] => {
    if (!Array.isArray(r) || r.length !== 7) return [];
    const [sku, name, category, subType, ...rgb] = r as unknown[];
    if (typeof sku !== 'string' || !/^[0-9]{10}$/.test(sku) || typeof name !== 'string' || name.trim() === '' || !isCategory(category) || !isSubType(category, subType)) return [];
    if (rgb.every((c) => c === null)) return [{ sku, name: name.slice(0, 120), category, subType, rgb: null }];
    return byte(rgb[0]) && byte(rgb[1]) && byte(rgb[2]) ? [{ sku, name: name.slice(0, 120), category, subType, rgb: [rgb[0], rgb[1], rgb[2]] }] : [];
  });
}

const SIZES: Partial<Record<Category, string[]>> = { Tops: ['S', 'M', 'L'], Outerwear: ['M', 'L'], Bottoms: ['30', '32', '34'], Footwear: ['8', '9', '10'] };
const PRICE: Partial<Record<Category, number>> = { Tops: 799, Bottoms: 1499, Footwear: 2999, Outerwear: 3999, Accessories: 899 };
const occasionsOf = (s: SubType): Occasion[] => (['Shirt', 'Chinos', 'Trousers', 'Watch', 'Belt'].includes(s) ? ['Casual', 'Work', 'Date'] : ['Formal shoes', 'Blazer'].includes(s) ? ['Work', 'Formal', 'Date'] : ['Casual', 'Travel']);
/** The seasons rule of demo-data.sh: Outerwear Autumn and Winter, Shorts, Sandals and T-shirts Spring and Summer, the rest all year. */
const seasonsOf = (c: Category, s: SubType): Season[] => (c === 'Outerwear' ? ['Autumn', 'Winter'] : ['Shorts', 'Sandals', 'T-shirt'].includes(s) ? ['Spring', 'Summer'] : ['All year']);
const hexOf = (a: HmArticle): string => rgbToHex(...(a.rgb ?? GREY));

/** The picker's rows: `sku` and `source` make a tile show the photograph (the same rule as the signed-in catalogue). No product link (an empty address gives no "View at source"). */
export const hmCatalogue = (articles: readonly HmArticle[]): CatalogueItem[] => articles.map((a): CatalogueItem => ({
  id: `hm-${a.sku}`, name: a.name, brand: 'H&M', category: a.category, subType: a.subType, hex: hexOf(a), colourFamily: colourFamily(...(a.rgb ?? GREY)), fit: null, pattern: 'Solid', material: null,
  seasons: seasonsOf(a.category, a.subType), occasions: occasionsOf(a.subType), sizes: SIZES[a.category] ?? [], price: PRICE[a.category] ?? null, currency: PRICE[a.category] ? 'INR' : null,
  productUrl: '', sku: a.sku, source: HM_DEMO_SOURCE,
}));

export type HmItem = Item & { photoId: string; catalogueId: string };
const RICH = [1, 1, 2, 1, 3, 2, 1, 4, 2, 5, 1, 3, 2, 1, 5, 4, 1, 2, 3, 5];   // slot pattern of demo-data.sh: 1 Tops, 2 Bottoms, 3 Footwear, 4 Outerwear, 5 Accessories
const THIN = [1, 2, 3, 1, 2, 1, 3, 2, 1, 3, 2, 1];
const SLOTS: readonly Category[] = ['Tops', 'Bottoms', 'Footwear', 'Outerwear', 'Accessories'];

function wardrobe(prefix: string, pattern: number[], n: number, articles: readonly HmArticle[]): HmItem[] {
  const pool = (c: Category) => articles.filter((a) => a.category === c).sort((a, b) => (a.sku < b.sku ? -1 : 1));
  const used = new Map<Category, number>();
  return Array.from({ length: n }, (_, i) => {
    const category = SLOTS[pattern[i % pattern.length]! - 1]!;
    const from = pool(category);
    const j = used.get(category) ?? 0;
    used.set(category, j + 1);
    const a = from[(j * 7) % Math.max(from.length, 1)];
    if (!a) return [];
    const rgb = a.rgb ?? GREY;
    return [{
      id: `${prefix}-${String(i + 1).padStart(2, '0')}`, name: a.name, category, subType: a.subType, rgb, colourFamily: colourFamily(...rgb)!, pattern: 'Solid', seasons: seasonsOf(category, a.subType), occasions: occasionsOf(a.subType),
      condition: (i * 37 + pattern[i % pattern.length]! * 11) % 85, favourite: i % 9 === 0, status: 'active', photoId: a.sku, catalogueId: `hm-${a.sku}`,
    } satisfies HmItem];
  }).flat();
}

export const hmWardrobes = (articles: readonly HmArticle[]): Record<string, HmItem[]> => (articles.length === 0 ? {} : {
  'H&M men\'s wardrobe (60 items)': wardrobe('hm-rich', RICH, 60, articles), 'H&M thin wardrobe (12 items)': wardrobe('hm-thin', THIN, 12, articles),
});

export const HM_ARTICLES: readonly HmArticle[] = parseHmArticles(hmDemoArticles());
