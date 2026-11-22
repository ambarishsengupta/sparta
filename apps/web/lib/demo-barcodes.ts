import { HM_ARTICLES } from './demo-hm';
import type { HmArticle } from './demo-hm';

/**
 * DEMO BARCODES FOR THE NO-LOGIN DEMO (UI wave 3a). Five EAN-13 numbers that start with 200 to 299, the range GS1 keeps for in-store numbers, so none is a real product's code.
 * Each maps to one H&M demo article, picked by category and sub-type from the article list at run time (the first by sku). With no H&M list the lists below are empty.
 */
export interface DemoBarcode { gtin: string; label: string }

/** The EAN-13 check digit of a 12-digit stem: digits at odd places count once, at even places three times. */
export function ean13CheckDigit(stem: string): string {
  const sum = [...stem].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
}

const SLOTS: readonly { label: string; stem: string; wants: readonly (readonly [string, string])[] }[] = [
  { label: 'Shirt', stem: '200100000011', wants: [['Tops', 'Shirt']] },
  { label: 'Jeans', stem: '200100000028', wants: [['Bottoms', 'Jeans'], ['Bottoms', 'Trousers'], ['Bottoms', 'Chinos']] },
  { label: 'Sneakers', stem: '200100000035', wants: [['Footwear', 'Sneakers']] },
  { label: 'Jacket', stem: '200100000042', wants: [['Outerwear', 'Jacket']] },
  { label: 'Belt', stem: '200100000059', wants: [['Accessories', 'Belt']] },
];

const picked: { code: DemoBarcode; article: HmArticle }[] = SLOTS.flatMap((slot) => {
  for (const [category, subType] of slot.wants) {
    const article = HM_ARTICLES.filter((a) => a.category === category && a.subType === subType).sort((a, b) => (a.sku < b.sku ? -1 : 1))[0];
    if (article) return [{ code: { gtin: slot.stem + ean13CheckDigit(slot.stem), label: slot.wants.length > 1 ? subType : slot.label }, article }];
  }
  return [];
});

export const DEMO_BARCODES: readonly DemoBarcode[] = picked.map((p) => p.code);

const stripZeros = (g: string) => g.replace(/^0+/, '');
/** The H&M article behind a demo barcode (the 13-digit number or its 14-digit padded form), or undefined for any other number. */
export const demoArticleForGtin = (gtin: string): HmArticle | undefined => picked.find((p) => stripZeros(p.code.gtin) === stripZeros(gtin))?.article;

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** The 95 modules of an EAN-13 symbol as a string of 1 (bar) and 0 (space): guards, six left digits by the parity of the first digit, six right digits. */
export function ean13Modules(gtin: string): string {
  if (!/^[0-9]{13}$/.test(gtin)) return '';
  const d = [...gtin].map(Number);
  const parity = PARITY[d[0]!]!;
  const left = d.slice(1, 7).map((n, i) => (parity[i] === 'L' ? L[n]! : G[n]!)).join('');
  const right = d.slice(7).map((n) => R[n]!).join('');
  return `101${left}01010${right}101`;
}
