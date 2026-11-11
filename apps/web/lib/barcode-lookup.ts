import type { CatalogueCollection, CatalogueItem } from './catalogue';
import { padGtin } from './gtin';

/** Barcode lookup (FR-26, LLD 4.8): the code is normalised and padded to 14 digits in the browser, and that padded code is the only thing sent (in the catalogue query). */
export type BarcodeResult =
  | { kind: 'invalid' }
  | { kind: 'none'; gtin: string }
  | { kind: 'one'; gtin: string; item: CatalogueItem }
  | { kind: 'many'; gtin: string; items: CatalogueItem[] };

export async function lookupBarcode(catalogue: Pick<CatalogueCollection, 'byGtin'>, raw: string): Promise<BarcodeResult> {
  const gtin = padGtin(raw);
  if (gtin === null) return { kind: 'invalid' };
  const items = await catalogue.byGtin(gtin);
  return items.length === 0 ? { kind: 'none', gtin } : items.length === 1 ? { kind: 'one', gtin, item: items[0]! } : { kind: 'many', gtin, items };
}

export const BARCODE_INVALID = 'A barcode number has 8, 12, 13 or 14 digits. Check it and try again.';
export const BARCODE_FAILED = 'The catalogue could not be searched just now. Try again, or add the item yourself.';
export const SCAN_FAILED = 'The camera could not be used. You can type the number instead.';
export const noMatch = (gtin: string) => `No catalogue item has the barcode ${gtin}. You can add the item yourself and keep the barcode with it.`;
export const severalMatches = (n: number, gtin: string) => `${n} catalogue items have the barcode ${gtin}. Choose the one you have.`;
/** Where "Add my own" goes with a barcode kept: the new-item page reads and checks the number again. */
export const addOwnWithBarcode = (gtin: string) => `/items/new?barcode=${gtin}`;
