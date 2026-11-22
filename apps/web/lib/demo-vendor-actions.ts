import type { Thresholds } from './demo-vendor-retail';

/**
 * LOCAL STATE for the vendor actions of the no-login demo (vendor plan, section 5): the alert thresholds, the demo orders and the approved stock transfers. Everything is kept in this browser's
 * localStorage; nothing is sent anywhere. Simulated demo data: no real users or sales.
 *
 * This file takes only TYPES from `demo-vendor-retail.ts`, because that file reads the live thresholds from here (so a change to a threshold changes every status on every screen). Anything
 * that needs the retail data (the alert feed, the transfer suggestions) lives in `components/vendor/actions/`.
 */

export const ORDERS_KEY = 'sparta.demo.vendor.orders.v1';
export const THRESHOLDS_KEY = 'sparta.demo.vendor.thresholds.v1';
export const TRANSFERS_KEY = 'sparta.demo.vendor.transfers.v1';

/** The factory thresholds (2, 4 and 12 weeks): the plan's rule for "Restock now", "Watch" and "Overstock". */
export const FACTORY_THRESHOLDS: Readonly<Thresholds> = { restockCover: 2, watchCover: 4, overstockCover: 12 };

// ---- a small localStorage-backed store -------------------------------------------------------------------------------------------------------------------------------------

export interface Store<T> { get(): T; set(next: T): void; server: T; subscribe(cb: () => void): () => void }

/** One JSON value under one key. Reads are cached by the raw string (so React gets a stable snapshot), a bad or missing value is `empty`, and when the browser refuses the write the value is kept in memory. */
function makeStore<T>(key: string, empty: T, parse: (raw: unknown) => T): Store<T> {
  let raw: string | null | undefined;
  let value: T = empty;
  let memoryOnly = false;
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((f) => f());
  const get = (): T => {
    if (typeof window === 'undefined' || memoryOnly) return value;
    let now: string | null = null;
    try { now = window.localStorage.getItem(key); } catch { return value; }
    if (now !== raw) {
      raw = now;
      try { value = now === null ? empty : parse(JSON.parse(now)); } catch { value = empty; }
    }
    return value;
  };
  const set = (next: T) => {
    value = next;
    if (typeof window !== 'undefined') {
      try { const text = JSON.stringify(next); window.localStorage.setItem(key, text); raw = text; memoryOnly = false; } catch { memoryOnly = true; }
    }
    notify();
  };
  const subscribe = (cb: () => void) => {
    subs.add(cb);
    const onStorage = (e: StorageEvent) => { if (e.key === key || e.key === null) cb(); };
    if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
    return () => { subs.delete(cb); if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage); };
  };
  return { get, set, server: empty, subscribe };
}

// ---- thresholds ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The limits the settings form accepts: Restock now from 0.5 to the Watch limit, Overstock from the Watch limit to 52 weeks. */
export const THRESHOLD_LIMITS = { restockMin: 0.5, overstockMax: 52 } as const;

/** Checks a pair of thresholds against the Watch limit (which the form does not change); returns the reason it is refused, or null. */
export function thresholdProblem(restockCover: number, overstockCover: number, watchCover: number = FACTORY_THRESHOLDS.watchCover): string | null {
  if (!Number.isFinite(restockCover) || !Number.isFinite(overstockCover)) return 'Enter a number of weeks in both boxes.';
  if (restockCover < THRESHOLD_LIMITS.restockMin) return `Restock now must be at least ${THRESHOLD_LIMITS.restockMin} weeks.`;
  if (restockCover > watchCover) return `Restock now cannot be above the Watch limit of ${watchCover} weeks.`;
  if (overstockCover <= watchCover) return `Overstock must be above the Watch limit of ${watchCover} weeks.`;
  if (overstockCover > THRESHOLD_LIMITS.overstockMax) return `Overstock cannot be above ${THRESHOLD_LIMITS.overstockMax} weeks.`;
  return null;
}

const parseThresholds = (raw: unknown): { restockCover: number; overstockCover: number } => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const r = num(o['restockCover']); const v = num(o['overstockCover']);
  return r !== null && v !== null && thresholdProblem(r, v) === null ? { restockCover: r, overstockCover: v } : { restockCover: FACTORY_THRESHOLDS.restockCover, overstockCover: FACTORY_THRESHOLDS.overstockCover };
};
const thresholdStore = makeStore(THRESHOLDS_KEY, { restockCover: FACTORY_THRESHOLDS.restockCover, overstockCover: FACTORY_THRESHOLDS.overstockCover }, parseThresholds);

/** The one live Thresholds object. `demo-vendor-retail.ts` uses it as `DEFAULT_THRESHOLDS`, so every function that takes the default sees the saved values. It is updated in place. */
const LIVE: Thresholds = { ...FACTORY_THRESHOLDS };
function applyLive(): void { const s = thresholdStore.get(); LIVE.restockCover = s.restockCover; LIVE.overstockCover = s.overstockCover; }
/** The live thresholds object (the same object every time). In a browser it already holds the saved values when the first screen renders. */
export const liveThresholds = (): Thresholds => LIVE;
if (typeof window !== 'undefined') applyLive();

