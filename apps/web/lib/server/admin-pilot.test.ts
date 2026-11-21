import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { endPilot, getSettings, MAX_BATCHES, patchSettings, previewPilot, realDate, TIME_BUDGET_MS, type PilotDeps } from './admin-pilot';
import type { BucketApi, StorageLike } from './api';
import type { RouteLimit } from './limits';

// WO-0160 without a stack: fake clients stand for the session, the secret-key client (database functions and Storage). What is asked, in what order, and what is never touched.
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = U(900);
const ORIGIN = { origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' };
const req = (method: string, body?: unknown, headers: Record<string, string> = ORIGIN) =>
  new Request('http://127.0.0.1:3000/api/admin/pilot/end', { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

type RpcAnswer = { data: unknown; error: { message: string; code?: string } | null };
interface Rig { d: PilotDeps; log: string[]; adminBuilt: () => number; adminCalls: () => string[] }
function rig(o: { user?: { id: string } | null; authError?: { status?: number } | null; role?: unknown; roleError?: boolean; admin?: (fn: string, args: Record<string, unknown>) => RpcAnswer; storage?: StorageLike; limit?: RouteLimit; settings?: Record<string, unknown> } = {}): Rig {
  const log: string[] = []; let built = 0;
  const caller = {
    auth: { getUser: async () => ({ data: { user: o.user === undefined ? { id: ADMIN } : o.user }, error: o.authError ?? null }) },
    schema: () => ({ rpc: async (fn: string, args?: Record<string, unknown>) => {
      if (fn === 'current_role') return { data: o.role === undefined ? 'admin' : o.role, error: o.roleError ? { message: 'x' } : null };
      if (fn === 'public_setting') return { data: (o.settings ?? {})[String(args?.p_key)] ?? '', error: null };
      log.push(`caller:${fn}`); return { data: null, error: null };
    } }),
  } as unknown as SupabaseClient;
  const admin = {
    schema: () => ({ rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      log.push(`admin:${fn}`);
      if (fn === 'write_admin_audit') return { data: 1, error: null };
      return o.admin ? o.admin(fn, args) : { data: null, error: { message: 'unexpected' } };
    } }),
    storage: o.storage ?? { from: (): BucketApi => { throw new Error('storage must not be used'); } },
  };
  return { d: { caller, createAdmin: () => { built += 1; return admin as unknown as ReturnType<PilotDeps['createAdmin']>; }, limitOf: o.limit ? () => o.limit! : undefined }, log, adminBuilt: () => built, adminCalls: () => log.filter((l) => l.startsWith('admin:')) };
}

const ALL: [string, (r: Request, d: PilotDeps) => Promise<Response>, string, unknown][] = [
  ['getSettings', getSettings, 'GET', undefined],
  ['patchSettings', patchSettings, 'PATCH', { pilot_end_date: '2030-01-01', pilot_outcome: 'close' }],
  ['previewPilot', previewPilot, 'GET', undefined],
  ['endPilot', endPilot, 'POST', { confirm: 'END' }],
];

describe.each(ALL)('%s: who may call', (_n, go, method, body) => {
  it('no session is 401 and the secret-key client is never built', async () => {
    const r = rig({ user: null });
    const res = await go(req(method, body), r.d);
    expect([res.status, await code(res)]).toEqual([401, 'not_signed_in']);
    expect(r.adminBuilt()).toBe(0);
  });
  it('an account service that fails is 503 (not 401), and a role read that fails is 500', async () => {
    expect((await go(req(method, body), rig({ user: null, authError: { status: 503 } }).d)).status).toBe(503);
    expect((await go(req(method, body), rig({ roleError: true }).d)).status).toBe(500);
  });
  it.each(['consumer', 'vendor', null, 'none', 'Admin', 'admin '])('the role %s is 403 and neither the secret-key client nor the database is touched', async (role) => {
    const r = rig({ role });
    const res = await go(req(method, body), r.d);
    expect([res.status, await code(res)]).toEqual([403, 'forbidden']);
    expect(r.adminBuilt()).toBe(0);
    expect(r.log).toEqual([]);
  });
  it('an administrator passes the role check (the answer is not 401 or 403)', async () => {
    const res = await go(req(method, body), rig({ admin: () => ({ data: null, error: { message: 'x' } }), storage: undefined }).d);
    expect([401, 403]).not.toContain(res.status);
  });
});

describe('mutating calls need the origin evidence before anything else', () => {
  it.each(ALL.filter((a) => a[2] !== 'GET'))('%s from another site is 403 without even asking who the caller is', async (_n, go, method, body) => {
    const r = rig();
    for (const headers of [{ origin: 'http://evil.example.test' }, {}, { 'sec-fetch-site': 'cross-site' }] as Record<string, string>[]) expect((await go(req(method, body, headers), r.d)).status).toBe(403);
    expect(r.adminBuilt()).toBe(0);
  });
});

describe('the shared limit: the administrator count first, then the brake, fail closed', () => {
  const limit = (count: () => Promise<boolean>, brake: () => boolean, log: string[]): RouteLimit => ({ count: async (b) => { log.push(`count:${b}`); return count(); }, brake: () => { log.push('brake'); return brake(); } });
  it('is asked for the verified administrator only, count then brake, before any database call', async () => {
    const log: string[] = []; const r = rig({ limit: limit(async () => true, () => true, log), admin: () => ({ data: { consumers_to_delete: 1, unused_invitations: 0, vendor_users: 0 }, error: null }) });
    expect((await previewPilot(req('GET'), r.d)).status).toBe(200);
    expect(log).toEqual([`count:admin:${ADMIN}`, 'brake']);
    expect(r.adminCalls()[0]).toBe('admin:write_admin_audit');
  });
  it('over the count is 429 and the brake is not used; an unreadable count is 503; neither reaches the database', async () => {
    const log: string[] = []; const over = rig({ limit: limit(async () => false, () => true, log) });
    expect((await endPilot(req('POST', { confirm: 'END' }), over.d)).status).toBe(429);
    expect(log).toEqual([`count:admin:${ADMIN}`]);
    const down = rig({ limit: limit(async () => { throw new Error('down'); }, () => true, []) });
    expect((await endPilot(req('POST', { confirm: 'END' }), down.d)).status).toBe(503);
    const braked = rig({ limit: limit(async () => true, () => false, []) });
    expect((await previewPilot(req('GET'), braked.d)).status).toBe(429);
    for (const x of [over, down, braked]) expect(x.adminCalls()).toEqual([]);
  });
  it('a caller with no session or no role never uses a count', async () => {
    const log: string[] = [];
    await previewPilot(req('GET'), rig({ user: null, limit: limit(async () => true, () => true, log) }).d);
    await previewPilot(req('GET'), rig({ role: 'consumer', limit: limit(async () => true, () => true, log) }).d);
    expect(log).toEqual([]);
  });
});

describe('GET /api/admin/settings and the preview', () => {
  it('returns the two keys, null while empty or odd', async () => {
    expect(await json(await getSettings(req('GET'), rig({ settings: { pilot_end_date: '2030-01-31', pilot_outcome: 'continue' } }).d))).toEqual({ pilot_end_date: '2030-01-31', pilot_outcome: 'continue' });
    expect(await json(await getSettings(req('GET'), rig({ settings: { pilot_end_date: '2030-02-31', pilot_outcome: 'x' } }).d))).toEqual({ pilot_end_date: null, pilot_outcome: null });
    expect(await json(await getSettings(req('GET'), rig().d))).toEqual({ pilot_end_date: null, pilot_outcome: null });
  });
  it('the preview passes on the three counts (and outcome_unset) and nothing else', async () => {
    const r = rig({ admin: (fn) => ({ data: fn === 'admin_end_pilot_preview' ? { consumers_to_delete: 4, unused_invitations: 2, vendor_users: 1, outcome_unset: true, email: 'a@b.test' } : null, error: null }) });
    expect(await json(await previewPilot(req('GET'), r.d))).toEqual({ consumers_to_delete: 4, unused_invitations: 2, vendor_users: 1, outcome_unset: true });
    expect((await previewPilot(req('GET'), rig({ admin: () => ({ data: { consumers_to_delete: 'x' }, error: null }) }).d)).status).toBe(500);
  });
});

describe('PATCH /api/admin/settings: zod-style strict validation, then the database function', () => {
  const BAD: unknown[] = [undefined, '', 'not json', '[]', 'null', {}, { pilot_end_date: '2030-01-01' }, { pilot_outcome: 'close' }, { pilot_end_date: '2030-02-30', pilot_outcome: 'close' }, { pilot_end_date: '2030-1-1', pilot_outcome: 'close' },
    { pilot_end_date: '2030-01-01', pilot_outcome: 'Close' }, { pilot_end_date: '2030-01-01', pilot_outcome: 'delete' }, { pilot_end_date: 20300101, pilot_outcome: 'close' }, { pilot_end_date: '2030-01-01', pilot_outcome: 'close', extra: 1 }, { pilot_end_date: '0000-01-01', pilot_outcome: 'close' }];
  it.each(BAD.map((b, i) => [i, b]))('bad body %s is 400 and the database is not called', async (_i, body) => {
    const r = rig();
    const res = await patchSettings(req('PATCH', body), r.d);
    expect([res.status, await code(res)]).toEqual([400, 'bad_request']);
    expect(r.adminCalls()).toEqual([]);
  });
  it('a good body calls app.admin_set_pilot_end with the administrator id from the session, not from the body', async () => {
    const seen: Record<string, unknown>[] = [];
    const r = rig({ admin: (_f, a) => { seen.push(a); return { data: { pilot_end_date: '2030-01-01', pilot_outcome: 'close' }, error: null }; } });
    const res = await patchSettings(req('PATCH', { pilot_end_date: '2030-01-01', pilot_outcome: 'close' }), r.d);
    expect([res.status, await json(res)]).toEqual([200, { pilot_end_date: '2030-01-01', pilot_outcome: 'close' }]);
    expect(seen).toEqual([{ p_admin: ADMIN, p_end_date: '2030-01-01', p_outcome: 'close' }]);
  });
  it.each([['invalid_end_date', 422, 'invalid_end_date'], ['invalid_outcome', 400, 'bad_request'], ['forbidden', 403, 'forbidden'], ['something at 10.0.0.5 broke', 500, 'server_error']])('the database refusal %s maps to a fixed code and its text is never passed on', async (message, status, c) => {
    const res = await patchSettings(req('PATCH', { pilot_end_date: '2030-01-01', pilot_outcome: 'close' }), rig({ admin: () => ({ data: null, error: { message } }) }).d);
    const text = await res.text();
    expect([res.status, (JSON.parse(text) as { error: { code: string } }).error.code]).toEqual([status, c]);
    expect(text).not.toContain('10.0.0.5');
  });
  it('realDate accepts only real calendar dates', () => {
    expect([realDate('2028-02-29'), realDate('2029-02-29'), realDate('2030-13-01'), realDate(''), realDate(5), realDate('0000-01-01'), realDate('1999-12-31'), realDate('2000-01-01')]).toEqual([true, false, false, false, false, false, false, true]);
  });
});

describe('POST /api/admin/pilot/end: the confirmation is checked by the server before any pilot call', () => {
  it.each([[undefined], [''], ['not json'], ['null'], ['[]'], [{}], [{ confirm: 'end' }], [{ confirm: 'END ' }], [{ confirm: true }], [{ confirm: 'END', x: 1 }], [{ ok: 'END' }]])('the body %j is 400 confirmation_required and no database function or storage call runs', async (body) => {
    const r = rig();
    const res = await endPilot(req('POST', body), r.d);
    expect([res.status, await code(res)]).toEqual([400, 'confirmation_required']);
    expect(r.adminCalls()).toEqual([]);
  });
});

/** A small world: marked participants with files, the four database functions and a Storage with real folder listing. */
function world(o: { users: string[]; vendors?: number; outcome?: 'close' | 'continue'; failPurge?: string[]; onPurge?: () => void; failDeleteWith?: Record<string, string>; vendorError?: string; selectIds?: (ids: string[]) => string[] }) {
  const left = [...o.users]; const log: string[] = []; let vendorsLeft = o.vendors ?? 0; let nextCalls = 0;
  const files = new Map<string, Set<string>>(); // `${bucket}/${uid}` -> names
  for (const u of o.users) for (const b of ['item-images', 'receipts', 'exports']) files.set(`${b}/${u}`, new Set([`a-${u}.bin`, `b-${u}.bin`]));
  const storage: StorageLike = { from: (bucket): BucketApi => ({
    createSignedUrl: async () => ({ data: null, error: new Error('unused') }), createSignedUploadUrl: async () => ({ data: null, error: new Error('unused') }),
    list: async (prefix) => ({ data: [...(files.get(`${bucket}/${prefix}`) ?? [])].map((name) => ({ name, id: 'id' })), error: null }),
    remove: async (paths) => {
      const uid = paths[0]?.split('/')[0] ?? '';
      o.onPurge?.();
      if (o.failPurge?.includes(uid)) return { data: null, error: new Error('down') };
      for (const p of paths) files.get(`${bucket}/${uid}`)?.delete(p.split('/')[1] ?? '');
      log.push(`purged:${bucket}:${uid}`);
      return { data: paths.map((name) => ({ name })), error: null };
    },
  }) };
  const admin = (fn: string, a: Record<string, unknown>): RpcAnswer => {
    if (fn === 'admin_end_pilot_next') {
      nextCalls += 1; const picked = (o.selectIds ? o.selectIds(left) : left).slice(0, Number(a.p_limit));
      const done = picked.length === 0 && left.length === 0;
      return { data: { user_ids: picked, remaining: (o.selectIds ? o.selectIds(left) : left).length - picked.length, done, invitations_deleted: done ? 3 : 0 }, error: null };
    }
    if (fn === 'admin_end_pilot_delete') {
      const u = String(a.p_user); log.push(`delete:${u}`);
      if (o.failDeleteWith?.[u] === 'not_marked') { left.splice(left.indexOf(u), 1); return { data: null, error: { message: 'not_marked' } }; }   // a concurrent call finished it
      if (o.failDeleteWith?.[u]) return { data: null, error: { message: o.failDeleteWith[u]! } };
      const i = left.indexOf(u); if (i < 0) return { data: null, error: { message: 'not_marked' } };
      left.splice(i, 1); return { data: { deleted: true, unmarked: false, done: left.length === 0, invitations_deleted: 0 }, error: null };
    }
    if (fn === 'admin_end_pilot_vendors') {
      if (o.vendorError ?? (o.vendors === undefined ? 'not_closing' : undefined)) return { data: null, error: { message: o.vendorError ?? 'not_closing' } };
      const n = Math.min(vendorsLeft, Number(a.p_limit)); vendorsLeft -= n; log.push('vendors');
      return { data: { vendor_items_withdrawn: 2, vendor_users_deleted: n, remaining: vendorsLeft }, error: null };
    }
    return { data: null, error: { message: 'unexpected' } };
  };
  return { admin, storage, log, left, files, nextCalls: () => nextCalls };
}
const run = (w: ReturnType<typeof world>) => { const r = rig({ admin: w.admin, storage: w.storage }); return endPilot(req('POST', { confirm: 'END' }), r.d); };
const [A, B, C] = [U(1), U(2), U(3)];

describe('POST /api/admin/pilot/end: the files go before the account, the ids come from the database', () => {
  it('purges every bucket of a participant, and only then calls the database delete', async () => {
    const w = world({ users: [A, B] });
    const res = await run(w);
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ deleted: 2, purge_failed: 0, remaining: 0, done: true, stuck: false, invitations_deleted: 3, vendors: null });
    for (const u of [A, B]) {
      const at = (s: string) => w.log.indexOf(s);
      for (const b of ['item-images', 'receipts', 'exports']) expect(at(`purged:${b}:${u}`)).toBeGreaterThanOrEqual(0);
      for (const b of ['item-images', 'receipts', 'exports']) expect(at(`purged:${b}:${u}`)).toBeLessThan(at(`delete:${u}`));
    }
    expect([...w.files.values()].every((s) => s.size === 0)).toBe(true);
  });
  it('after the last participant it makes one more next call, so the end is recorded', async () => {
    const w = world({ users: [A, B] });
    await run(w);
    expect(w.nextCalls()).toBe(2);   // one batch with both, one empty selection that records the end
  });
  it('a participant whose purge fails is not deleted, is counted, and the call stops without looping when nothing else is left', async () => {
    const w = world({ users: [A, B], failPurge: [A] });
    const body = await json(await run(w));
    expect(body).toMatchObject({ deleted: 1, purge_failed: 1, remaining: 1, done: false, stuck: true });
    expect(w.log).not.toContain(`delete:${A}`);
    expect(w.left).toEqual([A]);
    expect(w.nextCalls()).toBe(1);
  });
  it('repeated ids that keep failing are reported and the loop is bounded', async () => {
    const many = Array.from({ length: 30 }, (_, i) => U(100 + i));
    const w = world({ users: many, failPurge: many.slice(0, 20) });   // the 20 failing ones come first in every batch
    const body = await json(await run(w));
    expect(body).toMatchObject({ stuck: true, deleted: 0, purge_failed: 20, done: false });
    expect(w.nextCalls()).toBe(1);
  });
  it('the number of batches per call is capped even when every batch makes progress', async () => {
    const many = Array.from({ length: 20 * (MAX_BATCHES + 2) }, (_, i) => U(1000 + i));
    const w = world({ users: many });
    const body = await json(await run(w));
    expect(w.nextCalls()).toBe(MAX_BATCHES);
    expect(body).toMatchObject({ deleted: 20 * MAX_BATCHES, remaining: 40, done: false, stuck: false });
  });
  it('not_marked after a successful purge counts as already handled, not as a failure', async () => {
    const w = world({ users: [A], failDeleteWith: { [A]: 'not_marked' } });
    expect(await json(await run(w))).toMatchObject({ already_handled: 1, delete_failed: 0, stuck: false, done: true });
  });
  it('another database error on the delete leaves the participant marked and is reported', async () => {
    const w = world({ users: [A, B], failDeleteWith: { [A]: 'boom at 10.0.0.5' } });
    const res = await run(w);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('"delete_failed":1');
    expect(text).not.toContain('10.0.0.5');
  });
  it('the time budget stops the call between participants, never inside one: no delete without its purge, the rest stay marked and `more` is true', async () => {
    let clock = 0;
    const w = world({ users: [A, B, C], onPurge: () => { clock += TIME_BUDGET_MS / 6 + 1; } });   // three buckets per participant: a participant costs a little more than a third of the budget
    const r = rig({ admin: w.admin, storage: w.storage });
    const body = await json(await endPilot(req('POST', { confirm: 'END' }), { ...r.d, now: () => clock }));
    expect(body).toMatchObject({ more: true, done: false, stuck: false, remaining: 1 });
    expect(body.deleted).toBe(2);
    expect(w.log).not.toContain(`delete:${C}`);
    expect(w.left).toContain(C);
    for (const l of w.log.filter((x) => x.startsWith('delete:'))) {
      const u = l.slice(7);
      for (const b of ['item-images', 'receipts', 'exports']) expect(w.log.indexOf(`purged:${b}:${u}`)).toBeLessThan(w.log.indexOf(l));
    }
  });
  it('a first participant that fails slowly and spends the budget is reported stuck (not `more` for ever), and nothing is deleted', async () => {
    let clock = 0;
    const w = world({ users: [A, B, C], failPurge: [A], onPurge: () => { clock += TIME_BUDGET_MS + 1; } });
    const r = rig({ admin: w.admin, storage: w.storage });
    const body = await json(await endPilot(req('POST', { confirm: 'END' }), { ...r.d, now: () => clock }));
    expect(body).toMatchObject({ stuck: true, more: false, done: false, deleted: 0, purge_failed: 1, remaining: 3 });
    expect(w.log.filter((x) => x.startsWith('delete:'))).toEqual([]);
    expect(w.nextCalls()).toBe(1);
  });
  it('an id that is not a UUID in the database answer is never purged (it could widen the folder)', async () => {
    const w = world({ users: ['', 'abc'] });
    const res = await run(w);
    expect(res.status).toBe(500);
    expect(w.log).toEqual([]);
  });
  it('a refusal of the first next call is passed on as a fixed code (nothing was done)', async () => {
    for (const [m, c, s] of [['pilot_not_ended', 'pilot_not_ended', 409], ['outcome_unset', 'outcome_unset', 409], ['notice_unset', 'notice_unset', 409], ['forbidden', 'forbidden', 403]] as const) {
      const res = await endPilot(req('POST', { confirm: 'END' }), rig({ admin: () => ({ data: null, error: { message: m } }) }).d);
      expect([res.status, await code(res)]).toEqual([s, c]);
    }
  });
  it('under close, the vendors run in batches once no participant is left', async () => {
    const w = world({ users: [A], vendors: 45 });
    const body = await json(await run(w));
    expect(body.vendors).toEqual({ vendor_items_withdrawn: 6, vendor_users_deleted: 45, remaining: 0 });
    expect(w.log.filter((l) => l === 'vendors')).toHaveLength(3);
  });
  it('not_closing (the continue outcome) and participants_remaining are not errors and report no vendors; vendors are not asked while participants are left', async () => {
    const w = world({ users: [A], vendorError: 'not_closing' });
    expect(await json(await run(w))).toMatchObject({ done: true, vendors: null, interrupted: false });
    const w2 = world({ users: [A, B, C], failPurge: [C] });
    await run(w2);
    expect(w2.log).not.toContain('vendors');
  });
  it('another vendor error is reported as interrupted', async () => {
    expect(await json(await run(world({ users: [A], vendorError: 'boom' })))).toMatchObject({ done: true, interrupted: true, vendors: null });
  });
});
