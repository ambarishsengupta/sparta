import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, discover, lockStack, makeReady, provisionUser, sql } from '../../test-support/stack';
import { NO_PURCHASE_FILTER } from '../purchases';
import type { PurchaseDraft } from '../purchases';
import type { ItemInput } from '../repository';
import { SupabaseRepository } from './repository';

// Integration suite against the REAL local stack (WO-0081): purchases through the person's own session, row-level security between two people,
// keyset pages, totals per currency, app.wishlist_bought and the exchange-rate read. Skips, with a message, when the stack is not running.
const stack = discover();
if (!stack) console.warn('SKIPPED purchases.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');
vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

const shirt: ItemInput = {
  name: 'Navy Shirt', category: 'Tops', subType: 'Shirt', rgb: [0, 0, 139], hex: '#00008B', colourFamily: 'Navy', fit: null, material: null, pattern: null,
  seasons: [], occasions: [], condition: null, favourite: false, neverWorn: false, status: 'active', archiveReason: null,
};
const draft = (over: Partial<PurchaseDraft> = {}): PurchaseDraft => ({ date: '2026-11-01', store: 'North Store', price: 19.99, currency: 'EUR', quantity: 3, notes: null, ...over });
const rejects = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as { kind: string }; } throw new Error('did not reject'); };

describe.skipIf(!stack)('purchases against the real stack', () => {
  const run = randomUUID().slice(0, 8);
  const email = { ann: `it-${run}-pann@example.test`, bob: `it-${run}-pbob@example.test` };
  const pw = randomBytes(12).toString('base64url');
  const mailIds: string[] = [];
  let A: SupabaseRepository; let B: SupabaseRepository;
  let unlock: (() => void) | undefined;
  beforeAll(async () => {
    unlock = await lockStack();
    const [ann, bob] = [await provisionUser(stack!, email.ann, pw, mailIds), await provisionUser(stack!, email.bob, pw, mailIds)] as SupabaseClient[];
    await makeReady(ann!, 'IN');
    await makeReady(bob!, 'IN');
    [A, B] = [new SupabaseRepository(ann!), new SupabaseRepository(bob!)];
  });
  afterAll(async () => { try { sql(`delete from ops.fx_rates where currency = 'QQQ'`); await cleanup(stack!, Object.values(email), mailIds); } finally { unlock?.(); } });

  it('stores the unit price and the quantity, reads the item attributes back, and the total is price x quantity', async () => {
    const item = await A.items.create(shirt);
    const made = await A.purchases.create({ ...draft(), itemId: item.id });
    expect(made).toMatchObject({ price: 19.99, quantity: 3, currency: 'EUR', date: '2026-11-01', itemName: 'Navy Shirt', category: 'Tops' });
    expect(await A.purchases.totals(NO_PURCHASE_FILTER)).toEqual([{ currency: 'EUR', total: 59.97 }]);
    expect((await A.purchases.update(made.id, { price: 20, store: null }))).toMatchObject({ price: 20, store: null });
    expect((await A.purchases.forItem(item.id))).toHaveLength(1);
  });
  it('another person never sees, changes or deletes it', async () => {
    const [mine] = (await A.purchases.page(NO_PURCHASE_FILTER)).rows;
    expect((await B.purchases.page(NO_PURCHASE_FILTER)).rows).toEqual([]);
    expect(await B.purchases.totals(NO_PURCHASE_FILTER)).toEqual([]);
    expect(await B.purchases.forItem(mine!.itemId)).toEqual([]);
    expect(await B.purchases.update(mine!.id, { price: 1 })).toBeUndefined();
    expect(await B.purchases.remove(mine!.id)).toBe(false);
    expect((await A.purchases.page(NO_PURCHASE_FILTER)).rows[0]!.price).toBe(20);
    expect((await rejects(B.purchases.create({ ...draft(), itemId: mine!.itemId }))).kind).toBeDefined(); // not Bob's item
  });
  it('pages by keyset 40 at a time, newest first, with every row exactly once, and filters by store, category and range', async () => {
    const item = await A.items.create({ ...shirt, name: 'Grey Tee' });
    for (let i = 0; i < 44; i++) await A.purchases.create({ ...draft({ date: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`, price: 1, quantity: 1, currency: 'USD', store: i < 4 ? 'South' : 'Mall' }), itemId: item.id });
    const first = await A.purchases.page(NO_PURCHASE_FILTER);
    const second = await A.purchases.page(NO_PURCHASE_FILTER, first.next);
    expect([first.rows.length, second.rows.length, second.next]).toEqual([40, 5, null]); // 44 new + the first purchase
    const all = [...first.rows, ...second.rows];
    expect(new Set(all.map((r) => r.id)).size).toBe(45);
    expect(all.map((r) => r.date)).toEqual([...all.map((r) => r.date)].sort().reverse());
    expect(await A.purchases.totals({ ...NO_PURCHASE_FILTER, category: 'Tops', store: 'sou' })).toEqual([{ currency: 'USD', total: 4 }]);
    expect((await A.purchases.page({ ...NO_PURCHASE_FILTER, from: '2026-10-01' })).rows).toHaveLength(1);
    expect(await A.purchases.totals(NO_PURCHASE_FILTER)).toEqual([{ currency: 'EUR', total: 60 }, { currency: 'USD', total: 44 }]); // never summed across currencies
  });
  it('wishlist bought makes the item and the purchase and removes the entry from the list, once, and only for its owner', async () => {
    const entry = await A.wishlist.create({ name: 'Wool coat', subType: 'Coat', note: null });
    expect((await rejects(B.wishlist.bought(entry.id, { purchase: draft(), colourHex: '#112233' }))).kind).toBe('rejected');
    const itemId = await A.wishlist.bought(entry.id, { purchase: draft({ price: 120, quantity: 1 }), colourHex: '#112233' });
    expect(await A.items.get(itemId)).toMatchObject({ name: 'Wool coat', rgb: [17, 34, 51], status: 'active' });
    expect((await A.purchases.forItem(itemId))[0]).toMatchObject({ price: 120, quantity: 1 });
    expect((await A.wishlist.list()).map((w) => w.id)).not.toContain(entry.id);
    expect((await rejects(A.wishlist.bought(entry.id, { purchase: draft(), colourHex: '#112233' }))).kind).toBe('rejected'); // already bought
    const noColour = await A.wishlist.create({ name: 'Scarf', subType: 'Scarf', note: null });
    const before = (await A.items.list()).length;
    expect((await rejects(A.wishlist.bought(noColour.id, { purchase: draft() }))).kind).toBe('rejected'); // an item needs a colour: all or nothing
    expect([(await A.items.list()).length, (await A.wishlist.list()).map((w) => w.id).includes(noColour.id)]).toEqual([before, true]);
  });
  it('prices: the profile currency and the newest rate per currency, none until rates exist', async () => {
    expect(await A.prices.currency()).toBe('USD');
    expect((await A.prices.rates()).QQQ).toBeUndefined();
    sql(`insert into ops.fx_rates (currency, rate_date, per_usd) values ('QQQ', '2026-11-01', 2), ('QQQ', '2026-11-05', 4)`);
    expect((await A.prices.rates()).QQQ).toEqual({ rateDate: '2026-11-05', perUsd: 4 });
  });
});
