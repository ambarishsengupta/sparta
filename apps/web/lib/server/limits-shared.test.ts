import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BucketApi, StorageLike } from './api';
import { ADMIN_BRAKE, ADMIN_LIMIT, listSources } from './admin-catalog';
import { handlePurge, PURGE_BRAKE, PURGE_LIMIT, type Caller } from './purge';
import { handleSignedUrls, WORKER_BUDGET, workerCounter, workerLimiters, type JobRow } from './signed-urls';
import { makeLimiter, RateCountUnavailable, rateRpcOf, routeLimit, sharedCounter, type RateRpc } from './limits';

// WO-0130 part 2: the shared (database) count. The fake below stands for the database function app.rate_limit_hit: it is the ONLY thing the
// "instances" in these tests share, exactly as two server processes share only the database. (The function itself is tested in 023_wo0130_shared_rate_limit.test.sql.)
function fakeDatabase() {
  const hits = new Map<string, number>();
  const asked: string[] = [];
  const rpc: RateRpc = async (bucket, max) => { asked.push(bucket); const n = (hits.get(bucket) ?? 0) + 1; hits.set(bucket, n); return { data: n <= max, error: null }; };
  return { rpc, hits, asked };
}
const code = async (r: Response) => ((await r.clone().json()) as { error?: { code: string } }).error?.code;
const BEARER = 'k'.repeat(40);
const UID = '11111111-1111-4111-8111-111111111111';

describe('sharedCounter: true within the limit, false over it, and it THROWS when the count can not be read (fail closed)', () => {
  it('passes the bucket, limit and window on, and answers the database verdict', async () => {
    const seen: unknown[][] = [];
    const count = sharedCounter(async (...a) => { seen.push(a); return { data: seen.length <= 2, error: null }; }, { max: 2, windowSeconds: 60 });
    expect([await count('b.one'), await count('b.one'), await count('b.one')]).toEqual([true, true, false]);
    expect(seen[0]).toEqual(['b.one', 2, 60]);
  });
  it.each([
    ['the database answers with an error', async () => ({ data: null, error: { code: '57P01' } })],
    ['the call rejects (network down)', async () => { throw new TypeError('fetch failed'); }],
    ['the answer is not true or false (null)', async () => ({ data: null, error: null })],
    ['the answer is a truthy string', async () => ({ data: 'true', error: null })],
    ['the answer is a number', async () => ({ data: 1, error: null })],
  ] as [string, RateRpc][])('%s: it throws RateCountUnavailable, it never answers "allowed"', async (_n, rpc) => {
    await expect(sharedCounter(rpc, { max: 5, windowSeconds: 60 })('b.one')).rejects.toBeInstanceOf(RateCountUnavailable);
  });
  it('rateRpcOf calls app.rate_limit_hit with the three named arguments', async () => {
    const calls: unknown[] = [];
    const admin = { schema: (s: string) => ({ rpc: async (fn: string, args: unknown) => { calls.push([s, fn, args]); return { data: true, error: null }; } }) } as unknown as Pick<SupabaseClient, 'schema'>;
    await rateRpcOf(admin as never)('purge:x', 6, 600);
    expect(calls).toEqual([['app', 'rate_limit_hit', { p_bucket: 'purge:x', p_max: 6, p_window_seconds: 600 }]]);
  });
});

