/** The sentence under the Catalogue heading. The browser-only (local) backend lists either the invented demo items or, in the no-login H&M demo, H&M articles; which one is decided once, at build time, by the
 * same flag the picker's list uses (`HM_ARTICLES.length > 0`, lib/demo-catalogue.ts), so the caption is right from the first render and does not depend on a page having loaded. An account-backed catalogue gets none. */
export const INVENTED_CAPTION = 'Demo catalogue: invented items and brands for trying the app. None of it is a real product.';
export const HM_CAPTION = 'Demo catalogue: these are H&M products, shown for the course demo.';

export function catalogueCaption(backend: 'local' | 'supabase', hmDemo: boolean): { kind: 'invented' | 'hm'; text: string } | null {
  if (backend !== 'local') return null;
  return hmDemo ? { kind: 'hm', text: HM_CAPTION } : { kind: 'invented', text: INVENTED_CAPTION };
}
