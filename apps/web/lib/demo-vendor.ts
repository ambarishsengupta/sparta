import { colourFamily } from '@sparta/taxonomy';
import { cellKey } from '../components/ui/vendor/TrendTable';
import type { Seg, TrendView } from './vendor/dashboard';
import type { BrandLabels } from './vendor/brands';
import type { BandShare, Coverage, Filter, FilterOption, GapRow } from './vendor/insights';
import type { Payload } from './vendor/reports';
import { HM_ARTICLES, type HmArticle } from './demo-hm';

/**
 * FIXED DEMO DATA for the vendor portal and the admin pages of the no-login demo (UI wave 2a). Nothing here is read from a network or a database: every figure is a plain number in the
 * shape the real screens already draw, for a pilot of about 400 users (counts rounded to the nearest 5). The vendor is fictional. Photographs are the H&M demo articles of
 * NEXT_PUBLIC_HM_DEMO_ARTICLES (nothing is copied into the repository); with no list, a row shows the neutral "No photo yet" tile.
 */
export const DEMO_VENDOR_NAME = 'Northline Apparel (demo vendor)';
export const DEMO_VENDOR_EMAIL = 'vendor-demo@example.test';
export const DEMO_BRAND_LABELS: BrandLabels = new Map([['northline-apparel', DEMO_VENDOR_NAME], ['demo-brand-a', 'Demo brand A'], ['demo-brand-b', 'Demo brand B'], ['demo-brand-c', 'Demo brand C']]);

// ---- photographs ----------------------------------------------------------------------------------------------------------------------------------------------------------

const bySku = (a: HmArticle, b: HmArticle) => (a.sku < b.sku ? -1 : 1);
/** The n-th H&M demo article of a category, in sku order, preferring a sub-type and a colour family when the list has one; null with no list. */
export function demoArticle(category: string, n = 0, want: { subType?: string; family?: string } = {}): HmArticle | null {
  const all = HM_ARTICLES.filter((a) => a.category === category).sort(bySku);
  const sub = want.subType ? all.filter((a) => a.subType === want.subType) : [];
  const fam = (from: HmArticle[]) => (want.family ? from.filter((a) => a.rgb !== null && colourFamily(...a.rgb) === want.family) : []);
  const pool = [fam(sub), sub, fam(all), all].find((p) => p.length > 0) ?? [];
  return pool[n % Math.max(pool.length, 1)] ?? null;
}

// ---- the dashboard --------------------------------------------------------------------------------------------------------------------------------------------------------

export const DEMO_COVERAGE: Coverage = { users_rounded: 410, last_run_at: '2026-11-21T02:00:00.000Z' };
export const DEMO_FILTER_OPTIONS: FilterOption[] = [
  ...['S', 'M', 'L', 'XL'].map((v) => ({ filter_dim: 'size', filter_value: v })),
  ...['Spring', 'Summer', 'Autumn', 'Winter', 'All year'].map((v) => ({ filter_dim: 'season', filter_value: v })),
  ...['<25', '25-50', '50-100', '100-200', '200+'].map((v) => ({ filter_dim: 'price_band', filter_value: v })),
  { filter_dim: 'region', filter_value: 'South Asia' },
];

const MIX: Record<string, [string, number][]> = {
  category: [['Tops', 385], ['Bottoms', 360], ['Footwear', 330], ['Underwear and socks', 290], ['Accessories', 245], ['Outerwear', 215], ['Activewear', 110], ['Occasion wear', 90], ['Ethnic wear', 75]],
  colour_family: [['Black', 365], ['White', 300], ['Grey', 290], ['Navy', 255], ['Blue', 230], ['Beige', 175], ['Brown', 120], ['Olive', 95], ['Red', 85], ['Green', 70], ['Khaki', 60], ['Pink', 55]],
  fit: [['Regular', 340], ['Slim', 215], ['Relaxed', 190], ['Oversized', 105], ['Tailored', 65]],
  brand: [['demo-brand-a', 320], ['northline-apparel', 205], ['demo-brand-b', 180], ['demo-brand-c', 95]],
};
export const DEMO_PERIODS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
/** Purchases per month (events) and users adding wishlist items per month, by category and by brand: six months, counts rounded to the nearest 5. */
const PURCHASES: Record<string, Record<string, number[]>> = {
  category: { Tops: [60, 65, 70, 55, 50, 65], Bottoms: [35, 40, 35, 30, 35, 40], Footwear: [25, 30, 30, 35, 30, 35], Outerwear: [10, 10, 5, 10, 25, 45], Accessories: [20, 20, 25, 25, 30, 35] },
  brand: { 'demo-brand-a': [70, 75, 70, 65, 70, 80], 'northline-apparel': [40, 45, 50, 50, 55, 60], 'demo-brand-b': [30, 30, 35, 30, 25, 35], 'demo-brand-c': [15, 15, 10, 15, 15, 20] },
};
const WISHLIST: Record<string, Record<string, number[]>> = {
  category: { Tops: [45, 50, 55, 50, 55, 60], Bottoms: [30, 30, 35, 40, 40, 45], Footwear: [35, 40, 45, 50, 55, 60], Outerwear: [15, 15, 15, 25, 45, 75], Accessories: [20, 25, 20, 25, 30, 30] },
  brand: { 'demo-brand-a': [55, 60, 60, 65, 70, 70], 'northline-apparel': [30, 35, 45, 55, 65, 80], 'demo-brand-b': [30, 30, 30, 35, 30, 35], 'demo-brand-c': [10, 10, 15, 10, 15, 15] },
};
/** Share of rated items per condition band, in percent (sums to 100). */
export const BANDS = ['Brand new', 'Like new', 'Good', 'Worn', 'Falling apart'] as const;
const SPECTRUM: Record<string, number[]> = {
  Tops: [8, 24, 38, 22, 8], Bottoms: [6, 20, 40, 26, 8], Outerwear: [10, 28, 36, 20, 6], Footwear: [5, 18, 37, 29, 11], Accessories: [12, 26, 34, 21, 7],
  'Underwear and socks': [14, 22, 30, 25, 9], Activewear: [9, 25, 37, 22, 7], 'Ethnic wear': [11, 27, 37, 19, 6], 'Occasion wear': [20, 32, 31, 14, 3],
};

