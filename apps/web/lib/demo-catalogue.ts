import type { Category, Fit, Material, SubType } from '@sparta/taxonomy';
import { colourFamily, hexToRgb } from '@sparta/taxonomy';
import type { CatalogueItem } from './catalogue';
import { HM_ARTICLES, hmCatalogue } from './demo-hm';

/**
 * SYNTHETIC demo catalogue for the browser-only (no-login) prototype: 40 invented items (8 garments x 5 colours) under 8 invented brands, so the
 * picker can be shown without a database. Never real products, brands or prices; the links are not https addresses, so no "View at source" appears.
 * The signed-in app reads the real catalogue table instead and shows its empty state until the owner approves a source.
 */
export const DEMO_CATALOGUE_SYNTHETIC = true;
const BRANDS = ['Zorvane', 'Quillibrook', 'Pemberlow', 'Wexmarrow', 'Ostrelle', 'Brindlewick', 'Fenwrath', 'Tallowmere'];
const COLOURS: readonly [string, string][] = [['Ink black', '#111111'], ['Chalk white', '#F4F4F0'], ['Harbour navy', '#1F2A44'], ['Sage green', '#2E8B57'], ['Dune beige', '#D9C7A0']];
const TEMPLATES: readonly [Category, SubType, string, Fit | null, Material, number, string[]][] = [
  ['Tops', 'T-shirt', 'Crew tee', 'Regular', 'Cotton', 799, ['S', 'M', 'L']], ['Tops', 'Shirt', 'Oxford shirt', 'Slim', 'Cotton', 1499, ['S', 'M', 'L']],
  ['Tops', 'Sweater', 'Knit jumper', 'Regular', 'Wool', 2299, ['M', 'L']], ['Bottoms', 'Jeans', 'Straight jeans', 'Regular', 'Denim', 2499, ['30', '32', '34']],
  ['Bottoms', 'Chinos', 'Tapered chinos', 'Slim', 'Cotton', 1899, ['30', '32', '34']], ['Outerwear', 'Jacket', 'Field jacket', 'Regular', 'Cotton', 3999, ['M', 'L']],
  ['Footwear', 'Sneakers', 'Court sneakers', null, 'Leather', 3499, ['8', '9', '10']], ['Accessories', 'Bag', 'Canvas tote', null, 'Cotton', 999, []],
];

export const DEMO_CATALOGUE_SYNTHETIC_ITEMS: readonly CatalogueItem[] = TEMPLATES.flatMap(([category, subType, label, fit, material, price, sizes], t) => COLOURS.map(([colour, hex], c): CatalogueItem => ({
  id: `demo-${String(t * 5 + c + 1).padStart(4, '0')}`, name: `${label} - ${colour}`, brand: BRANDS[(t + c) % 8]!, category, subType, hex,
  colourFamily: colourFamily(...hexToRgb(hex)), fit, pattern: 'Solid', material, seasons: ['Spring', 'Summer'], occasions: ['Casual'], sizes, price, currency: 'INR',
  productUrl: `/demo/DEMO-${String(t * 5 + c + 1).padStart(4, '0')}`,
})));

/** The picker's list: the 40 synthetic items, or, in the local no-login H&M demo (`start-demo.sh --no-login --hm`, WO-0122), the H&M demo articles in their place. */
export const DEMO_CATALOGUE: readonly CatalogueItem[] = HM_ARTICLES.length > 0 ? hmCatalogue(HM_ARTICLES) : DEMO_CATALOGUE_SYNTHETIC_ITEMS;
