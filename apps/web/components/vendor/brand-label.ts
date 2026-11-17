import { cellKey, type TrendData } from '../ui/vendor';

/** WO-0125: the vendor functions return a brand as its code (`demo-h-and-m`), not its label (`catalog.lk_brand.label`, "H&M"); the label is not in the answer and the database functions are not changed here.
 * So the screen shows the code without the `demo-` prefix and with each word capitalised ("H And M"). The code is still what the data is keyed by; only what is shown changes. */
export const brandLabel = (code: string): string => code.replace(/^demo-/, '').split('-').filter((w) => w !== '').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** A segment as shown. The brand is the whole segment of the `brand` dimension and the last part of `category_brand` ("Tops / demo-h-and-m"); every other dimension is left as it is. */
export function segmentLabel(dim: string, segment: string): string {
  if (dim === 'brand') return brandLabel(segment);
  if (dim !== 'category_brand') return segment;
  const parts = segment.split(' / ');
  return [...parts.slice(0, -1), brandLabel(parts.at(-1) ?? '')].join(' / ');
}

/** The trend table with its segments shown by `segmentLabel` (the cells follow their segment). The same data when the dimension has no brand in it. */
export function trendLabels(dim: string, data: TrendData): TrendData {
  if (dim !== 'brand' && dim !== 'category_brand') return data;
  const cells: TrendData['cells'] = {};
  for (const s of data.segments) for (const p of data.periods) { const v = data.cells[cellKey(s, p)]; if (v !== undefined) cells[cellKey(segmentLabel(dim, s), p)] = v; }
  return { periods: data.periods, segments: data.segments.map((s) => segmentLabel(dim, s)), cells };
}
