import type { Category } from '@sparta/taxonomy';
import type { EventLog } from './events';

export const PAGE = 40;
export type PurchaseOrigin = 'manual' | 'wishlist' | 'catalogue' | 'receipt';

/** What the person enters. `price` is the UNIT price and spend is price x quantity (WO-0080 decision); the item is not part of the draft. */
export interface PurchaseDraft { date: string; store: string | null; price: number; currency: string; quantity: number; notes: string | null }
export type PurchaseInput = PurchaseDraft & { itemId: string };
/** A purchase as the screens read it: the row plus the few attributes of its item that the filters use. */
export interface Purchase extends PurchaseInput { id: string; createdAt: string; itemName: string; category: Category | null; brand: string | null; /** The item's H&M photograph, when it has one. */ photoId?: string | null }
export interface PurchaseFilter { store: string; brand: string; category: string; from: string; to: string }
export const NO_PURCHASE_FILTER: PurchaseFilter = { store: '', brand: '', category: '', from: '', to: '' };
/** Newest first by date, then id: the keyset the next page continues after. */
export interface Cursor { date: string; id: string }
export interface Page { rows: Purchase[]; next: Cursor | null }
export interface CurrencyTotal { currency: string; total: number }

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (s: string): boolean => DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const lower = (s: string | null) => (s ?? '').toLowerCase();

/** The money of one purchase: unit price x quantity, in whole minor units. */
export const lineTotal = (p: Pick<Purchase, 'price' | 'quantity'>): number => (Math.round(p.price * 100) * p.quantity) / 100;

export function matches(p: Purchase, f: PurchaseFilter): boolean {
  return (!f.store || lower(p.store).includes(f.store.toLowerCase())) && (!f.brand || lower(p.brand).includes(f.brand.toLowerCase())) && (!f.category || p.category === f.category)
    && (!f.from || p.date >= f.from) && (!f.to || p.date <= f.to);
}
/** Newest first; the id breaks ties so two purchases on one day keep one order across pages. */
export const newestFirst = (a: Pick<Purchase, 'date' | 'id'>, b: Pick<Purchase, 'date' | 'id'>): number => (a.date === b.date ? (a.id === b.id ? 0 : a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1);
export const afterCursor = (p: Pick<Purchase, 'date' | 'id'>, c: Cursor | null): boolean => !c || newestFirst({ date: c.date, id: c.id }, p) < 0;

/** Spend per currency, never summed across currencies; whole minor units are added so 0.1 + 0.2 stays 0.30. A purchase without a price adds nothing. */
export function totalsByCurrency(rows: readonly { price: number | null; quantity: number; currency: string | null }[]): CurrencyTotal[] {
  const cents = new Map<string, number>();
  for (const r of rows) if (r.price !== null && r.currency) cents.set(r.currency, (cents.get(r.currency) ?? 0) + Math.round(r.price * 100) * r.quantity);
  return [...cents].map(([currency, c]) => ({ currency, total: c / 100 })).sort((a, b) => (a.currency < b.currency ? -1 : 1));
}

export type Period = 'all' | 'month' | 'last30' | 'year';
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The date range of a period preset, from the person's local date. */
export function periodRange(p: Period, today: Date): { from: string; to: string } {
  if (p === 'all') return { from: '', to: '' };
  const to = ymd(today);
  if (p === 'month') return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to };
  if (p === 'year') return { from: `${today.getFullYear()}-01-01`, to };
  return { from: ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)), to };
}

/** `purchase_recorded` carries the origin and nothing else: no price, store, currency or item id (FDD 16). */
export const logPurchase = (log: EventLog, origin: PurchaseOrigin): void => void log.record('purchase_recorded', { origin });
