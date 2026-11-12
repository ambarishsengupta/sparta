import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, discover, lockStack, makeReady, provisionUser, sql } from '../../test-support/stack';
import { acceptVendorAgreement, ownVendor } from './access';
import { INITIAL, loadHeader, loadMix, loadSpectrum, loadTrends, type Base } from './dashboard';
import { INSIGHT_SENTENCES } from './insights';

// WO-0112 smoke test against the REAL local stack after `bash supabase/scripts/seed-demo-insights.sh` (the seed is never run by a gate, so without it this file is skipped):
// a throwaway vendor user (role and membership of the seeded demo vendor set by SQL as postgres, deleted afterwards) loads the dashboard's views with its own session.
const stack = discover();
const DEMO = 'Northwind Demo Outfitters';
const seeded = stack ? sql(`select count(*) from catalog.vendors v where v.name = :'n' and exists (select 1 from analytics.cube)`, { n: DEMO }) === '1' : false;
if (!seeded) console.warn('SKIPPED dashboard.int.test.ts: the local stack is not running or the demo insights are not loaded. Run `bash supabase/scripts/seed-demo-insights.sh`, then this test, then `--remove`.');
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

describe.skipIf(!seeded)('the vendor dashboard against the real stack with the demo insights', () => {
  const run = randomUUID().slice(0, 8);
  const email = { vic: `dash-${run}-vic@example.test`, ann: `dash-${run}-ann@example.test` };
  const pw = randomBytes(12).toString('base64url');
  const mailIds: string[] = [];
  const ids: string[] = [];
  let vic: SupabaseClient; let ann: SupabaseClient; let calls = 0;
  let unlock: (() => void) | undefined;
  // the same client, counting every insight call it makes
  const counted = () => ({ schema: (s: string) => ({ rpc: (fn: string, a?: Record<string, unknown>) => { calls++; return vic.schema(s).rpc(fn, a); } }) }) as unknown as SupabaseClient;

  beforeAll(async () => {
    unlock = await lockStack();
    vic = await provisionUser(stack!, email.vic, pw, mailIds);
    ann = await provisionUser(stack!, email.ann, pw, mailIds);
    await makeReady(ann, 'IN');
    for (const c of [vic, ann]) ids.push((await c.auth.getUser()).data.user!.id);
    sql(`update app.profiles set role = 'vendor' where id = :'u'; insert into catalog.vendor_members (vendor_id, user_id) select id, :'u' from catalog.vendors where name = :'n'`, { u: ids[0]!, n: DEMO });
    expect(await acceptVendorAgreement(vic)).toEqual({ ok: true });
  });
  afterAll(async () => {
    try { for (const u of ids) sql(`delete from ops.vendor_query_log where user_id = :'u'`, { u }); await cleanup(stack!, Object.values(email), mailIds); } finally { unlock?.(); }
  });

  it('shows the vendor its own name (the WO-0112 grant) and not another column or vendor', async () => {
    expect(await ownVendor(vic)).toEqual({ id: expect.any(String), name: DEMO });
  });

  it('the first render is six calls and shows visible segments only: the cohort, the options, Tops, the trends and a spectrum', async () => {
    const s = INITIAL; const base: Base = {};
    const c = counted();
    const [header, mix, trends, spectrum] = await Promise.all([loadHeader(c), loadMix(c, s, base), loadTrends(c, s, base), loadSpectrum(c, s)]);
    expect(calls).toBe(6);
    expect(header.coverage).toEqual({ ok: true, data: { users_rounded: 150, last_run_at: expect.any(String) } });
    expect(header.options.ok && new Set(header.options.data.map((o) => o.filter_dim))).toEqual(new Set(['size', 'season', 'price_band', 'region']));
    if (!mix.ok) throw new Error('mix failed');
    expect(mix.data.find((r) => r.segment === 'Tops')?.value).toBeGreaterThanOrEqual(10);
    expect(mix.data.map((r) => r.segment)).not.toEqual(expect.arrayContaining(['Activewear']));   // 7 owners: hidden, so not even listed without a filter
    expect(mix.data.every((r) => r.value !== null && r.value % 5 === 0)).toBe(true);
    for (const t of [trends.purchase, trends.wishlist]) expect(t.ok && t.data.segments.length > 0 && t.data.periods.length > 0).toBe(true);
    expect(spectrum.ok && spectrum.data.filter((b) => b.share !== null).length).toBeGreaterThanOrEqual(2);
  });

  it('a filter hides segments as null and every shown figure is still a multiple of 5', async () => {
    const options = await loadHeader(vic);
    if (!options.options.ok) throw new Error('options failed');
    const base: Base = {};
    await loadMix(vic, INITIAL, base);
    let hidden = 0;
    for (const o of options.options.data.filter((x) => x.filter_dim === 'price_band' || x.filter_dim === 'season').slice(0, 6)) {
      const r = await loadMix(vic, { ...INITIAL, filter: { dim: o.filter_dim as 'season', value: o.filter_value } }, base);
      if (!r.ok) throw new Error('filtered mix failed');
      hidden += r.data.filter((x) => x.value === null).length;
      expect(r.data.every((x) => x.value === null || x.value % 5 === 0)).toBe(true);
    }
    expect(hidden).toBeGreaterThan(0);
  });

  it('a consumer is refused by every view', async () => {
    const forbidden = { ok: false, kind: 'forbidden', message: INSIGHT_SENTENCES.forbidden };
    const h = await loadHeader(ann); const base: Base = {};
    const t = await loadTrends(ann, INITIAL, base);
    expect([h.coverage, h.options, await loadMix(ann, INITIAL, base), t.purchase, t.wishlist, await loadSpectrum(ann, INITIAL)]).toEqual(Array(6).fill(forbidden));
  });
});
