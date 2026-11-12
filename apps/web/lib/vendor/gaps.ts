import { withBase, type Base } from './dashboard';
import { gaps, type Dimension, type Filter, type GapRow, type Insight } from './insights';

/** The gaps page's loading and ordering (FR-75, FR-81, LLD 5.4). The score is the function's own value; nothing here computes a number. */
type Client = Parameters<typeof gaps>[0];
export const TOP_N = 50;
export const NO_OWNERSHIP = 'no visible ownership';
export interface GapsData { rows: GapRow[]; hidden: string[] }

/** Scored segments first (score high to low, ties by name), then the "no visible ownership" ones by name. The function already answers in this order; this keeps the page right if it ever did not. */
export function rankGaps(rows: GapRow[]): GapRow[] {
  const byName = (a: GapRow, b: GapRow) => a.segment.localeCompare(b.segment);
  return [...rows.filter((r) => r.gap_score !== null).sort((a, b) => b.gap_score! - a.gap_score! || byName(a, b)), ...rows.filter((r) => r.gap_score === null).sort(byName)];
}

/** One call for the chosen dimension and filter. With a filter on, the segments seen without it that are missing now are listed as hidden (FR-77); that is only said when the unfiltered answer was not cut at TOP_N. */
export async function loadGaps(c: Client, dim: Dimension, filter: Filter, base: Base): Promise<Insight<GapsData>> {
  const r = await withBase(base, `gaps:${dim}`, filter, (f) => gaps(c, dim, f, TOP_N));
  if (!r.ok) return r;
  const now = r.data.now as GapRow[]; const before = r.data.base as GapRow[];
  const seen = new Set(now.map((x) => x.segment));
  const hidden = filter && before.length < TOP_N ? before.map((x) => x.segment).filter((s) => !seen.has(s)).sort() : [];
  return { ok: true, data: { rows: rankGaps(now), hidden } };
}
