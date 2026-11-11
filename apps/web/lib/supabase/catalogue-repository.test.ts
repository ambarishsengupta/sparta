import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { NO_CATALOGUE_FILTER } from '../catalogue';
import { DEMO_CATALOGUE } from '../demo-catalogue';
import { LocalRepository } from '../local-repository';
import { blockedRepository } from './backend';
import { SupabaseRepository } from './repository';

// The catalogue reads through the person's own session (WO-0085): the requests made, the keyset, and what a failure does. Fake client as in repository.test.ts.
type Call = { schema: string; table: string; steps: [string, unknown[]][] };
type Answer = { data: unknown; error: { code?: string; message?: string } | null; status?: number };
const builder = (call: Call, answer: Answer): unknown => new Proxy({}, {
  get: (_t, prop) => (prop === 'then'
    ? (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => new Promise((ok) => ok(answer)).then(res, rej)
    : (...args: unknown[]) => { call.steps.push([String(prop), args]); return builder(call, answer); }),
});
function fake(answer: Answer) {
  const calls: Call[] = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
    schema: (schema: string) => ({ from: (table: string) => { const call = { schema, table, steps: [] as Call['steps'] }; calls.push(call); return builder(call, answer); } }),
  } as unknown as SupabaseClient;
  return { repo: new SupabaseRepository(client, () => 'NOW'), calls };
}
const steps = (c: Call, name: string) => c.steps.filter((s) => s[0] === name).map((s) => s[1]);
const ID = (n: number) => `5c1b3b52-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dbRow = (n: number, over: Record<string, unknown> = {}) => ({
  id: ID(n), name: `Item ${String(n).padStart(3, '0')}`, brand: 'Zorvane', category: 'Tops', sub_type: 'T-shirt', colour_hex: '#111111', colour_family: 'Black', fit: null, pattern: null, material: null,
  seasons: [], occasions: [], sizes_available: null, price: '10.00', currency: 'INR', product_url: 'https://example.test/p', ...over,
});

describe('catalogue page request', () => {
  it('reads catalog.catalog_items for active rows only, name then id, 41 rows to see whether there is a next page', async () => {
    const { repo, calls } = fake({ data: [], error: null });
    expect(await repo.catalogue.page(NO_CATALOGUE_FILTER)).toEqual({ rows: [], next: null });
    const c = calls[0]!;
    expect([c.schema, c.table]).toEqual(['catalog', 'catalog_items']);
    expect(steps(c, 'eq')).toEqual([['status', 'active']]);
    expect(steps(c, 'order')).toEqual([['name', { ascending: true }], ['id', { ascending: true }]]);
    expect(steps(c, 'limit')).toEqual([[41]]);
    expect(String(steps(c, 'select')[0]![0])).not.toMatch(/image|img/);
    for (const unused of ['or', 'contains']) expect(steps(c, unused)).toEqual([]);
  });
  it('sends each filter once, as the right column', async () => {
    const { repo, calls } = fake({ data: [], error: null });
    await repo.catalogue.page({ q: '', category: 'Tops', brand: 'Zorvane', colourFamily: 'Navy', style: 'fit:Slim' });
    await repo.catalogue.page({ ...NO_CATALOGUE_FILTER, style: 'pattern:Solid' });
    await repo.catalogue.page({ ...NO_CATALOGUE_FILTER, style: 'occasion:Casual' });
    expect(steps(calls[0]!, 'eq')).toEqual([['status', 'active'], ['category', 'Tops'], ['brand', 'Zorvane'], ['colour_family', 'Navy'], ['fit', 'Slim']]);
    expect(steps(calls[1]!, 'eq')).toContainEqual(['pattern', 'Solid']);
    expect(steps(calls[2]!, 'contains')).toEqual([['occasions', ['Casual']]]);
    expect(steps(calls[2]!, 'eq')).toEqual([['status', 'active']]);
  });
  it('drops a filter value the taxonomy does not know instead of sending it', async () => {
    const { repo, calls } = fake({ data: [], error: null });
    await repo.catalogue.page({ q: '', category: 'Hats', brand: '', colourFamily: 'Plaid', style: 'fit:Wide-ish' });
    expect(steps(calls[0]!, 'eq')).toEqual([['status', 'active']]);
  });
  it('searches name or brand with the text quoted and the wildcards escaped, so a comma or bracket cannot add a condition', async () => {
    const { repo, calls } = fake({ data: [], error: null });
    await repo.catalogue.page({ ...NO_CATALOGUE_FILTER, q: '50%_off, "x"),status.eq.review' });
    const [list] = steps(calls[0]!, 'or')[0]!;
    expect(list).toBe('name.ilike."%50\\\\%\\\\_off, \\"x\\"),status.eq.review%",brand.ilike."%50\\\\%\\\\_off, \\"x\\"),status.eq.review%"');
  });
  it('continues after a cursor with a quoted keyset condition; a cursor whose id is not a uuid is ignored', async () => {
    const { repo, calls } = fake({ data: [], error: null });
    await repo.catalogue.page(NO_CATALOGUE_FILTER, { name: 'A, "b"', id: ID(7) });
    expect(steps(calls[0]!, 'or')).toEqual([[`name.gt."A, \\"b\\"",and(name.eq."A, \\"b\\"",id.gt.${ID(7)})`]]);
    await repo.catalogue.page(NO_CATALOGUE_FILTER, { name: 'x', id: 'x) or (status.eq.review' });
    expect(steps(calls[1]!, 'or')).toEqual([]);
  });
  it('gives 40 rows and the cursor of the 40th when a 41st exists, and none when it does not', async () => {
    const rows = Array.from({ length: 41 }, (_, n) => dbRow(n + 1));
    const more = await fake({ data: rows, error: null }).repo.catalogue.page(NO_CATALOGUE_FILTER);
    expect(more.rows).toHaveLength(40);
    expect(more.next).toEqual({ name: 'Item 040', id: ID(40) });
    const last = await fake({ data: rows.slice(0, 40), error: null }).repo.catalogue.page(NO_CATALOGUE_FILTER);
    expect([last.rows.length, last.next]).toEqual([40, null]);
  });
  it('skips a row it cannot read and still counts it for the cursor', async () => {
    const rows = Array.from({ length: 41 }, (_, n) => (n === 3 ? dbRow(n + 1, { category: 'Hats' }) : dbRow(n + 1)));
    const page = await fake({ data: rows, error: null }).repo.catalogue.page(NO_CATALOGUE_FILTER);
    expect(page.rows).toHaveLength(39);
    expect(page.next?.id).toBe(ID(40));
  });
  it('a failed read throws the sentence for the failure and never returns an empty page', async () => {
    const { repo } = fake({ data: null, error: { code: '42501', message: 'secret table catalog.catalog_items detail' }, status: 403 });
    const e = await repo.catalogue.page(NO_CATALOGUE_FILTER).then(() => null, (x: Error) => x);
    expect(e).not.toBeNull();
    expect(e!.message).not.toMatch(/catalog_items|secret/);
  });
  it('brands: the distinct names of active rows, sorted by the database, empty names left out', async () => {
    const { repo, calls } = fake({ data: [{ brand: 'A' }, { brand: 'A' }, { brand: '' }, { brand: null }, { brand: 'B' }], error: null });
    expect(await repo.catalogue.brands()).toEqual(['A', 'B']);
    expect(steps(calls[0]!, 'eq')).toEqual([['status', 'active']]);
    expect(steps(calls[0]!, 'not')).toEqual([['brand', 'is', null]]);
    expect(steps(calls[0]!, 'order')).toEqual([['brand']]);
  });
});

describe('a catalogue item is saved as origin catalogue', () => {
  it('the insert carries catalog_item_id, brand, size and origin, and the catalogue name', async () => {
    const { repo, calls } = fake({ data: null, error: null });
    await repo.items.create({
      name: 'Crew tee - Ink black', category: 'Tops', subType: 'T-shirt', rgb: [17, 17, 17], hex: '#111111', colourFamily: 'Black', fit: null, material: null, pattern: null, seasons: [], occasions: [],
      condition: null, favourite: false, neverWorn: false, status: 'active', archiveReason: null, catalogue: { id: ID(1), brand: 'Zorvane', sizeValue: 'M' },
    }).catch(() => undefined);
    expect(steps(calls[0]!, 'insert')[0]![0]).toMatchObject({ origin: 'catalogue', catalog_item_id: ID(1), brand: 'Zorvane', size_value: 'M', name: 'Crew tee - Ink black', user_id: 'u1' });
  });
});

describe('the other two repositories', () => {
  it('the blocked repository fails the catalogue like everything else', async () => {
    const r = blockedRepository('session');
    await expect(r.catalogue.page(NO_CATALOGUE_FILTER)).rejects.toBeTruthy();
    await expect(r.catalogue.brands()).rejects.toBeTruthy();
  });
  it('the browser-only repository serves the bundled demo catalogue, and an empty list gives the empty state', async () => {
    const demo = new LocalRepository(null);
    const p = await demo.catalogue.page(NO_CATALOGUE_FILTER);
    expect(p.rows).toHaveLength(40);
    expect(p.next).toBeNull();
    expect(await demo.catalogue.brands()).toHaveLength(8);
    expect((await demo.catalogue.page({ ...NO_CATALOGUE_FILTER, category: 'Footwear' })).rows).toHaveLength(5);
    const none = new LocalRepository(null, undefined, []);
    expect(await none.catalogue.page(NO_CATALOGUE_FILTER)).toEqual({ rows: [], next: null });
    expect(await none.catalogue.brands()).toEqual([]);
    expect(DEMO_CATALOGUE).toHaveLength(40);
  });
  it('saving a catalogue item in the browser-only repository adds a normal item and its purchase', async () => {
    const demo = new LocalRepository(null);
    const item = await demo.items.create({
      name: 'Crew tee - Ink black', category: 'Tops', subType: 'T-shirt', rgb: [17, 17, 17], hex: '#111111', colourFamily: 'Black', fit: null, material: null, pattern: null, seasons: [], occasions: [],
      condition: null, favourite: false, neverWorn: false, status: 'active', archiveReason: null, catalogue: { id: 'demo-0001', brand: 'Zorvane', sizeValue: null },
    });
    await demo.purchases.create({ itemId: item.id, date: '2026-11-01', store: null, price: 799, currency: 'INR', quantity: 1, notes: null });
    expect((await demo.purchases.forItem(item.id))).toHaveLength(1);
    expect((await demo.items.list())[0]!.name).toBe('Crew tee - Ink black');
  });
});