/** One worker "instance": its own per-process limiters, the shared count through `rpc`, and the real handler. */
function workerInstance(rpc: RateRpc, lookups: number[] = []) {
  const local = workerLimiters(); const count = workerCounter(rpc);
  const storage: StorageLike = { from: (): BucketApi => ({ createSignedUrl: async () => ({ data: { signedUrl: 'http://s.test/x' }, error: null }), createSignedUploadUrl: async () => ({ data: { signedUrl: 'http://s.test/y' }, error: null }), list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }) };
  return (token: string = BEARER) => handleSignedUrls(
    new Request('http://web.test/api/worker/signed-urls', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ job_id: 7 }) }),
    { bearer: BEARER, allow: local.allow, allowFailure: local.allowFailure, count, storage, lookupJob: async (id): Promise<JobRow | null> => { lookups.push(id); return null; } });
}
describe('the worker budgets hold across two handler instances that share only the database', () => {
  it('120 correct calls spread over two instances use up the one budget; the 121st is 429 on either instance and looks nothing up', async () => {
    const db = fakeDatabase(); const lookups: number[] = [];
    const [one, two] = [workerInstance(db.rpc, lookups), workerInstance(db.rpc, lookups)];
    for (let i = 0; i < WORKER_BUDGET.calls; i++) expect(await code(await (i % 2 === 0 ? one : two)())).toBe('job_not_found');
    expect(lookups.length).toBe(WORKER_BUDGET.calls);
    expect(await code(await one())).toBe('rate_limited');
    expect(await code(await two())).toBe('rate_limited');
    expect(lookups.length).toBe(WORKER_BUDGET.calls);
    expect(db.hits.get('worker.ok')).toBe(WORKER_BUDGET.calls + 2);
  });
  it('the failure budget is shared as well (30 wrong tokens over two instances), is a separate bucket, and does not use up the correct calls', async () => {
    const db = fakeDatabase();
    const [one, two] = [workerInstance(db.rpc), workerInstance(db.rpc)];
    const wrong = 'z'.repeat(40);
    for (let i = 0; i < WORKER_BUDGET.failures; i++) expect(await code(await (i % 2 === 0 ? one : two)(wrong))).toBe('unauthorised');
    expect(await code(await one(wrong))).toBe('rate_limited');
    expect(await code(await two(wrong))).toBe('rate_limited');
    expect(await code(await two())).toBe('job_not_found');
    expect([...db.hits.keys()].sort()).toEqual(['worker.fail', 'worker.ok']);
  });
  it('the per-process limiter is the first brake: a call it refuses never reaches the database', async () => {
    const db = fakeDatabase();
    const tiny = { allow: makeLimiter(1, 60_000), allowFailure: makeLimiter(1, 60_000) };
    const storage = { from: () => { throw new Error('unused'); } } as unknown as StorageLike;
    const call = () => handleSignedUrls(new Request('http://web.test/x', { method: 'POST', headers: { authorization: `Bearer ${BEARER}` }, body: JSON.stringify({ job_id: 7 }) }),
      { bearer: BEARER, ...tiny, count: workerCounter(db.rpc), storage, lookupJob: async () => null });
    expect([await code(await call()), await code(await call()), await code(await call())]).toEqual(['job_not_found', 'rate_limited', 'rate_limited']);
    expect(db.asked).toEqual(['worker.ok']);
  });
  it('fail closed: when the count can not be read the worker answers 503 and looks nothing up, with a right token and with a wrong one', async () => {
    const lookups: number[] = [];
    const down = workerInstance(async () => ({ data: null, error: { code: '08006' } }), lookups);
    const right = await down(); const wrong = await down('z'.repeat(40));
    expect([right.status, await code(right), wrong.status, await code(wrong)]).toEqual([503, 'unavailable', 503, 'unavailable']);
    expect(lookups).toEqual([]);
  });
});

