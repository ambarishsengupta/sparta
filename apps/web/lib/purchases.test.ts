import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventLog } from './events';
import { validatePurchase } from './purchase-form';
import type { PurchaseFormValues } from './purchase-form';
import { NO_PURCHASE_FILTER, afterCursor, isDay, lineTotal, logPurchase, matches, newestFirst, periodRange, totalsByCurrency } from './purchases';
import type { Purchase } from './purchases';

const p = (over: Partial<Purchase> = {}): Purchase => ({ id: 'a', itemId: 'i', date: '2026-11-01', store: 'North Store', price: 10, currency: 'USD', quantity: 1, notes: null, createdAt: 'T', itemName: 'Shirt', category: 'Tops', brand: 'Acme', ...over });

describe('filters, order and keyset', () => {
  it('store and brand are case-insensitive contains; category is exact; the range includes both ends', () => {
    expect(matches(p(), NO_PURCHASE_FILTER)).toBe(true);
    expect(matches(p(), { ...NO_PURCHASE_FILTER, store: 'north' })).toBe(true);
    expect(matches(p(), { ...NO_PURCHASE_FILTER, store: 'south' })).toBe(false);
    expect(matches(p(), { ...NO_PURCHASE_FILTER, brand: 'ACM' })).toBe(true);
    expect(matches(p({ brand: null }), { ...NO_PURCHASE_FILTER, brand: 'a' })).toBe(false);
    expect(matches(p(), { ...NO_PURCHASE_FILTER, category: 'Bottoms' })).toBe(false);
    expect(matches(p(), { ...NO_PURCHASE_FILTER, from: '2026-11-01', to: '2026-11-01' })).toBe(true);
    expect(matches(p(), { ...NO_PURCHASE_FILTER, from: '2026-11-02' })).toBe(false);
    expect(matches(p(), { ...NO_PURCHASE_FILTER, to: '2026-10-31' })).toBe(false);
  });
  it('newest first by date, then id; the cursor keeps only what comes after it', () => {
    const rows = [p({ id: 'a', date: '2026-10-01' }), p({ id: 'c', date: '2026-11-01' }), p({ id: 'b', date: '2026-11-01' })].sort(newestFirst);
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(rows.filter((r) => afterCursor(r, { date: '2026-11-01', id: 'c' })).map((r) => r.id)).toEqual(['b', 'a']);
    expect(rows.filter((r) => afterCursor(r, null))).toHaveLength(3);
  });
  it('isDay accepts real days only', () => {
    expect(['2026-02-28', '2028-02-29'].every(isDay)).toBe(true);
    expect(['2026-02-30', '2026-13-01', '26-1-1', '', '2026-11-01x'].some(isDay)).toBe(false);
  });
});

describe('totals (FR-31)', () => {
  it('adds per currency and never across currencies; unit price times quantity; whole minor units', () => {
    const t = totalsByCurrency([{ price: 0.1, quantity: 1, currency: 'USD' }, { price: 0.2, quantity: 1, currency: 'USD' }, { price: 30, quantity: 2, currency: 'EUR' }, { price: null, quantity: 5, currency: 'EUR' }]);
    expect(t).toEqual([{ currency: 'EUR', total: 60 }, { currency: 'USD', total: 0.3 }]);
    expect(lineTotal({ price: 19.99, quantity: 3 })).toBe(59.97);
    expect(totalsByCurrency([{ price: 19.99, quantity: 3, currency: 'GBP' }])).toEqual([{ currency: 'GBP', total: 59.97 }]); // 19.99 * 100 * 3 in floats is 5996.999...
    expect(totalsByCurrency([])).toEqual([]);
  });
  it('period presets give local-date ranges', () => {
    const today = new Date(2026, 10, 7);
    expect(periodRange('all', today)).toEqual({ from: '', to: '' });
    expect(periodRange('month', today)).toEqual({ from: '2026-11-01', to: '2026-11-07' });
    expect(periodRange('year', today)).toEqual({ from: '2026-01-01', to: '2026-11-07' });
    expect(periodRange('last30', today)).toEqual({ from: '2026-10-09', to: '2026-11-07' });
  });
});

describe('purchase form', () => {
  const ok: PurchaseFormValues = { date: '2026-11-01', store: ' North ', price: '49.90', currency: 'EUR', quantity: '2', notes: '' };
  it('builds the draft: unit price as a number, trimmed store, empty notes as null', () => {
    expect(validatePurchase(ok, '2026-11-07')).toEqual({ ok: true, draft: { date: '2026-11-01', store: 'North', price: 49.9, currency: 'EUR', quantity: 2, notes: null } });
  });
  it.each([
    ['price', { price: 'NaN' }], ['price', { price: '-1' }], ['price', { price: '1e3' }], ['price', { price: '' }], ['price', { price: '1.234' }], ['price', { price: 'Infinity' }],
    ['quantity', { quantity: '0' }], ['quantity', { quantity: '1.5' }], ['quantity', { quantity: '1000' }], ['date', { date: '2026-11-08' }], ['date', { date: 'soon' }],
    ['currency', { currency: 'eur' }], ['store', { store: 'x'.repeat(201) }], ['notes', { notes: 'x'.repeat(1001) }],
  ] as const)('refuses a bad %s', (field, patch) => {
    const r = validatePurchase({ ...ok, ...patch }, '2026-11-07');
    expect(r.ok === false && Object.keys(r.errors)).toEqual([field]);
  });
  it('a price of zero is allowed (a gift)', () => { expect(validatePurchase({ ...ok, price: '0' }, '2026-11-07').ok).toBe(true); });
});

describe('purchase_recorded holds the origin and nothing else (FDD 16)', () => {
  it('the event has no price, store, currency or item id', () => {
    const log = new EventLog(null, () => 'T');
    logPurchase(log, 'wishlist');
    expect(log.list()[0]).toEqual({ type: 'purchase_recorded', at: 'T', occasion: null, season: null, engine_config: expect.any(String), rule_ids: [], slot: null, origin: 'wishlist' });
  });
  it('source: every place that records it passes an origin only', () => {
    const root = new URL('..', import.meta.url).pathname;
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { if (n === 'node_modules' || n === '.next') continue; const f = join(d, n); if (statSync(f).isDirectory()) walk(f); else if (/\.tsx?$/.test(n) && !n.includes('.test.')) files.push(f); } };
    walk(root);
    const hits = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/record\(\s*'purchase_recorded'\s*(,[^)]*)?\)/g)].map((m) => m[0]));
    expect(hits).toEqual(["record('purchase_recorded', { origin })"]);
  });
});
