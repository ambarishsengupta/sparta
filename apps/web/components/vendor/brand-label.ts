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

/** The last name when even the code is taken: the code with a counter, counted up until the name is free. */
const lastResort = (s: string, taken: Set<string>): string => { let n = 2; while (taken.has(`${s} (${n})`)) n++; return `${s} (${n})`; };

/** The name each segment is shown as. WO-0156: `catalog.lk_brand.label` is not unique. A label already shown for an earlier segment is not shown again: the later segment shows the code-shaped guess, then the label with its code, then the code, so every shown name is unique.
 * WO-0157: build it once over all the segments of the page's trend tables (see `unionSegments`), so a brand has one name in every table. */
export function shownNames(dim: string, segments: string[], labels?: BrandLabels): Map<string, string> {
  const taken = new Set<string>();
  const names = new Map<string, string>();
  for (const s of segments) {
    if (names.has(s)) continue;
    const label = segmentLabel(dim, s, labels);
    const pick = [label, segmentLabel(dim, s), `${label} (${s})`, s].find((c) => !taken.has(c)) ?? lastResort(s, taken);
    taken.add(pick);
    names.set(s, pick);
  }
  return names;
}

/** The segments of several trend tables as one list: each table's segments in order, a segment already listed not again. */
export const unionSegments = (...tables: ({ segments: string[] } | undefined)[]): string[] => [...new Set(tables.flatMap((t) => t?.segments ?? []))];

/** The trend table with its segments shown by `names` (the cells follow their segment). The same data when the dimension has no brand in it.
 * Without `names` the names are built from this table's own segments; the dashboard passes one map for both of its tables. */
export function trendLabels(dim: string, data: TrendData, labels?: BrandLabels, names?: Map<string, string>): TrendData {
  if (dim !== 'brand' && dim !== 'category_brand') return data;
  const map = names ?? shownNames(dim, data.segments, labels);
  const shown = data.segments.map((s) => map.get(s) ?? s);
  const cells: TrendData['cells'] = {};
  data.segments.forEach((s, i) => { for (const p of data.periods) { const v = data.cells[cellKey(s, p)]; if (v !== undefined) cells[cellKey(shown[i]!, p)] = v; } });
  return { periods: data.periods, segments: shown, cells };
}