function purgeWorld(db: ReturnType<typeof fakeDatabase>) {
  const caller: Caller = {
    auth: { getUser: async () => ({ data: { user: { id: UID } }, error: null }) },
    schema: () => ({ rpc: async () => ({ data: true, error: null }) }),
  };
  const removals: string[] = [];
  const storage: StorageLike = { from: (b): BucketApi => ({ createSignedUrl: async () => ({ data: null, error: null }), createSignedUploadUrl: async () => ({ data: null, error: null }), list: async () => ({ data: [], error: null }), remove: async (p) => { removals.push(`${b}:${p.length}`); return { data: [], error: null }; } }) };
  const req = () => new Request('https://app.test/api/account/purge-storage', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });
  const instance = (rpc: RateRpc = db.rpc) => { const limit = routeLimit(makeLimiter(1000, 60_000), rpc, PURGE_LIMIT); return () => handlePurge(req(), { caller, storage, limit }); };
  return { instance, removals };
}
describe('the purge route: the limit holds across two handler instances, per person, and fails closed', () => {
  it(`${PURGE_LIMIT.max} purges over two instances use up the person's limit; the next is 429 on either instance and the bucket is that person's`, async () => {
    const db = fakeDatabase(); const w = purgeWorld(db);
    const [a, b] = [w.instance(), w.instance()];
    for (let i = 0; i < PURGE_LIMIT.max; i++) expect((await (i % 2 === 0 ? a : b)()).status).toBe(200);
    expect(await code(await a())).toBe('rate_limited');
    expect(await code(await b())).toBe('rate_limited');
    expect([...db.hits.keys()]).toEqual([`purge:${UID}`]);
  });
  it('a refused purge removes nothing', async () => {
    const db = fakeDatabase(); const w = purgeWorld(db); const a = w.instance();
    for (let i = 0; i < PURGE_LIMIT.max; i++) await a();
    const before = w.removals.length;
    expect((await a()).status).toBe(429);
    expect(w.removals.length).toBe(before);
  });
  it('the per-process brake comes AFTER identity: a call with no valid user is refused 401 without touching the brake or the database', async () => {
    const db = fakeDatabase(); let braked = 0;
    const caller: Caller = { auth: { getUser: async () => ({ data: { user: null }, error: null }) }, schema: () => ({ rpc: async () => ({ data: true, error: null }) }) };
    const r = await handlePurge(new Request('https://app.test/x', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }),
      { caller, storage: { from: () => { throw new Error('unused'); } } as unknown as StorageLike, limit: routeLimit(() => { braked += 1; return true; }, db.rpc, PURGE_LIMIT) });
    expect(await code(r)).toBe('not_signed_in'); expect(braked).toBe(0); expect(db.asked).toEqual([]);
  });
  it('a flood of calls without a valid user (more than the brake allows) does not stop a real person from purging', async () => {
    const db = fakeDatabase();
    const brake = makeLimiter(PURGE_BRAKE.max, PURGE_BRAKE.windowMs);
    const anon: Caller = { auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no session' } }) }, schema: () => ({ rpc: async () => ({ data: true, error: null }) }) };
    const none = { from: () => { throw new Error('unused'); } } as unknown as StorageLike;
    const req = () => new Request('https://app.test/x', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });
    for (let i = 0; i < PURGE_BRAKE.max * 3; i++) expect((await handlePurge(req(), { caller: anon, storage: none, limit: routeLimit(brake, db.rpc, PURGE_LIMIT) })).status).toBe(401);
    const real = await handlePurge(req(), { caller: { auth: { getUser: async () => ({ data: { user: { id: UID } }, error: null }) }, schema: () => ({ rpc: async () => ({ data: true, error: null }) }) }, storage: { from: (): BucketApi => ({ createSignedUrl: async () => ({ data: null, error: null }), createSignedUploadUrl: async () => ({ data: null, error: null }), list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }) }, limit: routeLimit(brake, db.rpc, PURGE_LIMIT) });
    expect(real.status).toBe(200);
  });
  it('a verified person within their own limit is still refused 429 by the per-process brake, and removes nothing (the person\'s count was asked first)', async () => {
    const db = fakeDatabase(); const w = purgeWorld(db);
    const r = await handlePurge(new Request('https://app.test/x', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }),
      { caller: { auth: { getUser: async () => ({ data: { user: { id: UID } }, error: null }) }, schema: () => ({ rpc: async () => ({ data: true, error: null }) }) }, storage: { from: () => { throw new Error("unused"); } } as unknown as StorageLike, limit: routeLimit(() => false, db.rpc, PURGE_LIMIT) });
    expect(await code(r)).toBe('rate_limited'); expect(db.asked).toEqual([`purge:${UID}`]); expect(w.removals).toEqual([]);
  });
  it('one verified person flooding far past the brake does not lock out a second verified person (calls their own limit refuses use no brake slot)', async () => {
    const db = fakeDatabase();
    const brake = makeLimiter(PURGE_BRAKE.max, PURGE_BRAKE.windowMs);
    const OTHER = '22222222-2222-4222-8222-222222222222';
    const storage: StorageLike = { from: (): BucketApi => ({ createSignedUrl: async () => ({ data: null, error: null }), createSignedUploadUrl: async () => ({ data: null, error: null }), list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }) };
    const as = (id: string): Caller => ({ auth: { getUser: async () => ({ data: { user: { id } }, error: null }) }, schema: () => ({ rpc: async () => ({ data: true, error: null }) }) });
    const call = (id: string) => handlePurge(new Request('https://app.test/x', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }), { caller: as(id), storage, limit: routeLimit(brake, db.rpc, PURGE_LIMIT) });
    const statuses: Record<number, number> = {};
    for (let i = 0; i < 40; i++) { const s = (await call(UID)).status; statuses[s] = (statuses[s] ?? 0) + 1; }
    expect(statuses).toEqual({ 200: PURGE_LIMIT.max, 429: 40 - PURGE_LIMIT.max });
    expect((await call(OTHER)).status).toBe(200);
  });
  it('fail closed: when the count can not be read the purge is 503 and removes nothing', async () => {
    const db = fakeDatabase(); const w = purgeWorld(db);
    const r = await w.instance(async () => ({ data: null, error: { code: '08006' } }))();
    expect([r.status, await code(r)]).toEqual([503, 'unavailable']); expect(w.removals).toEqual([]);
  });
});

