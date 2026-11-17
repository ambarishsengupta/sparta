import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LocalRepository } from './local-repository';
import type { StorageLike } from './local-repository';
import type { WishlistEntry } from './repository';
import { SupabaseRepository } from './supabase/repository';
import { WISHLIST_SELECT, wishlistFromRow, wishlistPatch, wishlistRow } from './supabase/mapping';
import { NO_PLAN, emptyPlan, formFromEntry, groupByMonth, isMonth, monthLabel, monthOf, validatePlan } from './wishlist-plan';

const mem = (): StorageLike => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };
const entry = (over: Partial<WishlistEntry> = {}): WishlistEntry => ({ id: `w${Math.random()}`, name: 'Coat', subType: 'Coat', note: null, createdAt: 'T', ...over });
const NOW = '2026-11';
const form = (over: Partial<{ month: string; budget: string; currency: string }> = {}) => ({ ...emptyPlan('EUR'), ...over });

describe('validatePlan (FR-36): planned month and budget', () => {
  it('an empty form is no plan', () => { expect(validatePlan(form(), NOW)).toEqual({ ok: true, draft: NO_PLAN }); });
  it('a month alone is a plan without a budget (and without a currency)', () => {
    expect(validatePlan(form({ month: '2026-12' }), NOW)).toEqual({ ok: true, draft: { plannedMonth: '2026-12', budget: null, currency: null } });
  });
  it('a month with a budget keeps the currency; this month is allowed; 0 is a budget', () => {
    expect(validatePlan(form({ month: '2026-11', budget: '120', currency: 'GBP' }), NOW)).toEqual({ ok: true, draft: { plannedMonth: '2026-11', budget: 120, currency: 'GBP' } });
    expect(validatePlan(form({ month: '2027-01', budget: '0' }), NOW)).toMatchObject({ ok: true, draft: { budget: 0 } });
    expect(validatePlan(form({ month: '2027-01', budget: ' 49.90 ' }), NOW)).toMatchObject({ ok: true, draft: { budget: 49.9 } });
  });
  it('a month in the past is refused for a new plan but stays valid for the month the entry already has', () => {
    expect(validatePlan(form({ month: '2026-10' }), NOW)).toMatchObject({ ok: false, errors: { month: expect.stringContaining('this month or a later') } });
    expect(validatePlan(form({ month: '2026-10', budget: '5' }), NOW, '2026-10')).toMatchObject({ ok: true });
    expect(validatePlan(form({ month: '2026-09' }), NOW, '2026-10')).toMatchObject({ ok: false });
  });
  it('a month that is not YYYY-MM, or more than ten years away, is refused', () => {
    for (const month of ['2026-13', '2026-00', '2026-1', '26-12', '2026-12-01', 'December', '2037-01']) expect(validatePlan(form({ month }), NOW), month).toMatchObject({ ok: false, errors: { month: expect.any(String) } });
    expect(validatePlan(form({ month: '2036-12' }), NOW)).toMatchObject({ ok: true });
  });
  it('a budget with no month is refused', () => { expect(validatePlan(form({ budget: '10' }), NOW)).toMatchObject({ ok: false, errors: { month: expect.any(String) } }); });
  it('a budget must be a plain non-negative amount: no NaN, Infinity, sign, exponent, thousands separator or more than two decimals', () => {
    for (const budget of ['NaN', 'Infinity', '-1', '+5', '1e3', '1,000', '12.345', 'abc', '12345678901', '.5']) expect(validatePlan(form({ month: '2026-12', budget }), NOW), budget).toMatchObject({ ok: false, errors: { budget: expect.any(String) } });
  });
  it('a budget needs a currency of three capital letters', () => { expect(validatePlan(form({ month: '2026-12', budget: '1', currency: 'eur' }), NOW)).toMatchObject({ ok: false, errors: { currency: expect.any(String) } }); });
  it('monthOf, isMonth and the form helpers', () => {
    expect(monthOf(new Date(2026, 0, 31))).toBe('2026-01');
    expect([isMonth('2026-12'), isMonth('2026-13'), isMonth('2026-12-01')]).toEqual([true, false, false]);
    expect(formFromEntry(entry({ plannedMonth: '2026-12', budget: 49.9, currency: 'GBP' }), 'EUR')).toEqual({ month: '2026-12', budget: '49.90', currency: 'GBP' });
    expect(formFromEntry(entry(), 'EUR')).toEqual({ month: '', budget: '', currency: 'EUR' });
    expect(formFromEntry(entry({ plannedMonth: '2026-12', budget: 0, currency: 'GBP' }), 'EUR').budget).toBe('0.00');
  });
});

