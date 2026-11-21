import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteQueryLogOf } from '../../test-support/ops-rows';
import { cleanup, discover, lockStack, makeReady, provisionUser, sql } from '../../test-support/stack';
import { decideRoute } from '../supabase/gate';
import { loadGateState } from '../supabase/gate-state';
import { acceptVendorAgreement } from './access';
import { loadBrandLabels } from './brands';
import { INSIGHT_SENTENCES, coverage } from './insights';

// WO-0103 against the REAL local stack: a throwaway vendor (role and membership set by SQL as postgres, an invented vendor) is held at the agreement, /vendor opens after
// accepting, and a throwaway consumer is refused. Both go through the same gate and insight functions the proxy and the pages call, with each user's own session.
const stack = discover();
if (!stack) console.warn('SKIPPED vendor.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

describe.skipIf(!stack)('vendor access against the real stack', () => {
  const run = randomUUID().slice(0, 8);
  const email = { vic: `it-${run}-vic@example.test`, ann: `it-${run}-ann@example.test` };
  const pw = randomBytes(12).toString('base64url');
  const mailIds: string[] = [];
  let vic: SupabaseClient; let ann: SupabaseClient;
  let unlock: (() => void) | undefined;
  const acceptances = (u: string) => Number(sql(`select count(*) from catalog.vendor_agreement_acceptances where user_id = :'u'`, { u }));
  let vicId = '';
  const brandCode = `it-brand-${run}`;

  beforeAll(async () => {
    unlock = await lockStack();
    vic = await provisionUser(stack!, email.vic, pw, mailIds);
    ann = await provisionUser(stack!, email.ann, pw, mailIds);
    await makeReady(ann, 'IN');
    vicId = (await vic.auth.getUser()).data.user!.id;
    sql(`update app.profiles set role = 'vendor' where id = :'u'; with v as (insert into catalog.vendors (name) values (:'n') returning id) insert into catalog.vendor_members (vendor_id, user_id) select id, :'u' from v`, { u: vicId, n: `IT Vendor ${run}` });
  });
  afterAll(async () => {
    try { sql(`delete from catalog.lk_brand where code = :'c'`, { c: brandCode }); sql(`delete from catalog.vendors where name = :'n'`, { n: `IT Vendor ${run}` }); await cleanup(stack!, Object.values(email), mailIds); } finally { try { deleteQueryLogOf([vicId]); } finally { unlock?.(); } }
  });

  it('a vendor without the agreement is held at /vendor/agreement and the functions refuse it', async () => {
    const state = await loadGateState(vic);
    expect(state).toBe('needs_vendor_agreement');
    for (const p of ['/vendor', '/vendor/account', '/', '/outfits']) expect(decideRoute(state, p)).toEqual({ action: 'redirect', to: '/vendor/agreement' });
    expect(decideRoute(state, '/vendor/agreement')).toEqual({ action: 'allow' });
    expect(await coverage(vic)).toEqual({ ok: false, kind: 'agreement_required', message: INSIGHT_SENTENCES.agreement_required });
    expect(acceptances(vicId)).toBe(0);
  });

  it('refuses a stale version with the reload message and stores nothing', async () => {
    expect(await acceptVendorAgreement(vic, '0')).toEqual({ ok: false, message: expect.stringMatching(/Reload the page/) });
    expect(acceptances(vicId)).toBe(0);
    expect(await loadGateState(vic)).toBe('needs_vendor_agreement');
  });

  it('after accepting at the shipped version one row exists, /vendor opens and the consumer routes send the vendor back', async () => {
    expect(await acceptVendorAgreement(vic)).toEqual({ ok: true });
    expect(await acceptVendorAgreement(vic)).toEqual({ ok: true });   // again: still one row
    expect(acceptances(vicId)).toBe(1);
    const state = await loadGateState(vic);
    expect(state).toBe('vendor');
    for (const p of ['/vendor', '/vendor/gaps', '/vendor/account']) expect(decideRoute(state, p)).toEqual({ action: 'allow' });
    for (const p of ['/', '/outfits']) expect(decideRoute(state, p)).toEqual({ action: 'redirect', to: '/vendor' });
    expect(decideRoute(state, '/vendor/agreement')).toEqual({ action: 'redirect', to: '/vendor' });
    expect((await coverage(vic)).ok).toBe(true);
  });

  it('a consumer is refused: /vendor redirects to /, the functions say forbidden, and no acceptance can be written', async () => {
    const state = await loadGateState(ann);
    expect(state).toBe('ready');
    for (const p of ['/vendor', '/vendor/agreement', '/vendor/reports/x']) expect(decideRoute(state, p)).toEqual({ action: 'redirect', to: '/' });
    expect(await coverage(ann)).toEqual({ ok: false, kind: 'forbidden', message: INSIGHT_SENTENCES.forbidden });
    expect(await acceptVendorAgreement(ann)).toEqual({ ok: false, message: expect.stringMatching(/Something went wrong/) });
  });

  // WO-0155: the label map as the vendor's own session reads it. The brand row is inserted here and removed here (the H&M demo data is not needed and not touched).
  it('reads the label of a brand row the test inserts, keyed by its code, and nothing for a code that is not there', async () => {
    sql(`insert into catalog.lk_brand (code, label) values (:'c', 'IT & Co')`, { c: brandCode });
    try {
      const m = await loadBrandLabels(vic);
      expect(m.get(brandCode)).toBe('IT & Co');
      expect(m.has(`${brandCode}-absent`)).toBe(false);
    } finally { sql(`delete from catalog.lk_brand where code = :'c'`, { c: brandCode }); }
    expect((await loadBrandLabels(vic)).has(brandCode)).toBe(false);
  });
});