function adminWorld(db: ReturnType<typeof fakeDatabase>, role = 'admin') {
  const touched: string[] = [];
  const caller = { auth: { getUser: async () => ({ data: { user: { id: UID } }, error: null }) }, schema: () => ({ rpc: async () => ({ data: role, error: null }) }) } as unknown as SupabaseClient;
  const admin = { schema: () => ({ rpc: async () => { touched.push('audit'); return { data: 1, error: null }; }, from: () => { touched.push('read'); return { select: () => ({ order: async () => ({ data: [], error: null }) }) }; } }) } as unknown as SupabaseClient;
  const instance = (rpc: RateRpc = db.rpc) => { const limit = routeLimit(makeLimiter(1000, 60_000), rpc, ADMIN_LIMIT); return () => listSources(new Request('http://web.test/api/admin/sources'), { caller, admin, limit }); };
  return { instance, touched };
}
describe('the admin routes: the limit holds across two handler instances, per administrator, and fails closed', () => {
  it(`${ADMIN_LIMIT.max} calls over two instances use up the administrator's limit; the next is 429 on either instance`, async () => {
    const db = fakeDatabase(); const w = adminWorld(db);
    const [a, b] = [w.instance(), w.instance()];
    for (let i = 0; i < ADMIN_LIMIT.max; i++) expect((await (i % 2 === 0 ? a : b)()).status).toBe(200);
    expect(await code(await a())).toBe('rate_limited');
    expect(await code(await b())).toBe('rate_limited');
    expect([...db.hits.keys()]).toEqual([`admin:${UID}`]);
  });
  it('a refused call writes no audit row and reads nothing', async () => {
    const db = fakeDatabase(); const w = adminWorld(db); const a = w.instance();
    for (let i = 0; i < ADMIN_LIMIT.max; i++) await a();
    const before = w.touched.length;
    expect((await a()).status).toBe(429);
    expect(w.touched.length).toBe(before);
  });
  it('300 calls with no session, then the real administrator: the administrator is NOT 429 (the brake counts verified administrators only)', async () => {
    const db = fakeDatabase(); const w = adminWorld(db);
    const brake = makeLimiter(ADMIN_BRAKE.max, ADMIN_BRAKE.windowMs);
    const anon = { auth: { getUser: async () => ({ data: { user: null }, error: null }) }, schema: () => ({ rpc: async () => ({ data: 'admin', error: null }) }) } as unknown as SupabaseClient;
    const consumer = { auth: { getUser: async () => ({ data: { user: { id: UID } }, error: null }) }, schema: () => ({ rpc: async () => ({ data: 'consumer', error: null }) }) } as unknown as SupabaseClient;
    const unused = { schema: () => { throw new Error('unused'); } } as unknown as SupabaseClient;
    for (let i = 0; i < ADMIN_BRAKE.max + 50; i++) {
      const caller = i % 2 === 0 ? anon : consumer;
      expect([401, 403]).toContain((await listSources(new Request('http://web.test/api/admin/sources'), { caller, admin: unused, limit: routeLimit(brake, db.rpc, ADMIN_LIMIT) })).status);
    }
    expect(db.asked).toEqual([]);
    const adminCaller = { auth: { getUser: async () => ({ data: { user: { id: UID } }, error: null }) }, schema: () => ({ rpc: async () => ({ data: 'admin', error: null }) }) } as unknown as SupabaseClient;
    const adminClient = { schema: () => ({ rpc: async () => ({ data: 1, error: null }), from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) }) } as unknown as SupabaseClient;
    expect((await listSources(new Request('http://web.test/api/admin/sources'), { caller: adminCaller, admin: adminClient, limit: routeLimit(brake, db.rpc, ADMIN_LIMIT) })).status).toBe(200);
    expect(w.touched).toEqual([]);
  });
  it('once verified, the per-process brake refuses an administrator with 429, after the administrator\'s own count was asked first', async () => {
    const db = fakeDatabase(); const w = adminWorld(db);
    const limit = routeLimit(() => false, db.rpc, ADMIN_LIMIT);
    const caller = { auth: { getUser: async () => ({ data: { user: { id: UID } }, error: null }) }, schema: () => ({ rpc: async () => ({ data: 'admin', error: null }) }) } as unknown as SupabaseClient;
    expect((await listSources(new Request('http://web.test/api/admin/sources'), { caller, admin: {} as SupabaseClient, limit })).status).toBe(429);
    expect(db.asked).toEqual([`admin:${UID}`]); expect(w.touched).toEqual([]);
  });
  it('one verified administrator flooding far past the brake does not lock out a second verified administrator (calls their own limit refuses use no brake slot)', async () => {
    const db = fakeDatabase();
    const brake = makeLimiter(ADMIN_BRAKE.max, ADMIN_BRAKE.windowMs);
    const OTHER = '22222222-2222-4222-8222-222222222222';
    const adminClient = { schema: () => ({ rpc: async () => ({ data: 1, error: null }), from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) }) } as unknown as SupabaseClient;
    const as = (id: string) => ({ auth: { getUser: async () => ({ data: { user: { id } }, error: null }) }, schema: () => ({ rpc: async () => ({ data: 'admin', error: null }) }) }) as unknown as SupabaseClient;
    const call = (id: string) => listSources(new Request('http://web.test/api/admin/sources'), { caller: as(id), admin: adminClient, limit: routeLimit(brake, db.rpc, ADMIN_LIMIT) });
    const statuses: Record<number, number> = {};
    for (let i = 0; i < 400; i++) { const s = (await call(UID)).status; statuses[s] = (statuses[s] ?? 0) + 1; }
    expect(statuses).toEqual({ 200: ADMIN_LIMIT.max, 429: 400 - ADMIN_LIMIT.max });
    expect((await call(OTHER)).status).toBe(200);
  });
  it('a caller who is not an administrator is refused (403) before anything is counted', async () => {
    const db = fakeDatabase(); const w = adminWorld(db, 'consumer');
    expect((await w.instance()()).status).toBe(403); expect(db.asked).toEqual([]);
  });
  it('fail closed: when the count can not be read the call is 503, no audit row, nothing read', async () => {
    const db = fakeDatabase(); const w = adminWorld(db);
    const r = await w.instance(async () => { throw new TypeError('fetch failed'); })();
    expect([r.status, await code(r)]).toEqual([503, 'unavailable']); expect(w.touched).toEqual([]);
  });
});

describe('the routes are wired to the limit (it is optional in the handlers, so this pins that every route passes it)', () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  it.each([
    ['../../app/api/worker/signed-urls/route.ts', ['count: workerCounter(rateRpcOf(admin))', 'allow: limiters.allow,', 'allowFailure: limiters.allowFailure,']],
    ['../../app/api/account/purge-storage/route.ts', ['limitedPurge(routeLimit(brake, rateRpcOf(admin), PURGE_LIMIT))', 'handlePurge(request, { caller, storage: admin.storage })']],
    ['../../app/api/admin/sources/route.ts', ['limit: adminLimit(admin)']],
    ['../../app/api/admin/catalog/review/route.ts', ['limit: adminLimit(admin)']],
    ['../../app/api/admin/sources/[id]/takedown/route.ts', ['limit: adminLimit(admin)']],
  ] as [string, string[]][])('%s', (file, needles) => { for (const n of needles) expect(src(file)).toContain(n); });
});
