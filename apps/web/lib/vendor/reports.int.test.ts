import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, discover, lockStack, makeReady, provisionUser, sql } from '../../test-support/stack';
import { acceptVendorAgreement } from './access';
import type { Base } from './dashboard';
import { loadGaps } from './gaps';
import { INSIGHT_SENTENCES, filterOptions, reports } from './insights';
import { openReport, parsePayload } from './reports';

// WO-0106 smoke test against the REAL local stack after `bash supabase/scripts/seed-demo-insights.sh` (never run by a gate, so without it this file is skipped): a throwaway vendor user
// (role and membership of the seeded demo vendor set by SQL as postgres, deleted afterwards) reads the gaps and the reports with its own session.
const stack = discover();
const DEMO = 'H&M';   // WO-0122: the demo's only vendor
const seeded = stack ? sql(`select count(*) from catalog.vendors v where v.name = :'n' and exists (select 1 from analytics.cube) and exists (select 1 from ops.reports where reviewed_at is not null)`, { n: DEMO }) === '1' : false;
if (!seeded) console.warn('SKIPPED reports.int.test.ts: the local stack is not running or the demo insights are not loaded. Run `bash supabase/scripts/seed-demo-insights.sh`, then this test, then `--remove`.');
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

describe.skipIf(!seeded)('the vendor gaps and reports against the real stack with the demo insights', () => {
  const run = randomUUID().slice(0, 8);
  const email = { vic: `gaps-${run}-vic@example.test`, ann: `gaps-${run}-ann@example.test` };
  const pw = randomBytes(12).toString('base64url');
  const mailIds: string[] = [];
  const ids: string[] = [];
  let vic: SupabaseClient; let ann: SupabaseClient; let unreviewed = ''; let unlock: (() => void) | undefined;

  beforeAll(async () => {
    unlock = await lockStack();
    vic = await provisionUser(stack!, email.vic, pw, mailIds);
    ann = await provisionUser(stack!, email.ann, pw, mailIds);
    await makeReady(ann, 'IN');
    for (const c of [vic, ann]) ids.push((await c.auth.getUser()).data.user!.id);
    sql(`update app.profiles set role = 'vendor' where id = :'u'; insert into catalog.vendor_members (vendor_id, user_id) select id, :'u' from catalog.vendors where name = :'n'`, { u: ids[0]!, n: DEMO });
    expect(await acceptVendorAgreement(vic)).toEqual({ ok: true });
    unreviewed = sql(`with r as (insert into ops.reports (period, payload) select (period - interval '1 month')::date, payload from ops.reports where reviewed_at is not null limit 1 returning id) select id from r`);
  });
  afterAll(async () => {
    try {
      if (unreviewed) sql(`delete from ops.reports where id = :'r'`, { r: unreviewed });
      for (const u of ids) sql(`delete from ops.vendor_query_log where user_id = :'u'`, { u });
      await cleanup(stack!, Object.values(email), mailIds);
    } finally { unlock?.(); }
  });

  it('lists the reviewed report and not the unreviewed one, and opens the reviewed one with a payload of the right shape', async () => {
    const list = await reports(vic);
    if (!list.ok) throw new Error('reports failed');
    expect(list.data.length).toBeGreaterThanOrEqual(1);
    expect(list.data.map((r) => r.id)).not.toContain(unreviewed);
    const one = await openReport(vic, list.data[0]!.id);
    if (!one.ok || !one.data) throw new Error('the reviewed report did not open');
    const p = parsePayload(one.data.payload);
    expect(p?.coverage.users_rounded).toBe(150);
    expect(p!.gaps.length).toBeGreaterThan(0);
    expect(p!.condition_spectrum.length).toBeGreaterThan(0);
    expect([...p!.gaps.flatMap((g) => [g.owner_users_rounded, g.wishlist_users_rounded]), ...p!.rising_wishlist.flatMap((r) => [r.users_rounded, r.increase])].every((n) => n === null || n % 5 === 0)).toBe(true);
  });
  it('an unreviewed report, an unknown uuid and a malformed id are all "no report"; the malformed id is never sent', async () => {
    expect(await openReport(vic, unreviewed)).toEqual({ ok: true, data: null });
    expect(await openReport(vic, randomUUID())).toEqual({ ok: true, data: null });
    const logged = () => sql(`select count(*) from ops.vendor_query_log where user_id = :'u' and fn = 'report'`, { u: ids[0]! });
    const before = logged();
    expect(await openReport(vic, 'not-a-uuid')).toEqual({ ok: true, data: null });
    expect(logged()).toBe(before);
  });
  it('ranks the gaps with "no visible ownership" after every scored row, and a filter hides segments as a list of names', async () => {
    const base: Base = {};
    const r = await loadGaps(vic, 'category_colour_family', null, base);
    if (!r.ok) throw new Error('gaps failed');
    const scored = r.data.rows.filter((x) => x.gap_score !== null);
    expect(scored.length).toBeGreaterThan(0);
    expect(r.data.rows.slice(scored.length).every((x) => x.gap_score === null && x.label === 'no visible ownership' && x.owner_users_rounded === null)).toBe(true);
    expect(scored.map((x) => x.gap_score)).toEqual([...scored.map((x) => x.gap_score)].sort((a, b) => b! - a!));
    const options = await filterOptions(vic);
    if (!options.ok) throw new Error('options failed');
    let hidden = 0;
    for (const o of options.data.filter((x) => x.filter_dim === 'season' || x.filter_dim === 'price_band').slice(0, 6)) {
      const f = await loadGaps(vic, 'category_colour_family', { dim: o.filter_dim as 'season', value: o.filter_value }, base);
      if (!f.ok) throw new Error('filtered gaps failed');
      hidden += f.data.hidden.length;
    }
    expect(hidden).toBeGreaterThan(0);
  });
  it('a consumer is refused by the gaps and the reports', async () => {
    const forbidden = { ok: false, kind: 'forbidden', message: INSIGHT_SENTENCES.forbidden };
    expect(await loadGaps(ann, 'category', null, {})).toEqual(forbidden);
    expect(await reports(ann)).toEqual(forbidden);
    expect(await openReport(ann, unreviewed)).toEqual(forbidden);
  });
});
