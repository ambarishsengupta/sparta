import type { createBrowserSupabase } from '../supabase/browser';
import type { Database } from '../supabase/database.types';

/** The vendor's calls to the aggregate functions of LLD 5.4, made with the signed-in vendor's own session. Nothing here keeps state between calls (no cache: the next user on this
 * machine must never see the last one's figures), reads another table or builds a number. A failed call becomes one of a few fixed sentences; the server's text is never shown. */
type Client = Pick<ReturnType<typeof createBrowserSupabase>, 'schema'>;
type AnalyticsFn = keyof Database['analytics']['Functions'];
/** The shape of the one call made here. The functions are called by name with arguments built from the screen's filters (a null means no filter, which the generated argument types cannot say), so the typed builder is read through this wider shape (the one cast in this file, below). The function NAME stays typed: a renamed or dropped function stops compiling. The row types below are written by hand because the generated return types say non-null where the functions return null; the answer is checked at run time. */
type Rpc = { rpc(fn: AnalyticsFn, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string; name?: string } | null; status: number }> };
export const DIMENSIONS = ['category', 'colour_family', 'fit', 'brand', 'category_colour_family', 'category_fit', 'category_brand'] as const;
export const FILTER_DIMS = ['size', 'season', 'price_band', 'region'] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type Filter = { dim: (typeof FILTER_DIMS)[number]; value: string } | null;
export type InsightKind = 'agreement_required' | 'rate_limited' | 'maintenance' | 'forbidden' | 'network' | 'unexpected';

export const INSIGHT_SENTENCES: Record<InsightKind, string> = {
  agreement_required: 'Accept the current Vendor Pilot Agreement to see this data.',
  rate_limited: 'You have used the hourly limit for the portal. Try again in a little while.',
  maintenance: 'The portal is paused for maintenance. Try again later.',
  forbidden: 'This account is not allowed to see vendor data.',
  network: 'Could not reach the server. Check your connection and reload the page.',
  unexpected: 'Something went wrong while loading the figures. Please reload the page.',
};
export type Insight<T> = { ok: true; data: T } | { ok: false; kind: InsightKind; message: string };

export interface MixRow { segment: string; users_rounded: number }
export interface Coverage { users_rounded: number | null; last_run_at: string | null }
export interface FilterOption { filter_dim: string; filter_value: string }
export interface TrendRow { period: string; segment: string; users_rounded: number | null; events_rounded: number | null }
export interface GapRow { segment: string; owner_users_rounded: number | null; wishlist_users_rounded: number; gap_score: number | null; label: string | null }
export interface BandShare { band: string; share: number | null }
export interface ReportRow { id: string; period: string; reviewed_at: string }
export interface ReportDetail extends ReportRow { payload: unknown }

const fail = (kind: InsightKind): Insight<never> => ({ ok: false, kind, message: INSIGHT_SENTENCES[kind] });

/** What a screen shows for a load that rejected instead of answering (the wrappers below never reject, but a loader built on them can): the fixed 'unexpected' sentence, so a slot never stays on "Loading.". Use as the second argument of `.then`. */
export const loadFailed = (): Insight<never> => fail('unexpected');

/** Which fixed sentence an answer from the server stands for. `status` is 0 when no answer arrived. */
export function kindOf(status: number | undefined, error: { code?: string | null; message?: string | null; name?: string | null }): InsightKind {
  const text = error.message ?? '';
  if (status === 0 || error.name === 'AuthRetryableFetchError') return 'network';   // status 0: the request got no answer
  for (const k of ['agreement_required', 'rate_limited', 'maintenance'] as const) if (text.includes(k)) return k;
  return error.code === '42501' || text.includes('forbidden') ? 'forbidden' : 'unexpected';
}

async function call<T>(client: Client, fn: AnalyticsFn, args: Record<string, unknown> = {}): Promise<Insight<T[]>> {
  try {
    const analytics = client.schema('analytics') as Rpc;
    const r = await analytics.rpc(fn, args);
    if (r.error) return fail(kindOf(r.status, r.error));
    return Array.isArray(r.data) ? { ok: true, data: r.data as T[] } : fail('unexpected');
  } catch (e) { return fail(e instanceof TypeError ? 'network' : 'unexpected'); }
}
const first = <T>(r: Insight<T[]>): Insight<T | null> => (r.ok ? { ok: true, data: r.data[0] ?? null } : r);
const filterArgs = (f: Filter) => ({ p_filter_dim: f?.dim ?? null, p_filter_value: f?.value ?? null });

export const ownershipMix = (c: Client, dim: Dimension, filter: Filter = null) => call<MixRow>(c, 'ownership_mix', { p_dim: dim, ...filterArgs(filter) });
export const coverage = async (c: Client) => first(await call<Coverage>(c, 'coverage'));
export const filterOptions = (c: Client) => call<FilterOption>(c, 'filter_options');
export const trend = (c: Client, kind: 'purchase' | 'wishlist', dim: Dimension, filter: Filter = null) => call<TrendRow>(c, 'trend', { p_kind: kind, p_dim: dim, p_period_unit: 'month', ...filterArgs(filter) });
export const gaps = (c: Client, dim: Dimension, filter: Filter = null, topN = 20) => call<GapRow>(c, 'gaps', { p_dim: dim, ...filterArgs(filter), p_top_n: topN });
export const conditionSpectrum = (c: Client, category: string) => call<BandShare>(c, 'condition_spectrum', { p_category: category });
export const reports = (c: Client) => call<ReportRow>(c, 'reports');
export const report = async (c: Client, id: string) => first(await call<ReportDetail>(c, 'report', { p_id: id }));
