import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteRateWindows } from '../../test-support/ops-rows';
import { adminFor } from '../../test-support/purge';
import { cleanup, discover, lockStack, makeReady, newClient, provisionUser, sql } from '../../test-support/stack';
import { createSource, decideReview, takeDownSource, updateSource } from './admin-catalog';
import { GET as sourcesGet, PATCH as sourcesPatch, POST as sourcesPost } from '../../app/api/admin/sources/route';
import { POST as takedownPost } from '../../app/api/admin/sources/[id]/takedown/route';
import { GET as reviewGet, POST as reviewPost } from '../../app/api/admin/catalog/review/route';

// WO-0088 / CC9 against the REAL local stack: the three admin routes (the real route modules; only the cookie-reading session factory is replaced by the test's signed-in
// client, which is what it returns for a browser), the real secret-key client, the real audit writer and take-down function. Throwaway users; admin role set by SQL.
let current: SupabaseClient;
vi.mock('../supabase/server', () => ({ createServerSupabase: async () => current }));
const stack = discover();
if (!stack) console.warn('SKIPPED admin-catalog.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
const KEY_VARIABLE = ['SUPABASE', 'SECRET', 'KEY'].join('_');
const ORIGIN = 'http://127.0.0.1:3000';
/** The parts of an answer these tests read; every field is checked where it is used. */
interface Answer { error: { code: string }; sources: { id: number }[]; items: { id: string; sku: string }[]; source: Record<string, unknown>; deleted: number; id: string; status: string }

describe.skipIf(!stack)('admin catalogue routes against the real stack', () => {
  const run = randomUUID().slice(0, 8);
  const email = { admin: `it-${run}-adm@example.test`, ann: `it-${run}-ann@example.test`, vic: `it-${run}-vic@example.test` };
  const pw = randomBytes(12).toString('base64url');
  const mailIds: string[] = [];
  const who = {} as Record<'admin' | 'ann' | 'vic' | 'anon', SupabaseClient>;
  const ids = { admin: '' };
  let unlock: (() => void) | undefined;
  let srcA = 0; let srcB = 0;                              // fixtures: A allowed with 3 items, B not allowed
  const q = (text: string, vars: Record<string, string> = {}) => sql(text, vars);
  const audit = () => q(`select coalesce(string_agg(action || '|' || coalesce(target, '-'), ',' order by id), '') from ops.admin_audit_log where admin_id = :'a'`, { a: ids.admin });
  const auditCount = () => Number(q(`select count(*) from ops.admin_audit_log where admin_id = :'a'`, { a: ids.admin }));
  const call = async (as: keyof typeof who, fn: (r: Request) => Promise<Response>, method: string, body?: unknown, headers: Record<string, string> = {}, path = '/api/admin/x') => {
    current = who[as];
    const res = await fn(new Request(`${ORIGIN}${path}`, { method, headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, json: (await res.json().catch(() => null)) as Answer | null };
  };
  const takedown = (as: keyof typeof who, id: string, body?: unknown) => { current = who[as]; return takedownPost(new Request(`${ORIGIN}/api/admin/sources/${id}/takedown`, { method: 'POST', headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin' }, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve({ id }) }).then(async (r) => ({ status: r.status, json: (await r.json()) as Answer })); };
  const GOOD = { name: `IT shop ${run}`, site_url: 'https://shop.example.test/', robots_allowed: true, terms_note: 'Terms read; feed allowed.', checked_on: '2026-11-10' };
  const item = (source: number, sku: string, status: string, category = 'null', sub = 'null') => `insert into catalog.catalog_items (source_id, sku, name, product_url, status, category, sub_type) values (${source}, '${run}-${sku}', 'IT ${sku}', 'http://127.0.0.1/${sku}', '${status}', ${category}, ${sub});`;

  beforeAll(async () => {
    unlock = await lockStack();
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', stack!.url); vi.stubEnv(KEY_VARIABLE, stack!.secret);
    who.anon = newClient(stack!);
    who.admin = await provisionUser(stack!, email.admin, pw, mailIds);
    who.ann = await provisionUser(stack!, email.ann, pw, mailIds);
    who.vic = await provisionUser(stack!, email.vic, pw, mailIds);
    await makeReady(who.ann, 'IN');
    ids.admin = (await who.admin.auth.getUser()).data.user!.id;
    q(`update app.profiles set role = 'admin' where id = :'a'; update app.profiles set role = 'vendor' where id = :'v'`, { a: ids.admin, v: (await who.vic.auth.getUser()).data.user!.id });
    const out = q(`with a as (insert into catalog.sources (name, site_url, robots_allowed, terms_note, allowed, checked_on) values ('IT-A-${run}', 'https://a.example.test/', true, 'ok', true, current_date) returning id),
      b as (insert into catalog.sources (name, site_url, robots_allowed, terms_note, allowed, checked_on) values ('IT-B-${run}', 'https://b.example.test/', false, '', false, current_date) returning id) select (select id from a) || ',' || (select id from b);`);
    [srcA, srcB] = out.split(',').map(Number) as [number, number];
    q(`${item(srcA, 'a1', 'active', "'Tops'", "'T-shirt'")}${item(srcA, 'a2', 'review')}${item(srcA, 'a3', 'review')}${item(srcA, 'a4', 'withdrawn')}${item(srcB, 'b1', 'review')}`);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    try {
      q(`delete from ops.admin_audit_log where admin_id = :'a'; delete from catalog.sources where name like :'p'`, { a: ids.admin, p: `IT%${run}%` });
      await cleanup(stack!, Object.values(email), mailIds);
    } finally { try { deleteRateWindows([`admin:${ids.admin}`]); } finally { unlock?.(); } }   // the shared limit counted the admin's calls in the bucket named after the admin
  });

  const MATRIX: [string, (as: keyof typeof who) => Promise<{ status: number }>][] = [
    ['GET sources', (as) => call(as, sourcesGet, 'GET')], ['POST sources', (as) => call(as, sourcesPost, 'POST', GOOD)], ['PATCH sources', (as) => call(as, sourcesPatch, 'PATCH', { id: srcB, name: 'Hijack' })],
    ['POST takedown', (as) => takedown(as, String(srcA))], ['GET review', (as) => call(as, reviewGet, 'GET')],
    ['POST review', (as) => call(as, reviewPost, 'POST', { id: '00000000-0000-4000-8000-000000000001', decision: 'withdraw' })],
  ];
  it.each(MATRIX)('%s: no session gives 401, a consumer and a vendor give 403, and nothing is written or changed', async (_n, go) => {
    expect((await go('anon')).status).toBe(401);
    expect((await go('ann')).status).toBe(403);
    expect((await go('vic')).status).toBe(403);
    expect(auditCount()).toBe(0);
    expect(q(`select count(*) from catalog.sources where name in ('Hijack', :'n')`, { n: GOOD.name })).toBe('0');
    expect(q(`select count(*) from catalog.catalog_items where source_id = ${srcA}`)).toBe('4');
  });

  it('a mutating request from another origin, or without origin evidence, is refused even for the admin; a read needs none', async () => {
    expect((await call('admin', sourcesPost, 'POST', GOOD, { origin: 'http://evil.example.test' })).status).toBe(403);
    expect((await call('admin', sourcesPost, 'POST', GOOD, { origin: '', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await call('admin', reviewPost, 'POST', { id: randomUUID(), decision: 'withdraw' }, { origin: 'http://evil.example.test' })).status).toBe(403);
    expect(auditCount()).toBe(0);
    expect((await call('admin', sourcesGet, 'GET', undefined, { origin: 'http://evil.example.test' })).status).toBe(200);
    q(`delete from ops.admin_audit_log where admin_id = :'a'`, { a: ids.admin });
  });

  it('an admin lists the register; the call writes one audit row with the admin, the action and no target', async () => {
    const r = await call('admin', sourcesGet, 'GET');
    expect(r.status).toBe(200);
    expect((r.json!.sources as { id: number }[]).map((s) => s.id)).toEqual(expect.arrayContaining([srcA, srcB]));
    expect(audit()).toBe('source.list|-');
    q(`delete from ops.admin_audit_log where admin_id = :'a'`, { a: ids.admin });
  });

  it('create: a payload that is not valid gives 400 with the fixed text, echoes nothing and writes no audit row', async () => {
    const hostile = 'ZZ-hostile-text-ZZ';
    for (const body of [{ ...GOOD, site_url: 'http://shop.example.test/' }, { ...GOOD, checked_on: '2999-01-01' }, { ...GOOD, checked_on: undefined }, { ...GOOD, name: ' ' }, { ...GOOD, extra: hostile }, { ...GOOD, terms_note: 'x'.repeat(1001) }, [hostile], hostile]) {
      const r = await call('admin', sourcesPost, 'POST', body);
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ error: { code: 'bad_request', message: 'The request is not valid.' } });
    }
    expect((await call('admin', sourcesPost, 'POST', undefined)).status).toBe(400);
    current = who.admin;
    const raw = await sourcesPost(new Request(`${ORIGIN}/api/admin/sources`, { method: 'POST', headers: { origin: ORIGIN }, body: '{"name": ' }));
    expect(raw.status).toBe(400);
    expect(auditCount()).toBe(0);
  });

  it('create: allowed true is refused unless robots allow it and the terms note and check date are present; a valid source is stored, with one audit row', async () => {
    for (const body of [{ ...GOOD, allowed: true, robots_allowed: false }, { ...GOOD, allowed: true, terms_note: '   ' }]) {
      const r = await call('admin', sourcesPost, 'POST', body);
      expect(r.status).toBe(422); expect(r.json!.error.code).toBe('allow_refused');
    }
    expect((await call('admin', sourcesPost, 'POST', { ...GOOD, allowed: true, checked_on: undefined })).status).toBe(400);
    expect(auditCount()).toBe(0);
    expect(q(`select count(*) from catalog.sources where name = :'n'`, { n: GOOD.name })).toBe('0');
    const made = await call('admin', sourcesPost, 'POST', { ...GOOD, name: `IT make ${run}`, allowed: true, contact: 'desk@example.test' });
    expect(made.status).toBe(200);
    expect(made.json!.source).toMatchObject({ name: `IT make ${run}`, allowed: true, robots_allowed: true, contact: 'desk@example.test', takedown_at: null });
    expect(audit()).toBe('source.create|-');
    const plain = await call('admin', sourcesPost, 'POST', { ...GOOD, name: `IT plain ${run}` });
    expect(plain.json!.source).toMatchObject({ allowed: false, contact: null });
    expect(audit()).toBe('source.create|-,source.create|-');
    q(`delete from ops.admin_audit_log where admin_id = :'a'`, { a: ids.admin });
  });

  it('update: allowed true needs the three checks (against what is stored plus what is sent); a valid update changes the row and writes one audit row with the id', async () => {
    const no = await call('admin', sourcesPatch, 'PATCH', { id: srcB, allowed: true });
    expect(no.status).toBe(422); expect(no.json!.error.code).toBe('allow_refused');
    expect((await call('admin', sourcesPatch, 'PATCH', { id: srcB, allowed: true, robots_allowed: true })).status).toBe(422);        // terms note still blank
    expect((await call('admin', sourcesPatch, 'PATCH', { id: srcA, robots_allowed: false })).status).toBe(422);                       // would leave an allowed source without robots
    expect(q(`select allowed::text || robots_allowed::text from catalog.sources where id = ${srcB}`)).toBe('falsefalse');
    expect(q(`select robots_allowed from catalog.sources where id = ${srcA}`)).toBe('t');
    expect(auditCount()).toBe(0);
    const ok = await call('admin', sourcesPatch, 'PATCH', { id: srcB, allowed: true, robots_allowed: true, terms_note: 'Read and recorded.' });
    expect(ok.status).toBe(200);
    expect(q(`select allowed::text || robots_allowed::text || terms_note from catalog.sources where id = ${srcB}`)).toBe('truetrueRead and recorded.');
    expect(audit()).toBe(`source.update|${srcB}`);
    expect((await call('admin', sourcesPatch, 'PATCH', { id: srcB, allowed: false, name: `IT-B-${run}` })).status).toBe(200);
    expect((await call('admin', sourcesPatch, 'PATCH', { id: 2147483000, name: 'x' })).json!.error.code).toBe('source_not_found');
    for (const body of [{ id: srcB }, { name: 'x' }, { id: srcB, takedown_at: null }, { id: 'x', name: 'y' }]) expect((await call('admin', sourcesPatch, 'PATCH', body)).status).toBe(400);
    q(`delete from ops.admin_audit_log where admin_id = :'a'`, { a: ids.admin });
  });

  it('take-down: the items go, the source row stays with allowed false, the note and the time; one audit row; a re-allow clears takedown_at in the same update', async () => {
    expect((await takedown('admin', 'abc')).status).toBe(400);
    expect((await takedown('admin', String(srcA), { note: 'n'.repeat(501) })).status).toBe(400);
    expect((await takedown('admin', String(srcA), { note: 'ok', extra: 1 })).status).toBe(400);
    expect(auditCount()).toBe(0);
    const r = await takedown('admin', String(srcA), { note: 'Asked by the rights holder.' });
    expect(r.status).toBe(200); expect(r.json.deleted).toBe(4);
    expect(q(`select allowed::text || (takedown_at is not null)::text || takedown_note from catalog.sources where id = ${srcA}`)).toBe('falsetrueAsked by the rights holder.');
    expect(q(`select count(*) from catalog.catalog_items where source_id = ${srcA}`)).toBe('0');
    expect(audit()).toBe(`source.takedown|${srcA}`);
    expect((await takedown('admin', '2147483000')).json.error.code).toBe('source_not_found');
    expect((await takedown('admin', String(srcA))).json.deleted).toBe(0);                                                              // repeating it is harmless
    const back = await call('admin', sourcesPatch, 'PATCH', { id: srcA, allowed: true });
    expect(back.status).toBe(200);
    expect(q(`select allowed::text || (takedown_at is null)::text from catalog.sources where id = ${srcA}`)).toBe('truetrue');
    expect(audit().split(',').pop()).toBe(`source.reallow|${srcA}`);
    q(`delete from ops.admin_audit_log where admin_id = :'a'`, { a: ids.admin });
  });

  it('review: the queue shows review rows only; active needs a category and sub-type pair of the taxonomy; withdraw sets withdrawn; other rows are untouched; one audit row each', async () => {
    q(`${item(srcB, 'r1', 'review')}${item(srcB, 'r2', 'review')}${item(srcB, 'r3', 'active', "'Tops'", "'Shirt'")}`);
    const list = await call('admin', reviewGet, 'GET');
    const mine = (list.json!.items as { id: string; sku: string; name: string; status?: string }[]).filter((i) => i.sku.startsWith(`${run}-`)).map((i) => i.sku).sort();
    expect(mine).toEqual([`${run}-b1`, `${run}-r1`, `${run}-r2`]);
    expect(audit()).toBe('catalog.review.list|-');
    const idOf = (sku: string) => q(`select id from catalog.catalog_items where sku = :'s'`, { s: `${run}-${sku}` });
    for (const body of [{ id: idOf('r1'), decision: 'activate', category: 'Tops', sub_type: 'Jeans' }, { id: idOf('r1'), decision: 'activate', category: 'Hats', sub_type: 'T-shirt' }, { id: idOf('r1'), decision: 'activate' },
      { id: idOf('r1'), decision: 'delete' }, { id: 'r1', decision: 'withdraw' }, { id: idOf('r1'), decision: 'withdraw', category: 'Tops' }]) expect((await call('admin', reviewPost, 'POST', body)).status, JSON.stringify(body)).toBe(400);
    expect(q(`select status from catalog.catalog_items where id = :'i'`, { i: idOf('r1') })).toBe('review');
    expect(audit()).toBe('catalog.review.list|-');
    const act = await call('admin', reviewPost, 'POST', { id: idOf('r1'), decision: 'activate', category: 'Tops', sub_type: 'Polo' });
    expect(act.status).toBe(200); expect(act.json).toEqual({ id: idOf('r1'), status: 'active' });
    expect(q(`select status || category || sub_type from catalog.catalog_items where id = :'i'`, { i: idOf('r1') })).toBe('activeTopsPolo');
    expect((await call('admin', reviewPost, 'POST', { id: idOf('r2'), decision: 'withdraw' })).status).toBe(200);
    expect(q(`select status from catalog.catalog_items where id = :'i'`, { i: idOf('r2') })).toBe('withdrawn');
    expect((await call('admin', reviewPost, 'POST', { id: idOf('r3'), decision: 'withdraw' })).json!.error.code).toBe('item_not_found');   // an active row is not in the queue
    expect(q(`select status from catalog.catalog_items where id = :'i'`, { i: idOf('r3') })).toBe('active');
    expect((await call('admin', reviewPost, 'POST', { id: idOf('r1'), decision: 'withdraw' })).status).toBe(404);                         // r1 is active now
    expect(audit()).toBe(`catalog.review.list|-,catalog.review.activate|${idOf('r1')},catalog.review.withdraw|${idOf('r2')},catalog.review.withdraw|${idOf('r3')},catalog.review.withdraw|${idOf('r1')}`);
  });

  it('every audit row of the run is an id or nothing as target, a lower-case dotted action, and the admin\'s own id', () => {
    const rows = q(`select action || '|' || coalesce(target, '') from ops.admin_audit_log where admin_id = :'a'`, { a: ids.admin }).split('\n').filter(Boolean);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) { const [a, t] = r.split('|') as [string, string]; expect(a).toMatch(/^[a-z]+(\.[a-z]+)+$/); expect(t).toMatch(/^([0-9]+|[0-9a-f-]{36}|)$/); }
    expect(q(`select count(*) from ops.admin_audit_log where admin_id <> :'a' and action like 'source.%'`, { a: ids.admin })).toBe('0');
  });

  it('when the audit row cannot be written, no mutating call does anything: 500 and the database is as it was', async () => {
    const real = adminFor(stack!);
    const broken = { schema: (s: string) => (s === 'app' ? { rpc: async () => ({ data: null, error: { code: 'XX000' } }) } : real.schema(s as 'catalog')) } as unknown as SupabaseClient;
    const d = { caller: who.admin, admin: broken };
    const req = (body?: unknown) => new Request(`${ORIGIN}/api/admin/x`, { method: 'POST', headers: { origin: ORIGIN }, body: body === undefined ? undefined : JSON.stringify(body) });
    const b1 = q(`select id from catalog.catalog_items where sku = :'s'`, { s: `${run}-b1` });
    const before = q(`select (select count(*) from catalog.sources where name = 'IT never ${run}') || '/' || (select name from catalog.sources where id = ${srcB}) || '/' || (select count(*) from catalog.catalog_items where source_id = ${srcB}) || '/' || (select status from catalog.catalog_items where id = '${b1}') || '/' || (select takedown_at is null from catalog.sources where id = ${srcB})`);
    expect((await createSource(req({ ...GOOD, name: `IT never ${run}` }), d)).status).toBe(500);
    expect((await updateSource(req({ id: srcB, name: `IT renamed ${run}` }), d)).status).toBe(500);
    expect((await takeDownSource(req({}), d, String(srcB))).status).toBe(500);
    expect((await decideReview(req({ id: b1, decision: 'withdraw' }), d)).status).toBe(500);
    expect(q(`select (select count(*) from catalog.sources where name = 'IT never ${run}') || '/' || (select name from catalog.sources where id = ${srcB}) || '/' || (select count(*) from catalog.catalog_items where source_id = ${srcB}) || '/' || (select status from catalog.catalog_items where id = '${b1}') || '/' || (select takedown_at is null from catalog.sources where id = ${srcB})`)).toBe(before);
  });

  it('with the backend set to local the routes answer 404 and with no secret key 503', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'local');
    try { expect((await call('admin', sourcesGet, 'GET')).status).toBe(404); } finally { vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase'); }
    vi.stubEnv(KEY_VARIABLE, '');
    try { expect((await call('admin', sourcesGet, 'GET')).status).toBe(503); } finally { vi.stubEnv(KEY_VARIABLE, stack!.secret); }
  });
});