/** A copy of the thresholds now in force. */
export const getThresholds = (): Thresholds => ({ ...LIVE });
/** Saves new limits for "Restock now" and "Overstock" (the Watch limit stays at 4 weeks). Returns the reason it was refused, or null when it was saved. */
export function setThresholds(restockCover: number, overstockCover: number): string | null {
  const problem = thresholdProblem(restockCover, overstockCover);
  if (problem) return problem;
  thresholdStore.set({ restockCover, overstockCover });
  applyLive();
  bump();
  return null;
}
/** Back to 2 and 12 weeks. */
export function resetThresholds(): void { thresholdStore.set({ restockCover: FACTORY_THRESHOLDS.restockCover, overstockCover: FACTORY_THRESHOLDS.overstockCover }); applyLive(); bump(); }

let version = 0;
const versionSubs = new Set<() => void>();
const bump = () => { version += 1; versionSubs.forEach((f) => f()); };
const subscribeVersion = (cb: () => void) => {
  versionSubs.add(cb);
  const off = thresholdStore.subscribe(() => { applyLive(); bump(); });   // a change made in another tab
  return () => { versionSubs.delete(cb); off(); };
};
/** A store whose value is a number that changes whenever the thresholds change (this tab or another); `components/vendor/actions/hooks.ts` turns it into a React hook. */
export const thresholdVersion: Store<number> = { get: () => version, set: () => undefined, server: 0, subscribe: subscribeVersion };

// ---- orders -------------------------------------------------------------------------------------------------------------------------------------------------------------------

export const ORDER_STATUSES = ['Draft', 'Placed', 'In transit', 'Received'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export interface OrderLine { productId: string; storeId: string; units: number; unitCost: number }
export interface DemoOrder { number: string; date: string; status: OrderStatus; lines: OrderLine[] }

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
function parseOrders(raw: unknown): DemoOrder[] {
  if (!Array.isArray(raw)) return [];
  const out: DemoOrder[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const number = str(r?.['number']); const date = str(r?.['date']); const status = ORDER_STATUSES.find((s) => s === r?.['status']);
    if (!number || !date || !status || !Array.isArray(r['lines'])) continue;
    const lines: OrderLine[] = [];
    for (const l of r['lines'] as Record<string, unknown>[]) {
      const productId = str(l?.['productId']); const storeId = str(l?.['storeId']); const units = num(l?.['units']); const unitCost = num(l?.['unitCost']);
      if (productId && storeId && units !== null && units > 0 && unitCost !== null) lines.push({ productId, storeId, units, unitCost });
    }
    if (lines.length > 0) out.push({ number, date, status, lines });
  }
  return out;
}
const orderStore = makeStore<DemoOrder[]>(ORDERS_KEY, [], parseOrders);

/** The store of the demo orders, oldest first (`useOrders` in `components/vendor/actions/hooks.ts`). */
export const ordersStore: Store<DemoOrder[]> = orderStore;
export const getOrders = (): DemoOrder[] => orderStore.get();
export const orderUnits = (o: DemoOrder): number => o.lines.reduce((n, l) => n + l.units, 0);
export const orderCost = (o: DemoOrder): number => o.lines.reduce((n, l) => n + l.units * l.unitCost, 0);

/** Adds a Draft order with the next number (NL-0001, NL-0002, ...) and returns it. Nothing is sent. */
export function createOrder(lines: OrderLine[], date: string): DemoOrder {
  const orders = orderStore.get();
  const last = orders.reduce((m, o) => Math.max(m, Number(/^NL-(\d+)$/.exec(o.number)?.[1] ?? 0)), 0);
  const order: DemoOrder = { number: `NL-${String(last + 1).padStart(4, '0')}`, date, status: 'Draft', lines: lines.filter((l) => l.units > 0) };
  orderStore.set([...orders, order]);
  return order;
}
/** Moves an order one step: Draft, Placed, In transit, Received. A received order stays received. */
export function advanceOrder(number: string): void {
  orderStore.set(orderStore.get().map((o) => {
    if (o.number !== number) return o;
    const next = ORDER_STATUSES[Math.min(ORDER_STATUSES.indexOf(o.status) + 1, ORDER_STATUSES.length - 1)] as OrderStatus;
    return { ...o, status: next };
  }));
}

// ---- approved transfers -------------------------------------------------------------------------------------------------------------------------------------------------------

const transferStore = makeStore<string[]>(TRANSFERS_KEY, [], (raw) => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []));
/** The store of the ids of the approved stock transfers (`useApprovedTransfers` in `components/vendor/actions/hooks.ts`). */
export const approvedTransfersStore: Store<string[]> = transferStore;
/** Marks a transfer as approved (local only; nothing is moved). */
export function approveTransfer(id: string): void { const now = transferStore.get(); if (!now.includes(id)) transferStore.set([...now, id]); }
