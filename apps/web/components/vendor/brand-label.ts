import type { BrandLabels } from '../../lib/vendor/brands';
import { cellKey, type TrendData } from '../ui/vendor';

/** WO-0125: the vendor functions return a brand as its code (`demo-h-and-m`), not its label (`catalog.lk_brand.label`, "H&M"); the label is not in the answer and the database functions are not changed here.
 * So the screen shows the code without the `demo-` prefix and with each word capitalised ("H And M"). The code is still what the data is keyed by; only what is shown changes. */
export const guessLabel = (code: string): string => code.replace(/^demo-/, '').split('-').filter((w) => w !== '').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** WO-0155: the label of `catalog.lk_brand` for a code the map holds; the guess above stays for a code it does not hold, while the map loads and when it failed to load. */
export const brandLabel = (code: string, labels?: BrandLabels): string => labels?.get(code) ?? guessLabel(code);

/** A segment as shown. The brand is the whole segment of the `brand` dimension and the last part of `category_brand` ("Tops / demo-h-and-m"); every other dimension is left as it is. */
export function segmentLabel(dim: string, segment: string, labels?: BrandLabels): string {
  if (dim === 'brand') return brandLabel(segment, labels);
  if (dim !== 'category_brand') return segment;
  const parts = segment.split(' / ');
  return [...parts.slice(0, -1), brandLabel(parts.at(-1) ?? '', labels)].join(' / ');
}

/** The trend table with its segments shown by `segmentLabel` (the cells follow their segment). The same data when the dimension has no brand in it. */
export function trendLabels(dim: string, data: TrendData, labels?: BrandLabels): TrendData {
  if (dim !== 'brand' && dim !== 'category_brand') return data;
  const cells: TrendData['cells'] = {};
  for (const s of data.segments) for (const p of data.periods) { const v = data.cells[cellKey(s, p)]; if (v !== undefined) cells[cellKey(segmentLabel(dim, s, labels), p)] = v; }
  return { periods: data.periods, segments: data.segments.map((s) => segmentLabel(dim, s, labels)), cells };
}
