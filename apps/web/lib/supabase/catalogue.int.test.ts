import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, discover, lockStack, makeReady, provisionUser, sql } from '../../test-support/stack';
import { NO_CATALOGUE_FILTER } from '../catalogue';
import type { CatalogueItem } from '../catalogue';
import { SupabaseRepository } from './repository';

// Integration suite against the REAL local stack with the SYNTHETIC demo seed (WO-0085): the catalogue is read with a consumer's own session, sees
// active rows only, pages by keyset, and a saved catalogue item survives take-down with its attributes. Skips, with a message, when the stack is not running.
const stack = discover();
if (!stack) console.warn('SKIPPED catalogue.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
const SEED = fileURLToPath(new URL('../../../../supabase/scripts/seed-demo-catalog.sh', import.meta.url));
const all = async (r: SupabaseRepository, filter = NO_CATALOGUE_FILTER): Promise<{ rows: CatalogueItem[]; pages: number[] }> => {
  const rows: CatalogueItem[] = []; const pages: number[] = [];
  for (let after = null as { name: string; id: string } | null, n = 0; n < 20; n++) {
    const p = await r.catalogue.page(filter, after);
    rows.push(...p.rows); pages.push(p.rows.length);
    if (!p.next) break;
    after = p.next;
  }
  return { rows, pages };
};

describe.skipIf(!stack)('the catalogue against the real stack and the demo seed', () => {
  const run = randomUUID().slice(0, 8);
  const email = { ann: `it-${run}-cann@example.test`, adm: `it-${run}-cadm@example.test` };
  const pw = randomBytes(12).toString('base64url');
  const mailIds: string[] = [];
  const source = `it-${run}`;
  let A: SupabaseRepository; let admin: SupabaseClient; let seededBefore = 0; let sourceId = 0;
  let unlock: (() => void) | undefined;
  beforeAll(async () => {
    unlock = await lockStack();
    seededBefore = Number(sql(`select count(*) from catalog.sources where name = 'demo'`));
    execFileSync('bash', [SEED], { stdio: 'ignore', timeout: 90_000 });
    const [ann, adm] = [await provisionUser(stack!, email.ann, pw, mailIds), await provisionUser(stack!, email.adm, pw, mailIds)] as SupabaseClient[];
    await makeReady(ann!, 'IN');
    await makeReady(adm!, 'IN');
    admin = adm!;
    A = new SupabaseRepository(ann!);
    sourceId = Number(sql(`insert into catalog.sources (name, site_url, robots_allowed, terms_note, allowed, checked_on) values (:'n', 'http://127.0.0.1/', false, 'SYNTHETIC test source', false, current_date) returning id`, { n: source }).split('\n')[0]);
    // 45 more active rows (so the demo's 40 and these make three pages), one with characters that are special in a search, plus a review and a withdrawn row that must never show
    sql(`insert into catalog.catalog_items (source_id, sku, name, brand, category, sub_type, colour_r, colour_g, colour_b, status, product_url, price, currency, occasions)
         select :'sid', 'IT-' || n, case when n = 1 then 'Wild, "name" 50%_off (x)' else 'Zz Test item ' || lpad(n::text, 3, '0') end, 'Itbrand', 'Tops', 'Shirt', 200, 30, 30, 'active', 'https://example.test/p/' || n, 5.5, 'EUR', '{Party}'
         from generate_series(1, 45) n`, { sid: String(sourceId) });
    sql(`insert into catalog.catalog_items (source_id, sku, name, brand, category, sub_type, colour_r, colour_g, colour_b, status, product_url)
         values (:'sid', 'IT-REVIEW', 'Zz REVIEW row', 'Reviewbrand', null, null, null, null, null, 'review', 'https://example.test/r'),
                (:'sid', 'IT-WITHDRAWN', 'Zz WITHDRAWN row', 'Withdrawnbrand', 'Tops', 'Shirt', 1, 2, 3, 'withdrawn', 'https://example.test/w')`, { sid: String(sourceId) });
  });
  afterAll(async () => {
    try {
      sql(`delete from app.items where user_id in (select id from auth.users where email like :'e')`, { e: `it-${run}-c%@example.test` });
      sql(`delete from catalog.sources where name = :'n'`, { n: source });
      if (seededBefore === 0) execFileSync('bash', [SEED, '--remove'], { stdio: 'ignore', timeout: 90_000 });
      await cleanup(stack!, Object.values(email), mailIds);
    } finally { unlock?.(); }
  });

  it('a consumer sees the 40 demo rows and the 45 test rows, in pages of 40, none twice, none missing, and never the review or withdrawn row', async () => {
    const { rows, pages } = await all(A);
    expect(pages).toEqual([40, 40, 5]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(85);
    expect(rows.filter((r) => r.brand === 'Zorvane').length).toBeGreaterThan(0);
    expect(rows.map((r) => r.name).join('|')).not.toMatch(/REVIEW|WITHDRAWN/);
    expect(rows.map((r) => r.brand)).not.toContain('Reviewbrand');
  });
  it('a withdrawn or review item never appears in a search either, by name or brand, and its brand is not offered', async () => {
    for (const q of ['WITHDRAWN', 'Withdrawnbrand', 'REVIEW', 'Reviewbrand']) expect((await A.catalogue.page({ ...NO_CATALOGUE_FILTER, q })).rows, q).toEqual([]);
    const brands = await A.catalogue.brands();
    expect(brands).toContain('Zorvane');
    expect(brands).toContain('Itbrand');
    expect(brands).not.toContain('Withdrawnbrand');
    expect(brands).not.toContain('Reviewbrand');
    expect(new Set(brands).size).toBe(brands.length);
  });
  it('searches by name or brand and filters by category, brand, colour family and style', async () => {
    expect((await all(A, { ...NO_CATALOGUE_FILTER, q: 'oxford' })).rows).toHaveLength(5);
    expect((await all(A, { ...NO_CATALOGUE_FILTER, q: 'zorvane' })).rows.every((r) => r.brand === 'Zorvane')).toBe(true);
    expect((await all(A, { ...NO_CATALOGUE_FILTER, category: 'Footwear' })).rows).toHaveLength(5);
    expect((await all(A, { ...NO_CATALOGUE_FILTER, brand: 'Itbrand' })).rows).toHaveLength(45);
    expect((await all(A, { ...NO_CATALOGUE_FILTER, colourFamily: 'Navy' })).rows.every((r) => r.colourFamily === 'Navy')).toBe(true);
    expect((await all(A, { ...NO_CATALOGUE_FILTER, style: 'fit:Slim' })).rows).toHaveLength(10);
    expect((await all(A, { ...NO_CATALOGUE_FILTER, style: 'occasion:Party' })).rows).toHaveLength(45);
    expect((await all(A, { ...NO_CATALOGUE_FILTER, category: 'Tops', brand: 'Itbrand', style: 'occasion:Party' })).rows).toHaveLength(45);
    expect((await all(A, { ...NO_CATALOGUE_FILTER, category: 'Footwear', brand: 'Itbrand' })).rows).toEqual([]);
  });
  it('a search and the keyset cursor work together: 45 matches come as 40 then 5, none twice', async () => {
    const { rows, pages } = await all(A, { ...NO_CATALOGUE_FILTER, q: 'itbrand' });
    expect(pages).toEqual([40, 5]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(45);
  });
  it('a search with commas, quotes, brackets and wildcard characters finds exactly the one row and cannot widen the filter; paging after such a name works', async () => {
    const hit = (await A.catalogue.page({ ...NO_CATALOGUE_FILTER, q: '50%_off' })).rows;
    expect(hit.map((r) => r.name)).toEqual(['Wild, "name" 50%_off (x)']);
    expect((await A.catalogue.page({ ...NO_CATALOGUE_FILTER, q: '%' })).rows.map((r) => r.name)).toEqual(['Wild, "name" 50%_off (x)']); // a literal %, not "anything"
    expect((await A.catalogue.page({ ...NO_CATALOGUE_FILTER, q: 'x"),status.eq.review,(name.ilike."' })).rows).toEqual([]);
    const after = await A.catalogue.page(NO_CATALOGUE_FILTER, { name: 'Wild, "name" 50%_off (x)', id: hit[0]!.id });
    expect(after.rows.length).toBeGreaterThan(0);
    expect(after.rows.map((r) => r.id)).not.toContain(hit[0]!.id);
  });
  it('a consumer cannot change the catalogue and the source register is not reachable with the session', async () => {
    const tbl = (A as unknown as { client: SupabaseClient }).client;
    expect((await tbl.schema('catalog').from('catalog_items').update({ name: 'x' }).eq('source_id', sourceId).select('id')).data ?? []).toEqual([]);
    expect((await tbl.schema('catalog').from('sources').select('id')).error).not.toBeNull();
  });
  it('saves a catalogue item as origin catalogue with its link, brand, size, name and a purchase; it survives take-down with its attributes', async () => {
    const pick = (await A.catalogue.page({ ...NO_CATALOGUE_FILTER, q: 'Zz Test item 007' })).rows[0]!;
    expect(pick.brand).toBe('Itbrand');
    const saved = await A.items.create({
      name: pick.name, category: pick.category, subType: pick.subType, rgb: [200, 30, 30], hex: pick.hex, colourFamily: pick.colourFamily ?? 'Red', fit: null, material: null, pattern: null,
      seasons: [], occasions: [], condition: null, favourite: false, neverWorn: false, status: 'active', archiveReason: null, catalogue: { id: pick.id, brand: pick.brand, sizeValue: 'M' },
    });
    const purchase = await A.purchases.create({ itemId: saved.id, date: '2026-11-01', store: 'Corner shop', price: 5.5, currency: 'EUR', quantity: 1, notes: null });
    const row = () => sql(`select origin || '|' || coalesce(catalog_item_id::text, 'null') || '|' || brand || '|' || size_value || '|' || name || '|' || category || '|' || colour_family from app.items where id = :'i'`, { i: saved.id });
    expect(row()).toBe(`catalogue|${pick.id}|Itbrand|M|Zz Test item 007|Tops|Red`);
    // take the source down as an admin, through the real function
    sql(`update app.profiles set role = 'admin' where id = (select id from auth.users where email = :'e')`, { e: email.adm });
    const n = await admin.schema('catalog').rpc('take_down_source', { p_source: sourceId, p_note: 'integration test' });
    expect(n.error).toBeNull();
    expect(n.data).toBe(47);
    expect(row()).toBe(`catalogue|null|Itbrand|M|Zz Test item 007|Tops|Red`); // the link is gone, nothing else
    expect((await A.items.get(saved.id))!.name).toBe('Zz Test item 007');
    expect((await A.purchases.forItem(saved.id)).map((p) => p.id)).toEqual([purchase.id]);
    const { rows } = await all(A);
    expect(rows).toHaveLength(40); // only the demo source is left
    expect(rows.map((r) => r.brand)).not.toContain('Itbrand');
  });
});
