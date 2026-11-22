import { DEMO_TODAY, PRODUCTS, ageMix, formatWeeks, needsRestock, productSummaries, stockByStore, type AgeGroup, type Product, type Store } from '../../../lib/demo-vendor-retail';
import { formatDate } from './format';

export type AlertKind = 'Stockout soon' | 'Overstock' | 'Demand rise' | 'Slow mover';
export type Severity = 'High' | 'Medium' | 'Low';
export interface VendorAlert {
  id: string; kind: AlertKind; severity: Severity;
  /** The day and the time of day the alert was raised (simulated). */
  time: string;
  product: Product;
  /** The stores it is about; empty means all stores. */
  stores: Store[];
  text: string;
  /** Where "act on it" goes. */
  href: string; action: string;
}

const RANK: Record<Severity, number> = { High: 0, Medium: 1, Low: 2 };
const KIND_RANK: Record<AlertKind, number> = { 'Stockout soon': 0, 'Demand rise': 1, Overstock: 2, 'Slow mover': 3 };

interface Rise { p: Product; age: AgeGroup; ratio: number; units: number }

/**
 * The current alerts of the demo vendor, most severe first: a stockout within the "Restock now" limit (2 weeks by default), overstock beyond the Overstock limit (12 weeks), a sudden demand rise
 * in one age group (weekly units of the last 4 weeks at least 1.6 times the 12-week average), and a slow mover (sell-through under 58%). The limits are the thresholds the vendor set on the alerts page.
 * Simulated demo data: no real users or sales.
 */
export function currentAlerts(): VendorAlert[] {
  const out: Omit<VendorAlert, 'time'>[] = [];

  for (const l of needsRestock()) {
    out.push({
      id: `stockout:${l.product.id}:${l.store.id}`, kind: 'Stockout soon', severity: l.cover < 1 ? 'High' : 'Medium', product: l.product, stores: [l.store],
      text: `Runs out at ${l.store.name} about ${formatDate(l.stockoutDate)}: ${formatWeeks(l.cover)} of cover, ${l.onHand} on hand, ${l.onOrder} on order.`,
      href: `/vendor/restock?product=${encodeURIComponent(l.product.id)}`, action: 'Restock',
    });
  }

  const overstocked = new Set<string>();
  for (const p of PRODUCTS) {
    const over = stockByStore(p).filter((x) => x.status === 'Overstock');
    if (over.length === 0) continue;
    overstocked.add(p.id);
    const worst = Math.max(...over.map((x) => x.cover));
    out.push({
      id: `overstock:${p.id}`, kind: 'Overstock', severity: worst > 16 ? 'Medium' : 'Low', product: p, stores: over.map((x) => x.store),
      text: `Too much stock at ${over.length} ${over.length === 1 ? 'store' : 'stores'}: up to ${formatWeeks(worst)} of cover.`,
      href: `/vendor/transfers?product=${encodeURIComponent(p.id)}`, action: 'Plan a transfer',
    });
  }

  const rises: Rise[] = [];
  for (const p of PRODUCTS) {
    const a4 = ageMix(p, { weeks: 4 });
    const a12 = ageMix(p, { weeks: 12 });
    let best: Rise | null = null;
    a4.forEach((m, i) => {
      const base = (a12[i]?.units ?? 0) / 12;
      const ratio = base > 0 ? m.units / 4 / base : 0;
      if (m.units >= 25 && ratio >= 1.6 && (best === null || ratio > best.ratio)) best = { p, age: m.ageGroup, ratio, units: m.units };
    });
    if (best !== null) rises.push(best);
  }
  for (const r of rises.sort((a, b) => b.ratio - a.ratio).slice(0, 4)) {
    out.push({
      id: `demand:${r.p.id}:${r.age}`, kind: 'Demand rise', severity: 'Medium', product: r.p, stores: [],
      text: `${r.age} demand is up ${Math.round((r.ratio - 1) * 100)}%: ${r.units} units in the last 4 weeks, against the 12-week weekly average.`,
      href: `/vendor/products/${r.p.id}`, action: 'Open product',
    });
  }

  for (const s of productSummaries({ weeks: 12 }).filter((x) => x.sellThrough < 58 && !overstocked.has(x.product.id)).sort((a, b) => a.sellThrough - b.sellThrough).slice(0, 3)) {
    out.push({
      id: `slow:${s.product.id}`, kind: 'Slow mover', severity: 'Low', product: s.product, stores: [],
      text: `Sell-through is ${Math.round(s.sellThrough)}% over 12 weeks, below the 65% target.`,
      href: `/vendor/products/${s.product.id}`, action: 'Open product',
    });
  }

  return out
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || KIND_RANK[a.kind] - KIND_RANK[b.kind])
    .map((a, i) => ({ ...a, time: `${formatDate(DEMO_TODAY)}, ${String(8 + (i % 10)).padStart(2, '0')}:${String((i * 17) % 60).padStart(2, '0')}` }));
}

/** How many alerts are open (the number on the Alerts link). */
export const alertCount = (): number => currentAlerts().length;