const round5 = (n: number) => Math.round(n / 5) * 5;
/** A filter keeps a share of the users (0.35 to 0.75 by its value, the same every time); a result under 10 is hidden, as the real screens hide a segment of fewer than 10 users. */
function keep(filter: Filter): (v: number) => number | null {
  if (!filter) return (v) => v;
  const f = 0.35 + ([...filter.value].reduce((a, c) => a + c.charCodeAt(0), 0) % 41) / 100;
  return (v) => { const r = round5(v * f); return r < 10 ? null : r; };
}

export const demoMix = (dim: string, filter: Filter): Seg[] => { const k = keep(filter); return (MIX[dim] ?? []).map(([segment, v]) => ({ segment, value: k(v) })); };
export function demoTrends(dim: string, filter: Filter): { purchase: TrendView; wishlist: TrendView } {
  const k = keep(filter);
  const view = (src: Record<string, Record<string, number[]>>): TrendView => {
    const rows = src[dim] ?? {};
    const cells: TrendView['cells'] = {};
    for (const [segment, values] of Object.entries(rows)) DEMO_PERIODS.forEach((p, i) => { cells[cellKey(segment, p)] = k(values[i]!); });
    return { periods: DEMO_PERIODS, segments: Object.keys(rows).sort(), cells };
  };
  return { purchase: view(PURCHASES), wishlist: view(WISHLIST) };
}
export const demoSpectrum = (category: string): BandShare[] => BANDS.map((band, i) => ({ band, share: (SPECTRUM[category] ?? SPECTRUM.Tops!)[i]! }));

// ---- gaps -----------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface DemoGap { segment: string; wishlist: number; owners: number; score: number; photoId: string | null }
const GAP_SEEDS: { segment: string; category: string; subType?: string; family?: string; wishlist: number; owners: number }[] = [
  { segment: 'Outerwear · Olive', category: 'Outerwear', family: 'Olive', wishlist: 95, owners: 15 },
  { segment: 'Footwear · White sneakers', category: 'Footwear', subType: 'Sneakers', family: 'White', wishlist: 120, owners: 25 },
  { segment: 'Bottoms · Black tailored trousers', category: 'Bottoms', subType: 'Trousers', family: 'Black', wishlist: 80, owners: 20 },
  { segment: 'Tops · Navy knitwear', category: 'Tops', family: 'Navy', wishlist: 70, owners: 20 },
  { segment: 'Accessories · Brown leather belt', category: 'Accessories', subType: 'Belt', family: 'Brown', wishlist: 55, owners: 20 },
  { segment: 'Outerwear · Beige trench', category: 'Outerwear', family: 'Beige', wishlist: 60, owners: 25 },
  { segment: 'Bottoms · Grey relaxed jeans', category: 'Bottoms', family: 'Grey', wishlist: 45, owners: 20 },
  { segment: 'Tops · White oxford shirt', category: 'Tops', subType: 'Shirt', family: 'White', wishlist: 65, owners: 35 },
];
/** Eight segments, highest gap score first (the score is the wishlist count divided by the owner count, to one decimal). */
export const DEMO_GAPS: DemoGap[] = GAP_SEEDS.map((g, i) => ({
  segment: g.segment, wishlist: g.wishlist, owners: g.owners, score: Math.round((g.wishlist / g.owners) * 10) / 10,
  photoId: demoArticle(g.category, i, { subType: g.subType, family: g.family })?.sku ?? null,
})).sort((a, b) => b.score - a.score);
export const demoGapRows = (gaps: readonly DemoGap[] = DEMO_GAPS): (GapRow & { code: string; photo: string | null })[] =>
  gaps.map((g) => ({ code: g.segment, segment: g.segment, owner_users_rounded: g.owners, wishlist_users_rounded: g.wishlist, gap_score: g.score, label: null, photo: g.photoId }));

