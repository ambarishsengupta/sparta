import type { createBrowserSupabase } from '../supabase/browser';

/** WO-0155: the brand labels of `catalog.lk_brand` (code to label, "demo-h-and-m" to "H&M"), read once per page with the vendor's own session (the table is readable by `authenticated`).
 * The vendor functions still return a brand as its code and the data stays keyed by code; the map only changes what is shown. A failed read is not an error for the vendor: the map is then
 * empty and the screen keeps the label guessed from the code (components/vendor/brand-label.ts). Nothing is kept between calls. */
type Client = Pick<ReturnType<typeof createBrowserSupabase>, 'schema'>;
export type BrandLabels = ReadonlyMap<string, string>;
export const NO_BRAND_LABELS: BrandLabels = new Map();

export async function loadBrandLabels(client: Client): Promise<BrandLabels> {
  try {
    const { data, error } = await client.schema('catalog').from('lk_brand').select('code, label');
    if (error || !Array.isArray(data)) return NO_BRAND_LABELS;
    return new Map(data.filter((r) => typeof r.code === 'string' && typeof r.label === 'string' && r.label !== '').map((r) => [r.code, r.label]));
  } catch { return NO_BRAND_LABELS; }
}
