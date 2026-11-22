import { AGE_GROUPS, CATEGORIES, REGIONS, STORES, type AgeGroup, type Category, type Filters, type Region } from '../../../lib/demo-vendor-retail';

/** The dashboard's global filter lives in the URL query (`weeks`, `region`, `store`, `age`, `category`), so a reload or a shared link keeps it. Anything not valid is ignored. */
export function filtersFromQuery(q: { get(name: string): string | null }): Filters {
  const region = q.get('region');
  const store = q.get('store');
  const age = q.get('age');
  const category = q.get('category');
  return {
    weeks: q.get('weeks') === '4' ? 4 : 12,
    region: (REGIONS as readonly string[]).includes(region ?? '') ? (region as Region) : undefined,
    store: STORES.some((s) => s.id === store) ? (store as string) : undefined,
    ageGroup: (AGE_GROUPS as readonly string[]).includes(age ?? '') ? (age as AgeGroup) : undefined,
    category: (CATEGORIES as readonly string[]).includes(category ?? '') ? (category as Category) : undefined,
  };
}

/** The query string for a set of filters; the defaults (12 weeks, nothing picked) are left out. */
export function queryFromFilters(f: Filters): string {
  const p = new URLSearchParams();
  if (f.weeks === 4) p.set('weeks', '4');
  if (f.region) p.set('region', f.region);
  if (f.store) p.set('store', f.store);
  if (f.ageGroup) p.set('age', f.ageGroup);
  if (f.category) p.set('category', f.category);
  return p.toString();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-12-03" as "3 Dec". */
export function shortDate(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`;
}
