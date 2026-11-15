import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, discover, lockStack, makeReady, provisionUser, sql } from '../../test-support/stack';
import { NO_CATALOGUE_FILTER } from '../catalogue';
import type { ItemInput } from '../repository';
import { SupabaseRepository } from './repository';

// WO-0121 against the REAL local stack: a catalogue row in the loader's shape (local address /hm-demo/<sku>, invented sku 099...) is read with a consumer's own
// session, an item created from it finds its photograph id through catalog_item_id, and an item from another source or a manual item does not.
// Skips, with a message, when the stack is not running. Everything created here is invented and removed afterwards.
const stack = discover();
if (!stack) console.warn('SKIPPED hm-photo.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

describe.skipIf(!stack)('the H&M demo photograph id against the real stack', () => {
  const run = randomUUID().slice(0, 8);
  const email = `it-${run}-hm@example.test`;
  const pw = randomBytes(12).toString('base64url');
  const mailIds: string[] = [];
  const source = `it-hm-${run}`;
  let A: SupabaseRepository; let unlock: (() => void) | undefined;
  const make = (name: string, extra: Partial<ItemInput>): Promise<{ id: string }> => A.items.create({
    name, category: 'Tops', subType: 'T-shirt', rgb: [10, 20, 30], hex: '#0A141E', colourFamily: 'Black', fit: null, material: null, pattern: null, seasons: [], occasions: [],
    condition: null, favourite: false, neverWorn: false, status: 'active', archiveReason: null, ...extra,
  });
  beforeAll(async () => {
    unlock = await lockStack();
    const user = (await provisionUser(stack!, email, pw, mailIds)) as SupabaseClient;
    await makeReady(user, 'IN');
    A = new SupabaseRepository(user);
    const sid = sql(`insert into catalog.sources (name, site_url, robots_allowed, terms_note, allowed, checked_on) values (:'n', 'http://127.0.0.1/', false, 'SYNTHETIC test source', false, current_date) returning id`, { n: source }).split('\n')[0]!;
    sql(`insert into catalog.catalog_items (source_id, sku, name, brand, category, sub_type, colour_r, colour_g, colour_b, status, product_url)
         values (:'sid', '0990000001', 'Zzyx demo tee', 'Zzbrand', 'Tops', 'T-shirt', 10, 20, 30, 'active', 'http://127.0.0.1/hm-demo/0990000001'),
                (:'sid', '0990000002', 'Zzyx other tee', 'Zzbrand', 'Tops', 'T-shirt', 10, 20, 30, 'active', 'https://example.test/p/2')`, { sid });
  });
  afterAll(async () => {
    try {
      sql(`delete from app.items where user_id in (select id from auth.users where email = :'e')`, { e: email });
      sql(`delete from catalog.sources where name = :'n'`, { n: source });
      await cleanup(stack!, [email], mailIds);
    } finally { unlock?.(); }
  });

  it('exposes sku and the source of a catalogue row, and gives photoId only to items made from the demo-source row', async () => {
    const rows = (await A.catalogue.page({ ...NO_CATALOGUE_FILTER, q: 'Zzyx' })).rows;
    expect(rows.map((r) => [r.sku, r.source])).toEqual([['0990000001', 'hm-demo'], ['0990000002', undefined]]);
    const [demo, other] = rows;
    const fromDemo = await make('From demo row', { catalogue: { id: demo!.id, brand: demo!.brand, sizeValue: 'M' } });
    const fromOther = await make('From other row', { catalogue: { id: other!.id, brand: other!.brand, sizeValue: 'M' } });
    const manual = await make('Manual item', {});
    const list = await A.items.list();
    const photo = (id: string) => list.find((i) => i.id === id)!.photoId;
    expect(photo(fromDemo.id)).toBe('0990000001');
    expect(photo(fromOther.id)).toBeUndefined();
    expect(photo(manual.id)).toBeUndefined();
    expect((await A.items.get(fromDemo.id))!.photoId).toBe('0990000001');
    expect((await A.items.get(manual.id))!.photoId).toBeUndefined();
  });
  it('after the source is removed the item keeps working and shows no photograph', async () => {
    const [demo] = (await A.catalogue.page({ ...NO_CATALOGUE_FILTER, q: 'Zzyx demo' })).rows;
    const kept = await make('Kept demo item', { catalogue: { id: demo!.id, brand: demo!.brand, sizeValue: null } });
    sql(`delete from catalog.sources where name = :'n'`, { n: source });
    expect((await A.items.get(kept.id))!.photoId).toBeUndefined();
  });
});
