import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, discover, lockStack, makeReady, provisionUser, sql } from '../../test-support/stack';
import { lookupBarcode } from '../barcode-lookup';
import { SupabaseRepository } from './repository';

// Barcode lookup (FR-26) against the REAL local stack with a throwaway consumer: the padded code finds active rows only, several rows come back, none is empty.
const stack = discover();
if (!stack) console.warn('SKIPPED barcode.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

describe.skipIf(!stack)('barcode lookup against the real stack', () => {
  const run = randomUUID().slice(0, 8);
  const email = `it-${run}-bc@example.test`;
  const mailIds: string[] = [];
  let ann: SupabaseClient; let repo: SupabaseRepository; let unlock: (() => void) | undefined;
  const g = (n: number) => `29${run.replace(/[^0-9]/g, '0').slice(0, 6).padEnd(6, '0')}${String(n).padStart(6, '0')}`;   // a 14-digit invented code per row
  const row = (sku: string, gtin: string, status: string) => `insert into catalog.catalog_items (source_id, sku, name, brand, product_url, status, category, sub_type, gtin) select id, '${run}-${sku}', 'IT ${sku}', 'Zorvane', 'http://127.0.0.1/${sku}', '${status}', 'Tops', 'T-shirt', '${gtin}' from catalog.sources where name = 'IT-BC-${run}';`;
  beforeAll(async () => {
    unlock = await lockStack();
    ann = await provisionUser(stack!, email, randomBytes(12).toString('base64url'), mailIds);
    await makeReady(ann, 'IN');
    repo = new SupabaseRepository(ann);
    sql(`insert into catalog.sources (name, site_url, robots_allowed, terms_note, allowed, checked_on) values ('IT-BC-${run}', 'https://bc.example.test/', true, 'ok', true, current_date);
      ${row('one', g(1), 'active')}${row('gone', g(1), 'withdrawn')}${row('rev', g(2), 'review')}${row('two-a', g(3), 'active')}${row('two-b', g(3), 'active')}`);
  });
  afterAll(async () => {
    try { sql(`delete from catalog.sources where name = 'IT-BC-${run}'`); await cleanup(stack!, [email], mailIds); } finally { unlock?.(); }
  });

  it('the padded code finds the one active row; a withdrawn row with the same code is not shown', async () => {
    const r = await lookupBarcode(repo.catalogue, g(1).replace(/^0+/, ''));
    expect(r.kind).toBe('one');
    expect(r.kind === 'one' && r.item.name).toBe('IT one');
  });
  it('a typed code that needs padding (12 digits) finds the row stored with 14', async () => {
    sql(`update catalog.catalog_items set gtin = '00${'4'.repeat(12)}' where sku = '${run}-one'`);
    const r = await lookupBarcode(repo.catalogue, ` ${'4'.repeat(4)} ${'4'.repeat(8)} `);
    expect(r).toMatchObject({ kind: 'one', gtin: `00${'4'.repeat(12)}` });
  });
  it('a row under review is never found, an unknown code finds nothing, and two active rows come back in name order', async () => {
    expect(await lookupBarcode(repo.catalogue, g(2))).toEqual({ kind: 'none', gtin: g(2) });
    expect(await lookupBarcode(repo.catalogue, g(9))).toEqual({ kind: 'none', gtin: g(9) });
    const many = await lookupBarcode(repo.catalogue, g(3));
    expect(many.kind).toBe('many');
    expect(many.kind === 'many' && many.items.map((i) => i.name)).toEqual(['IT two-a', 'IT two-b']);
  });
});
