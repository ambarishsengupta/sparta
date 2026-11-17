import { CATEGORIES } from '@sparta/taxonomy';
import { conditionSpectrum, coverage, filterOptions, ownershipMix, trend, type BandShare, type Coverage, type Filter, type FilterOption, type Insight, type TrendRow } from './insights';

/** The vendor dashboard's loading and arithmetic (LLD 5.4, FDD 10.2). Every number shown comes from an insight function; the only calculation here is the share division. */
type Client = Parameters<typeof coverage>[0];
export const MIX_DIMS = ['category', 'colour_family', 'fit', 'brand'] as const;
export const TREND_DIMS = ['category', 'brand'] as const;
export interface DashState { mixDim: (typeof MIX_DIMS)[number]; trendDim: (typeof TREND_DIMS)[number]; category: string; filter: Filter }
export const INITIAL: DashState = { mixDim: 'category', trendDim: 'category', category: CATEGORIES[0] ?? 'Tops', filter: null };
export interface Seg { segment: string; value: number | null }
export interface TrendView { periods: string[]; segments: string[]; cells: Record<string, number | null> }
/** The unfiltered answers seen so far on this page, by view; they tell which segments a filter hides. Lives in the component, never across users or pages. */
export type Base = Record<string, unknown[]>;

/** Segment's share of the cohort in whole percent: both inputs are published, rounded values (glossary "Share"). Null without a cohort figure. */
export const share = (value: number, cohort: number | null): number | null => (cohort ? Math.round((value / cohort) * 100) : null);

/** A new view of the page: one event per distinct view, not one per render. */
export const viewKey = (s: DashState) => JSON.stringify([s.mixDim, s.trendDim, s.category, s.filter]);

/** The segments seen without the filter, with the filtered values; a segment the filter hides gets null (shown as "Not enough users to display"), biggest first, hidden last. */
export function withHidden(base: { segment: string; users_rounded: number }[], now: { segment: string; users_rounded: number }[]): Seg[] {
  const value = new Map(now.map((r) => [r.segment, r.users_rounded]));
  const names = [...new Set([...base.map((r) => r.segment), ...now.map((r) => r.segment)])];
  return names.map((segment) => ({ segment, value: value.get(segment) ?? null }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.segment.localeCompare(b.segment));
}

/** Months across, segments down; a segment seen without the filter that has no row now is a row of suppressed cells. */
export function pivot(base: TrendRow[], now: TrendRow[], field: 'users_rounded' | 'events_rounded'): TrendView {
  const month = (p: string) => p.slice(0, 7);
  const rows = [...base, ...now];
  const cells: TrendView['cells'] = {};
  for (const r of now) cells[`${r.segment}\u0000${month(r.period)}`] = r[field];
  return { periods: [...new Set(rows.map((r) => month(r.period)))].sort(), segments: [...new Set(rows.map((r) => r.segment))].sort(), cells };
}

/** Runs `load` for the current filter; with a filter on and no unfiltered answer yet for this view, asks once for that too. Returns the base and the current rows. */
export async function withBase<T>(base: Base, key: string, filter: Filter, load: (f: Filter) => Promise<Insight<T[]>>): Promise<Insight<{ base: T[]; now: T[] }>> {
  const now = await load(filter);
  if (!now.ok) return now;
  if (!filter) base[key] = now.data;
  else if (!base[key]) { const b = await load(null); if (b.ok) base[key] = b.data; }
  return { ok: true, data: { base: (base[key] ?? now.data) as T[], now: now.data } };
}

export const loadHeader = async (c: Client): Promise<{ coverage: Insight<Coverage | null>; options: Insight<FilterOption[]> }> => {
  const [cov, options] = await Promise.all([coverage(c), filterOptions(c)]);
  return { coverage: cov, options };
};
export async function loadMix(c: Client, s: DashState, base: Base): Promise<Insight<Seg[]>> {
  const r = await withBase(base, `mix:${s.mixDim}`, s.filter, (f) => ownershipMix(c, s.mixDim, f));
  return r.ok ? { ok: true, data: withHidden(r.data.base, r.data.now) } : r;
}
export async function loadTrends(c: Client, s: DashState, base: Base): Promise<{ purchase: Insight<TrendView>; wishlist: Insight<TrendView> }> {
  const one = async (kind: 'purchase' | 'wishlist', field: 'users_rounded' | 'events_rounded'): Promise<Insight<TrendView>> => {
    const r = await withBase(base, `${kind}:${s.trendDim}`, s.filter, (f) => trend(c, kind, s.trendDim, f));
    return r.ok ? { ok: true, data: pivot(r.data.base, r.data.now, field) } : r;
  };
  const [purchase, wishlist] = await Promise.all([one('purchase', 'events_rounded'), one('wishlist', 'users_rounded')]);
  return { purchase, wishlist };
}
export const loadSpectrum = (c: Client, s: DashState): Promise<Insight<BandShare[]>> => conditionSpectrum(c, s.category);
