/** WO-0084: WCAG 2.2 colour maths for the category illustrations. Pure, no imports. */
export const BLACK = '#000000';
export const WHITE = '#ffffff';

/** A lower-case #rrggbb, or null unless the input is #rgb or #rrggbb: nothing else reaches the markup. */
export function normaliseHex(hex: unknown): string | null {
  const h = typeof hex === 'string' ? hex.trim().toLowerCase() : '';
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(h)) return null;
  return h.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h;
}

const channel = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
