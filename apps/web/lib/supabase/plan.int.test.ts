import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, discover, lockStack, makeReady, provisionUser, sql } from '../../test-support/stack';
import { groupByMonth } from '../wishlist-plan';
import { SupabaseRepository } from './repository';

// Integration suite against the REAL local stack (WO-0082, Release 0): the plan of a wishlist entry through the person's own session, and
// row-level security between two people. Skips, with a message, when the stack is not running.
const stack = discover();
if (!stack) console.warn('SKIPPED plan.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');
vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });
const rejects = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as { kind: string }; } throw new Error('did not reject'); };

describe.skipIf(!stack)('plan purchases against the real stack', () => {
  const run = randomUUID().slice(0, 8);
  const email = { ann: `it-${run}-lann@example.test`, bob: `it-${run}-lbob@example.test` };
  const pw = randomBytes(12).toString('base64url');
  const mailIds: string[] = [];
  let A: SupabaseRepository; let B: SupabaseRepository;
  let unlock: (() => void) | undefined;
  const ids: string[] = [];
  beforeAll(async () => {
    unlock = await lockStack();
    const [ann, bob] = [await provisionUser(stack!, email.ann, pw, mailIds), await provisionUser(stack!, email.bob, pw, mailIds)] as SupabaseClient[];
    await makeReady(ann!, 'IN');
    await makeReady(bob!, 'IN');
    [A, B] = [new SupabaseRepository(ann!), new SupabaseRepository(bob!)];
  });
  afterAll(async () => { try { await cleanup(stack!, Object.values(email), mailIds); } finally { unlock?.(); } });

  it('saves the month, budget and currency on an entry and reads them back; clearing the plan gives an entry with none', async () => {
    const w = await A.wishlist.create({ name: 'Wool coat', subType: 'Coat', note: null });
    ids.push(w.id);
    expect(w).not.toHaveProperty('plannedMonth');
    const planned = await A.wishlist.update(w.id, { plannedMonth: '2026-12', budget: 149.5, currency: 'EUR' });
    expect(planned).toMatchObject({ plannedMonth: '2026-12', budget: 149.5, currency: 'EUR', name: 'Wool coat' });
    expect(sql(`select planned_month::text, budget::text, currency from app.wishlist_entries where id = :'id'`, { id: w.id })).toBe('2026-12-01|149.50|EUR');
    expect(await A.wishlist.get(w.id)).toMatchObject({ plannedMonth: '2026-12', budget: 149.5 });
    const cleared = await A.wishlist.update(w.id, { plannedMonth: null, budget: null, currency: null });
    expect(cleared).not.toHaveProperty('plannedMonth');
    expect(sql(`select count(*) from app.wishlist_entries where id = :'id' and planned_month is null and budget is null and currency is null`, { id: w.id })).toBe('1');
  });
  it('a malformed plan never reaches the database and the entry is unchanged', async () => {
    const [id] = ids as [string];
    await A.wishlist.update(id, { plannedMonth: '2027-03', budget: 10, currency: 'USD' });
    for (const patch of [{ plannedMonth: '2027-13' }, { plannedMonth: '2027-03-15' }, { budget: -1 }, { budget: Number.NaN }, { currency: 'usd' }]) expect((await rejects(A.wishlist.update(id, patch))).kind, JSON.stringify(patch)).toBe('rejected');
    expect(await A.wishlist.get(id)).toMatchObject({ plannedMonth: '2027-03', budget: 10, currency: 'USD' });
  });
  it('the totals per month per currency come out right through the database, never summed across currencies', async () => {
    const mk = async (name: string, plannedMonth: string, budget: number, currency: string) => { const w = await A.wishlist.create({ name, subType: 'Shirt', note: null }); ids.push(w.id); await A.wishlist.update(w.id, { plannedMonth, budget, currency }); return w; };
    await mk('Shirt one', '2027-03', 19.99, 'EUR');
    await mk('Shirt two', '2027-03', 0.01, 'EUR');
    await mk('Shirt three', '2027-03', 80, 'USD');
    await mk('Shirt four', '2027-05', 1200, 'INR');
    const loose = await A.wishlist.create({ name: 'Loose', subType: 'Scarf', note: null });
    const g = groupByMonth(await A.wishlist.list());
    expect(g.months.map((m) => m.month)).toEqual(['2027-03', '2027-05']);
    expect(g.months[0]!.totals).toEqual([{ currency: 'EUR', total: 20 }, { currency: 'USD', total: 90 }]);
    expect(g.months[1]!.totals).toEqual([{ currency: 'INR', total: 1200 }]);
    expect(g.unplanned.map((e) => e.id)).toContain(loose.id);
  });
  it('another person never sees or changes the plans, and sees none of the entries', async () => {
    const [id] = ids as [string];
    expect(await B.wishlist.list()).toEqual([]);
    expect(await B.wishlist.get(id)).toBeUndefined();
    expect(groupByMonth(await B.wishlist.list())).toEqual({ months: [], unplanned: [] });
    expect(await B.wishlist.update(id, { plannedMonth: '2030-01', budget: 1, currency: 'EUR' })).toBeUndefined();
    expect(await B.wishlist.update(id, { plannedMonth: null, budget: null, currency: null })).toBeUndefined();
    expect(await A.wishlist.get(id)).toMatchObject({ plannedMonth: '2027-03', budget: 10, currency: 'USD' });
    const mine = await B.wishlist.create({ name: 'Bob hat', subType: 'Scarf', note: null });
    await B.wishlist.update(mine.id, { plannedMonth: '2027-03', budget: 5, currency: 'GBP' });
    const [a, b] = [groupByMonth(await A.wishlist.list()), groupByMonth(await B.wishlist.list())];
    expect(b.months).toHaveLength(1);
    expect(b.months[0]!.totals).toEqual([{ currency: 'GBP', total: 5 }]);
    expect(a.months.flatMap((m) => m.entries).map((e) => e.name)).not.toContain('Bob hat');
  });
  it('a planned entry marked bought leaves the plan', async () => {
    const w = await A.wishlist.create({ name: 'Navy tee', subType: 'T-shirt', note: null });
    await A.wishlist.update(w.id, { plannedMonth: '2027-06', budget: 30, currency: 'USD' });
    await A.wishlist.bought(w.id, { purchase: { date: '2026-11-01', store: null, price: 25, currency: 'USD', quantity: 1, notes: null }, colourHex: '#000080' });
    expect(groupByMonth(await A.wishlist.list()).months.flatMap((m) => m.entries).map((e) => e.id)).not.toContain(w.id);
  });
});
