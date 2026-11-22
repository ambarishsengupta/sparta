import { PACK_SIZE, PRODUCTS, TARGET_COVER_WEEKS, forecast, stockByStore, type Product, type Store } from '../../../lib/demo-vendor-retail';
import { getThresholds } from '../../../lib/demo-vendor-actions';

export interface TransferSuggestion {
  id: string; product: Product; from: Store; to: Store; units: number;
  /** Weeks of cover at each end, before and after the move. */
  fromBefore: number; fromAfter: number; toBefore: number; toAfter: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const weeklyOf = (product: Product, store: Store): number => { const a = forecast(product, store).actual.slice(-4); return a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1); };

/**
 * Moves of the same product from an overstocked store to a short one (cover under the Watch limit). The sender keeps 6 weeks of cover; the receiver gets what it needs to reach 6 weeks (on hand plus
 * on order), in packs of 6. A sender is used for several receivers until its surplus is gone. Simulated demo data: no real users or sales.
 */
export function transferSuggestions(): TransferSuggestion[] {
  const th = getThresholds();
  const out: TransferSuggestion[] = [];
  for (const product of PRODUCTS) {
    const rows = stockByStore(product);
    const donors = rows.filter((r) => r.status === 'Overstock').map((r) => ({ ...r, weekly: weeklyOf(product, r.store), left: r.onHand }));
    if (donors.length === 0) continue;
    const receivers = rows.filter((r) => r.cover < th.watchCover).sort((a, b) => a.cover - b.cover);
    for (const r of receivers) {
      const weekly = weeklyOf(product, r.store);
      if (weekly <= 0) continue;
      const need = Math.max(0, TARGET_COVER_WEEKS * weekly - (r.onHand + r.onOrder));
      let best: (typeof donors)[number] | null = null; let bestSurplus = 0;
      for (const d of donors) {
        if (d.weekly <= 0 || d.store.id === r.store.id) continue;
        const surplus = d.left - TARGET_COVER_WEEKS * d.weekly;
        if (surplus > bestSurplus) { best = d; bestSurplus = surplus; }
      }
      if (!best) continue;
      const units = Math.floor(Math.min(bestSurplus, need) / PACK_SIZE) * PACK_SIZE;
      if (units < PACK_SIZE) continue;
      out.push({
        id: `${product.id}:${best.store.id}:${r.store.id}`, product, from: best.store, to: r.store, units,
        fromBefore: round1(best.left / best.weekly), fromAfter: round1((best.left - units) / best.weekly), toBefore: round1(r.onHand / weekly), toAfter: round1((r.onHand + units) / weekly),
      });
      best.left -= units;
    }
  }
  return out.sort((a, b) => a.toBefore - b.toBefore || a.product.name.localeCompare(b.product.name));
}
