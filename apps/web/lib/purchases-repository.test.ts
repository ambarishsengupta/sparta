import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { LocalRepository } from './local-repository';
import type { StorageLike } from './local-repository';
import { NO_PURCHASE_FILTER } from './purchases';
import type { PurchaseDraft } from './purchases';
import type { ItemInput } from './repository';
import { SupabaseRepository } from './supabase/repository';
import { blockedRepository } from './supabase/backend';
import { boughtArgs, cleanCursor, cleanFilter, likePattern, purchaseFromRow } from './supabase/mapping';

const mem = (): StorageLike => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };
const shirt: ItemInput = {
  name: 'Navy Shirt', category: 'Tops', subType: 'Shirt', hex: '#1F2A44', rgb: [31, 42, 68], colourFamily: 'Navy', pattern: null, seasons: [], occasions: [], condition: null,
  favourite: false, status: 'active', fit: null, material: null, neverWorn: false, archiveReason: null,
};
const draft = (over: Partial<PurchaseDraft> = {}): PurchaseDraft => ({ date: '2026-11-01', store: 'North', price: 10, currency: 'USD', quantity: 1, notes: null, ...over });

describe('local purchases (the browser-only demo keeps them locally)', () => {
  it('create, read back with the item name, update, delete; an unknown item is refused', async () => {
    const repo = new LocalRepository(mem());
    const item = await repo.items.create(shirt);
    const made = await repo.purchases.create({ ...draft(), itemId: item.id });
    expect(made).toMatchObject({ itemName: 'Navy Shirt', category: 'Tops', price: 10, quantity: 1 });
    expect((await repo.purchases.update(made.id, { price: 12.5 }))?.price).toBe(12.5);
    expect(await repo.purchases.forItem(item.id)).toHaveLength(1);
    expect(await repo.purchases.remove(made.id)).toBe(true);
    expect(await repo.purchases.remove(made.id)).toBe(false);
    await expect(repo.purchases.create({ ...draft(), itemId: 'nope' })).rejects.toThrow();
  });
  it('pages of 40 newest first with a keyset, and totals cover the whole filtered set, per currency', async () => {
    const repo = new LocalRepository(mem());
    const item = await repo.items.create(shirt);
    for (let i = 0; i < 45; i++) await repo.purchases.create({ ...draft({ date: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, currency: i % 2 ? 'EUR' : 'USD' }), itemId: item.id });
    const first = await repo.purchases.page(NO_PURCHASE_FILTER);
    expect(first.rows).toHaveLength(40);
    const second = await repo.purchases.page(NO_PURCHASE_FILTER, first.next);
    expect(second.rows).toHaveLength(5);
    expect(second.next).toBeNull();
    const ids = [...first.rows, ...second.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(45);
    expect([...first.rows, ...second.rows].map((r) => r.date)).toEqual([...first.rows, ...second.rows].map((r) => r.date).sort().reverse());
    expect(await repo.purchases.totals(NO_PURCHASE_FILTER)).toEqual([{ currency: 'EUR', total: 220 }, { currency: 'USD', total: 230 }]);
    expect(await repo.purchases.totals({ ...NO_PURCHASE_FILTER, from: '2026-10-28' })).toEqual([{ currency: 'EUR', total: 10 }]);
  });
  it('deleting an item removes its purchases; an older saved document without purchases still reads', async () => {
    const storage = mem();
    const repo = new LocalRepository(storage);
    const item = await repo.items.create(shirt);
    await repo.purchases.create({ ...draft(), itemId: item.id });
    await repo.items.remove(item.id);
    expect((await repo.purchases.page(NO_PURCHASE_FILTER)).rows).toEqual([]);
    storage.setItem('sparta.wardrobe.v1', JSON.stringify({ version: 1, seq: 0, items: [], outfits: [], wishlist: [] }));
    expect((await new LocalRepository(storage).purchases.totals(NO_PURCHASE_FILTER))).toEqual([]);
  });
  it('wishlist bought: one step makes the item (the entry colour or the given one) and its purchase and removes the entry', async () => {
    const repo = new LocalRepository(mem());
    const navy = await repo.wishlist.create({ name: 'Navy Chinos', subType: 'Chinos', colourFamily: 'Navy', note: null });
    const id = await repo.wishlist.bought(navy.id, { purchase: draft({ price: 59, quantity: 2 }) });
    expect((await repo.items.get(id))).toMatchObject({ name: 'Navy Chinos', category: 'Bottoms', colourFamily: 'Navy', status: 'active' });
    expect((await repo.purchases.forItem(id))[0]).toMatchObject({ price: 59, quantity: 2 });
    expect(await repo.wishlist.list()).toEqual([]);
    const none = await repo.wishlist.create({ name: 'A top', subType: 'Shirt', note: null });
    await expect(repo.wishlist.bought(none.id, { purchase: draft() })).rejects.toThrow('colour');
    expect(await repo.wishlist.list()).toHaveLength(1); // nothing was made or removed
    expect(await repo.items.list()).toHaveLength(1);
    await repo.wishlist.bought(none.id, { purchase: draft(), colourHex: '#ff0000' });
    expect((await repo.items.list()).map((i) => i.colourFamily)).toContain('Red');
  });
});

// ---- the account-backed repository over a fake client -----------------------------------------------------------------------
type Call = { kind: string; table: string; steps: [string, unknown[]][] };
const fake = (answer: (c: Call) => { data: unknown; error: null | { code: string } } = () => ({ data: [], error: null })) => {
  const calls: Call[] = [];
  const builder = (call: Call): unknown => new Proxy({}, { get: (_t, prop) => (prop === 'then'
    ? (res: (v: unknown) => unknown) => Promise.resolve(answer(call)).then(res)
    : (...args: unknown[]) => { call.steps.push([String(prop), args]); return builder(call); }) });
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
    schema: () => ({ from: (table: string) => { const c = { kind: 'from', table, steps: [] }; calls.push(c); return builder(c); }, rpc: (name: string, args: unknown) => { const c: Call = { kind: 'rpc', table: name, steps: [['args', [args]]] }; calls.push(c); return builder(c); } }) } as unknown as SupabaseClient;
  return { repo: new SupabaseRepository(client, () => 'NOW'), calls };
};
const UUID = '5c1b3b52-0000-4000-8000-000000000001';
const has = (c: Call, name: string, ...args: unknown[]) => c.steps.some((s) => s[0] === name && args.every((a, i) => JSON.stringify(s[1][i]) === JSON.stringify(a)));

