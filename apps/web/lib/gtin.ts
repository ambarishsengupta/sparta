/** Barcode numbers (FR-26, LLD 8.2, glossary "GTIN-14"): digits only, 8, 12, 13 or 14 of them, left-padded with zeros to 14. */
export const GTIN_LENGTHS: readonly number[] = [8, 12, 13, 14];

/** What was typed or scanned, without spaces, hyphens or other separators; null for anything that is not digits afterwards, or of another length. */
export function normaliseGtin(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  return /^[0-9]+$/.test(digits) && GTIN_LENGTHS.includes(digits.length) ? digits : null;
}
/** The form the catalogue stores (`catalog_items.gtin`) and `items.barcode` keeps: 14 digits, or null when the input is not a barcode number. */
export const padGtin = (raw: string): string | null => normaliseGtin(raw)?.padStart(14, '0') ?? null;