describe('groupByMonth: a total per month per currency, never summed across currencies', () => {
  const list = [
    entry({ id: 'a', plannedMonth: '2026-12', budget: 100, currency: 'EUR' }),
    entry({ id: 'b', plannedMonth: '2026-12', budget: 50.5, currency: 'EUR' }),
    entry({ id: 'c', plannedMonth: '2026-12', budget: 80, currency: 'USD' }),
    entry({ id: 'd', plannedMonth: '2026-11', budget: 19.99, currency: 'GBP' }),
    entry({ id: 'e', plannedMonth: '2026-11' }),
    entry({ id: 'f' }),
    entry({ id: 'g', plannedMonth: null, budget: null }),
  ];
  const g = groupByMonth(list);
  it('months run earliest first and each keeps its entries in the order given', () => {
    expect(g.months.map((m) => [m.month, m.entries.map((e) => e.id)])).toEqual([['2026-11', ['d', 'e']], ['2026-12', ['a', 'b', 'c']]]);
  });
  it('totals are per currency within the month, sorted by currency', () => {
    expect(g.months[1]!.totals).toEqual([{ currency: 'EUR', total: 150.5 }, { currency: 'USD', total: 80 }]);
    expect(g.months[0]!.totals).toEqual([{ currency: 'GBP', total: 19.99 }]);
  });
  it('entries with no plan are kept apart; an entry planned with no budget adds nothing', () => {
    expect(g.unplanned.map((e) => e.id)).toEqual(['f', 'g']);
    expect(groupByMonth([entry({ plannedMonth: '2027-01' })]).months[0]!.totals).toEqual([]);
  });
  it('adds in whole minor units (0.1 + 0.2 is 0.30), and no total ever mixes two currencies', () => {
    expect(groupByMonth([entry({ plannedMonth: '2027-01', budget: 0.1, currency: 'EUR' }), entry({ plannedMonth: '2027-01', budget: 0.2, currency: 'EUR' })]).months[0]!.totals).toEqual([{ currency: 'EUR', total: 0.3 }]);
    fc.assert(fc.property(fc.array(fc.record({ cents: fc.integer({ min: 0, max: 10_000_000 }), cur: fc.constantFrom('EUR', 'USD', 'INR'), month: fc.constantFrom('2026-11', '2026-12') })), (rows) => {
      const out = groupByMonth(rows.map((r) => entry({ plannedMonth: r.month, budget: r.cents / 100, currency: r.cur })));
      for (const m of out.months) for (const t of m.totals) {
        const want = rows.filter((r) => r.month === m.month && r.cur === t.currency).reduce((a, r) => a + r.cents, 0);
        expect(Math.round(t.total * 100)).toBe(want);
      }
      expect(out.months.flatMap((m) => m.entries).length).toBe(rows.length);
    }));
  });
  it('monthLabel names the month in English and returns anything else as is', () => {
    expect([monthLabel('2026-11'), monthLabel('2027-01'), monthLabel('soon')]).toEqual(['November 2026', 'January 2027', 'soon']);
  });
});