describe('SupabaseRepository purchases and wishlist (requests)', () => {
  it('the wishlist lists open entries only, and bought calls app.wishlist_bought with the entry, the colour and the purchase document', async () => {
    const { repo, calls } = fake(() => ({ data: UUID, error: null }));
    await repo.wishlist.list().catch(() => undefined);
    expect(has(calls[0]!, 'eq', 'status', 'open')).toBe(true);
    expect(await repo.wishlist.bought(UUID, { purchase: draft({ price: 49.9, quantity: 2, store: null }), colourHex: '#FF8000' })).toBe(UUID);
    expect(calls[1]).toMatchObject({ kind: 'rpc', table: 'wishlist_bought' });
    expect(calls[1]!.steps[0]![1][0]).toEqual({
      p_entry: UUID, p_item: { colour_r: 255, colour_g: 128, colour_b: 0 }, p_purchase: { purchase_date: '2026-11-01', store: null, price: 49.9, currency: 'USD', quantity: 2, notes: null },
    });
    await expect(fake().repo.wishlist.bought('not-a-uuid', { purchase: draft() })).rejects.toMatchObject({ kind: 'rejected' });
    expect(boughtArgs(UUID, draft()).p_item).toEqual({}); // no colour given: the function uses the entry's
  });
  it('a page asks for 41 newest first, filtered by the columns and the joined item, with the keyset condition', async () => {
    const { repo, calls } = fake();
    await repo.purchases.page({ store: '50%_off', brand: 'Acme', category: 'Tops', from: '2026-01-01', to: '2026-12-31' }, { date: '2026-11-01', id: UUID });
    const c = calls[0]!;
    expect(has(c, 'not', 'purchase_date', 'is', null)).toBe(true);
    expect(has(c, 'ilike', 'store', '%50\\%\\_off%')).toBe(true);
    expect(has(c, 'ilike', 'items.brand', '%Acme%')).toBe(true);
    expect(has(c, 'eq', 'items.category', 'Tops')).toBe(true);
    expect(has(c, 'gte', 'purchase_date', '2026-01-01') && has(c, 'lte', 'purchase_date', '2026-12-31')).toBe(true);
    expect(has(c, 'or', `purchase_date.lt.2026-11-01,and(purchase_date.eq.2026-11-01,id.lt.${UUID})`)).toBe(true);
    expect(has(c, 'order', 'purchase_date', { ascending: false }) && has(c, 'limit', 41)).toBe(true);
  });
  it('a date or cursor that is not well formed never reaches a request (no filter text can be injected)', () => {
    expect(cleanFilter({ ...NO_PURCHASE_FILTER, from: '2026-01-01),id.gt.0', to: 'x' })).toMatchObject({ from: '', to: '' });
    expect(cleanCursor({ date: '2026-11-01', id: 'x),id.gt.(0' })).toBeNull();
    expect(cleanCursor({ date: '2026-11-01)', id: UUID })).toBeNull();
    expect(cleanCursor({ date: '2026-11-01', id: UUID })).not.toBeNull();
    expect(likePattern('a\\b')).toBe('%a\\\\b%');
  });
  it('a row is read as numbers, null when it has no date, price or currency, and a malformed one is refused', () => {
    const row = { id: UUID, item_id: UUID, purchase_date: '2026-11-01', store: null, price: '19.90', currency: 'EUR', quantity: 2, notes: null, created_at: 'T', items: { name: 'Shirt', category: 'Tops', brand: null } };
    expect(purchaseFromRow(row)).toMatchObject({ price: 19.9, quantity: 2, category: 'Tops', itemName: 'Shirt', brand: null });
    expect(purchaseFromRow({ ...row, price: null })).toBeNull();
    expect(purchaseFromRow({ ...row, purchase_date: null })).toBeNull();
    expect(() => purchaseFromRow({ ...row, price: 'abc' })).toThrow();
    expect(() => purchaseFromRow({ ...row, items: null })).toThrow();
  });
  it('rates and the profile currency are read through the database function and the own profile row', async () => {
    const { repo } = fake((c) => ({ data: c.kind === 'rpc' ? [{ currency: 'EUR', rate_date: '2026-11-05', per_usd: '0.9' }, { currency: 'XXX', rate_date: '2026-11-05', per_usd: 0 }] : { currency: 'INR' }, error: null }));
    expect(await repo.prices.rates()).toEqual({ EUR: { rateDate: '2026-11-05', perUsd: 0.9 } });
    expect(await repo.prices.currency()).toBe('INR');
  });
  it('a blocked repository fails the new calls too', async () => {
    const b = blockedRepository('session');
    for (const f of [b.purchases.page(NO_PURCHASE_FILTER), b.purchases.totals(NO_PURCHASE_FILTER), b.wishlist.bought('a', { purchase: draft() }), b.prices.rates()]) await expect(f).rejects.toMatchObject({ kind: 'session' });
  });
});