// ---- reports --------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface DemoReport { id: string; title: string; date: string; status: 'Reviewed' | 'In review'; summary: string; notes: string[]; payload: Payload }
const risingFor = (n: number): Payload['rising_wishlist'] => [
  { segment: 'Outerwear', previous_users_rounded: 45 - n, users_rounded: 75 - n, increase: 30 },
  { segment: 'Footwear', previous_users_rounded: 55 - n, users_rounded: 60 - n, increase: 5 },
  { segment: 'Tops', previous_users_rounded: 55 - n, users_rounded: 60 - n, increase: 5 },
];
const payload = (n: number, gaps: DemoGap[]): Payload => ({
  coverage: DEMO_COVERAGE, cube_first_period: '2026-05-01', cube_last_period: '2026-10-01',
  gaps: demoGapRows(gaps).map(({ code: _c, photo: _p, ...row }) => row), rising_wishlist: risingFor(n),
  condition_spectrum: ['Outerwear', 'Footwear'].map((category) => ({ category, bands: demoSpectrum(category) })),
});
export const DEMO_REPORTS: DemoReport[] = [
  { id: 'demo-2026-10', title: 'October insight pack', date: '2026-11-04', status: 'Reviewed', payload: payload(0, DEMO_GAPS),
    summary: 'Demand for olive and beige outerwear is growing faster than ownership. About 410 pilot users contributed; wishlist interest in outerwear rose by 30 users in a month.',
    notes: ['Counts are rounded to the nearest 5.', 'A segment with fewer than 10 users is never shown.', 'Only consenting pilot participants are included.'] },
  { id: 'demo-2026-09', title: 'September insight pack', date: '2026-10-05', status: 'Reviewed', payload: payload(10, DEMO_GAPS.slice(1, 7)),
    summary: 'White sneakers lead the gap list: many users want a pair, few own one. Condition scores for footwear are the lowest of any category.',
    notes: ['Counts are rounded to the nearest 5.', 'The figures cover May to September 2026.'] },
  { id: 'demo-2026-08', title: 'August insight pack', date: '2026-09-04', status: 'In review', payload: payload(15, DEMO_GAPS.slice(2, 8)),
    summary: 'Draft figures for the month before the autumn range. The pack is shown while the Sparta team completes its check.',
    notes: ['Counts are rounded to the nearest 5.', 'This pack has not been fully reviewed yet.'] },
];

// ---- the vendor's catalogue (12 items) ------------------------------------------------------------------------------------------------------------------------------------

export interface DemoItem { id: string; name: string; category: string; subType: string | null; photoId: string | null }
const CATALOGUE_MIX = ['Tops', 'Bottoms', 'Outerwear', 'Footwear', 'Tops', 'Bottoms', 'Accessories', 'Tops', 'Outerwear', 'Footwear', 'Bottoms', 'Accessories'];
/** Twelve items, each a distinct H&M demo article of its category; with no list the item keeps a placeholder name and no photo. */
export function demoCatalogue(): DemoItem[] {
  const used = new Map<string, number>();
  return CATALOGUE_MIX.map((category, i) => {
    const n = used.get(category) ?? 0;
    used.set(category, n + 1);
    const a = demoArticle(category, n * 3);
    return { id: `demo-item-${i + 1}`, name: a?.name ?? `${category} item ${i + 1}`, category, subType: a?.subType ?? null, photoId: a?.sku ?? null };
  });
}

// ---- admin ----------------------------------------------------------------------------------------------------------------------------------------------------------------

export type ReviewState = 'new' | 'approved' | 'rejected';
export interface DemoReviewItem extends DemoItem { state: ReviewState; submittedBy: string }
const REVIEW_PLAN: [string, ReviewState][] = [['Tops', 'new'], ['Outerwear', 'new'], ['Footwear', 'new'], ['Bottoms', 'new'], ['Accessories', 'new'], ['Occasion wear', 'new'], ['Tops', 'approved'], ['Bottoms', 'approved'], ['Underwear and socks', 'rejected'], ['Footwear', 'rejected']];
/** The review queue: 10 items, 6 new, 2 approved, 2 rejected. */
export function demoReviewQueue(): DemoReviewItem[] {
  const used = new Map<string, number>();
  return REVIEW_PLAN.map(([category, state], i) => {
    const n = used.get(category) ?? 0;
    used.set(category, n + 1);
    const a = demoArticle(category, 1 + n * 4);
    return { id: `demo-review-${i + 1}`, name: a?.name ?? `${category} item ${i + 1}`, category, subType: a?.subType ?? null, photoId: a?.sku ?? null, state, submittedBy: DEMO_VENDOR_NAME };
  });
}
/** The pilot settings: the end date 60 days after `today` (UTC, YYYY-MM-DD), the outcome Continue, 412 participants, 3 vendors, 30 unused invitations. */
export function demoPilot(today: string): { date: string; outcome: 'continue'; consumers: number; invitations: number; vendors: number } {
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 60);
  return { date: end.toISOString().slice(0, 10), outcome: 'continue', consumers: 412, invitations: 30, vendors: 3 };
}