describe('the plan in both repositories', () => {
  it('local: planned month, budget and currency are saved, survive a reload, and can be cleared; entries without a plan still read', async () => {
    const storage = mem();
    const repo = new LocalRepository(storage);
    const w = await repo.wishlist.create({ name: 'Boots', subType: 'Boots', note: null });
    expect((await repo.wishlist.get(w.id))!.plannedMonth).toBeUndefined();
    await repo.wishlist.update(w.id, { plannedMonth: '2026-12', budget: 149.5, currency: 'EUR' });
    expect(await new LocalRepository(storage).wishlist.get(w.id)).toMatchObject({ plannedMonth: '2026-12', budget: 149.5, currency: 'EUR', name: 'Boots' });
    await repo.wishlist.update(w.id, { plannedMonth: null, budget: null, currency: null });
    expect(groupByMonth(await repo.wishlist.list())).toMatchObject({ months: [], unplanned: [{ id: w.id }] });
  });
  it('local: marking a planned entry bought removes it and its plan from the lists', async () => {
    const repo = new LocalRepository(mem());
    const w = await repo.wishlist.create({ name: 'Navy Chinos', subType: 'Chinos', colourFamily: 'Navy', note: null });
    await repo.wishlist.update(w.id, { plannedMonth: '2026-12', budget: 80, currency: 'USD' });
    await repo.wishlist.bought(w.id, { purchase: { date: '2026-11-01', store: null, price: 70, currency: 'USD', quantity: 1, notes: null } });
    expect(groupByMonth(await repo.wishlist.list())).toEqual({ months: [], unplanned: [] });
  });
  it('rows: the plan columns are read as a month, a number and a currency; a malformed one is refused, nothing set reads as no plan', () => {
    const row = { id: 'w', name: 'Coat', category: 'Outerwear', sub_type: 'Coat', colour_family: null, notes: null, origin: 'user', created_at: 'T' };
    expect(wishlistFromRow(row)).not.toHaveProperty('plannedMonth');
    expect(wishlistFromRow({ ...row, planned_month: '2026-12-01', budget: '120.50', currency: 'EUR' })).toMatchObject({ plannedMonth: '2026-12', budget: 120.5, currency: 'EUR' });
    expect(wishlistFromRow({ ...row, planned_month: '2026-12-01', budget: 0, currency: 'EUR' })).toMatchObject({ budget: 0 });
    expect(wishlistFromRow({ ...row, planned_month: null, budget: null, currency: null })).not.toHaveProperty('budget');
    for (const bad of [{ planned_month: '2026-12-15' }, { planned_month: '2026-13-01' }, { planned_month: 5 }, { budget: -1 }, { budget: 'abc' }, { budget: '' }, { budget: Infinity }, { currency: 'eur' }, { currency: 'EURO' }]) expect(() => wishlistFromRow({ ...row, ...bad }), JSON.stringify(bad)).toThrow();
    expect(WISHLIST_SELECT).toContain('planned_month,budget,currency');
  });
  it('patches: the month becomes the first day of the month; nothing malformed or negative ever reaches a request; a clear sends nulls', () => {
    expect(wishlistPatch({ plannedMonth: '2026-12', budget: 120.5, currency: 'EUR' })).toEqual({ planned_month: '2026-12-01', budget: 120.5, currency: 'EUR' });
    expect(wishlistPatch({ plannedMonth: null, budget: null, currency: null })).toEqual({ planned_month: null, budget: null, currency: null });
    expect(wishlistPatch({ name: 'x' })).toEqual({ name: 'x' });
    expect(wishlistRow({ name: 'x', subType: 'Coat', note: null, plannedMonth: '2026-12' }, 'u1')).toMatchObject({ planned_month: '2026-12-01', user_id: 'u1' });
    for (const p of [{ plannedMonth: '2026-12-01' }, { plannedMonth: '2026-13' }, { budget: -0.01 }, { budget: Number.NaN }, { budget: Infinity }, { currency: 'eur' }]) expect(() => wishlistPatch(p), JSON.stringify(p)).toThrow();
  });
  it('supabase: saving a plan updates the entry through its own row only and asks for the plan columns back', async () => {
    const calls: [string, unknown[]][] = [];
    const proxy = (): unknown => new Proxy({}, { get: (_t, prop) => (prop === 'then'
      ? (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res)
      : (...args: unknown[]) => { calls.push([String(prop), args]); return proxy(); }) });
    const client = { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) }, schema: () => ({ from: () => proxy() }) } as unknown as SupabaseClient;
    const repo = new SupabaseRepository(client);
    const id = '5c1b3b52-0000-4000-8000-000000000001';
    await repo.wishlist.update(id, { plannedMonth: '2027-02', budget: 75, currency: 'GBP' });
    expect(calls.find((c) => c[0] === 'update')![1][0]).toEqual({ planned_month: '2027-02-01', budget: 75, currency: 'GBP' });
    expect(calls.find((c) => c[0] === 'eq')![1]).toEqual(['id', id]);
    expect(calls.find((c) => c[0] === 'select')![1][0]).toBe(WISHLIST_SELECT);
    await expect(repo.wishlist.update(id, { budget: -5 })).rejects.toMatchObject({ kind: 'rejected' });
  });
});

describe('a plan is not an event (FDD 16 has no such event)', () => {
  it('no source file records or names a plan event, and the event list is unchanged', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    for (const f of ['./wishlist-plan.ts', '../components/purchases/PlanForm.tsx', '../components/purchases/PlanGroups.tsx', '../components/purchases/WishlistView.tsx', './events.ts']) expect(src(f), f).not.toMatch(/plan_updated|planned_recorded|plan_/);
    expect(src('../components/purchases/PlanForm.tsx') + src('../components/purchases/PlanGroups.tsx')).not.toMatch(/EventLog|\.record\(/);
    expect(src('../components/purchases/WishlistView.tsx').match(/\.record\(|logPurchase\(|new EventLog/g)).toEqual(['logPurchase(', 'new EventLog']); // only the purchase event of Mark as bought
  });
});
