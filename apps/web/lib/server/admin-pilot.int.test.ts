import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteRateWindows } from '../../test-support/ops-rows';
import { adminFor, purgeUserFiles } from '../../test-support/purge';
import { cleanup, discover, lockStack, makeReady, provisionUser, newClient, sql } from '../../test-support/stack';
import { GET as settingsGet, PATCH as settingsPatch } from '../../app/api/admin/settings/route';
import { GET as previewGet } from '../../app/api/admin/pilot/preview/route';
import { POST as endPost } from '../../app/api/admin/pilot/end/route';
import { BUCKETS, listAll } from './purge';

// WO-0160 / FR-69 against the REAL local stack: the three real route modules (only the cookie-reading session factory is replaced by the test's signed-in client), the real
// secret-key client, the real database functions of WO-0158 and WO-0159 and the real Storage API. Two throwaway participants each hold an object in all three buckets;
// after the end run no object is left under either folder and the accounts are gone. The pilot settings, the unused invitations and the daily counts are put back as they were.
let current: SupabaseClient;
vi.mock('../supabase/server', () => ({ createServerSupabase: async () => current }));
const stack = discover();
if (!stack) console.warn('SKIPPED admin-pilot.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const KEY_VARIABLE = ['SUPABASE', 'SECRET', 'KEY'].join('_');
const ORIGIN = 'http://127.0.0.1:3000';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const ZIP = Buffer.from('PK');
const FILES = { 'item-images': ['a.png', 'image/png', PNG], receipts: ['r.pdf', 'application/pdf', PDF], exports: ['exp-1/part-1.zip', 'application/zip', ZIP] } as const;

/** Every file the storage container holds whose path contains the id. */
function onBackend(id: string): string[] {
  try { return execFileSync('docker', ['exec', 'supabase_storage_sparta', 'find', '/', '-path', `*${id}*`, '-type', 'f'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n').filter(Boolean); }
  catch (e) { return ((e as { stdout?: Buffer }).stdout?.toString() ?? '').split('\n').filter(Boolean); }
}
interface Answer { error: { code: string }; pilot_end_date: string | null; pilot_outcome: string | null; consumers_to_delete: number; unused_invitations: number; vendor_users: number;
  deleted: number; remaining: number; done: boolean; stuck: boolean; purge_failed: number; vendors: { vendor_users_deleted: number } | null }

describe('admin end-of-pilot routes against the real stack', () => {
  // never skipped: without the local stack this suite fails with the reason (the strict gate and CI always have the stack)
  beforeAll(() => { if (!stack) throw new Error('the local Supabase stack is not running: start it with `supabase start`'); });
  const run = randomUUID().slice(0, 8);
  const email = { admin: `it-${run}-padm@example.test`, ann: `it-${run}-pann@example.test`, bob: `it-${run}-pbob@example.test`, vic: `it-${run}-pvic@example.test` };
  const pw = randomBytes(12).toString('base64url');
  const mailIds: string[] = [];
  const who = {} as Record<'admin' | 'ann' | 'vic' | 'anon', SupabaseClient>;
  const id = { admin: '', ann: '', bob: '', vic: '' };
  let unlock: (() => void) | undefined;
  let saved = { settings: '', invitations: '', counts: '' };
  const q = (text: string, vars: Record<string, string> = {}) => sql(text, vars);
  const call = async (as: keyof typeof who, fn: (r: Request) => Promise<Response>, method: string, body?: unknown) => {
    current = who[as];
    const res = await fn(new Request(`${ORIGIN}/api/admin/x`, { method, headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, json: (await res.json().catch(() => null)) as Answer | null };
  };
  const exists = (uid: string) => q(`select count(*) from auth.users where id = :'u'`, { u: uid }) === '1';
  const objectRows = (uid: string) => Number(q(`select count(*) from storage.objects where (storage.foldername(name))[1] = :'u'`, { u: uid }));
  const listed = async (uid: string) => (await Promise.all(BUCKETS.map((b) => listAll(adminFor(stack!).storage, b, uid)))).flat();
  const setPilot = (date: string, outcome: string) => q(`update ops.settings set value = :'d' where key = 'pilot_end_date'; update ops.settings set value = :'o' where key = 'pilot_outcome'`, { d: date, o: outcome });
  const upload = async (uid: string) => { for (const b of BUCKETS) { const [name, type, bytes] = FILES[b]; const r = await adminFor(stack!).storage.from(b).upload(`${uid}/${name}`, bytes, { contentType: type }); if (r.error) throw new Error(`upload failed: ${r.error.message}`); } };

  beforeAll(async () => {
    unlock = await lockStack();
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', stack!.url); vi.stubEnv(KEY_VARIABLE, stack!.secret);
    // what the end of the pilot changes besides the participants: the two settings, the unused invitations and the day's deletion count
    saved = {
      settings: q(`select coalesce(jsonb_agg(jsonb_build_object('k', key, 'v', value)), '[]'::jsonb) from ops.settings where key in ('pilot_end_date', 'pilot_outcome')`),
      invitations: q(`select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from ops.invitations i where accepted_at is null`),
      counts: q(`select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from ops.daily_counts c`),
    };
    who.anon = newClient(stack!);
    who.admin = await provisionUser(stack!, email.admin, pw, mailIds);
    who.ann = await provisionUser(stack!, email.ann, pw, mailIds);
    const bob = await provisionUser(stack!, email.bob, pw, mailIds);
    who.vic = await provisionUser(stack!, email.vic, pw, mailIds);
    for (const [k, c] of [['admin', who.admin], ['ann', who.ann], ['bob', bob], ['vic', who.vic]] as const) id[k] = (await c.auth.getUser()).data.user!.id;
    await makeReady(who.ann, 'IN'); await makeReady(bob, 'IN');
    q(`update app.profiles set role = 'admin' where id = :'a'; update app.profiles set role = 'vendor' where id = :'v'`, { a: id.admin, v: id.vic });
    await upload(id.ann); await upload(id.bob);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    try {
      for (const u of [id.ann, id.bob, id.vic]) if (u) await purgeUserFiles(stack!, u);   // SQL clean-up of a user leaves the file bytes
      q(`update ops.settings s set value = coalesce((select o.v from jsonb_to_recordset(:'s'::jsonb) as o(k text, v text) where o.k = s.key), '') where s.key in ('pilot_end_date', 'pilot_outcome')`, { s: saved.settings });
      q(`delete from ops.admin_audit_log where admin_id = :'a'`, { a: id.admin });
      await cleanup(stack!, Object.values(email), mailIds);
      q(`insert into ops.invitations select * from jsonb_populate_recordset(null::ops.invitations, :'i'::jsonb) on conflict do nothing`, { i: saved.invitations });
      q(`delete from ops.daily_counts where true; insert into ops.daily_counts select * from jsonb_populate_recordset(null::ops.daily_counts, :'c'::jsonb)`, { c: saved.counts });
    } finally { try { deleteRateWindows([`admin:${id.admin}`]); } finally { unlock?.(); } }
  });

  it('every route: no session is 401, a participant and a vendor are 403, and nothing is changed', async () => {
    const go: [(r: Request) => Promise<Response>, string, unknown][] = [[settingsGet, 'GET', undefined], [settingsPatch, 'PATCH', { pilot_end_date: '2099-01-01', pilot_outcome: 'close' }], [previewGet, 'GET', undefined], [endPost, 'POST', { confirm: 'END' }]];
    for (const [fn, method, body] of go) {
      expect((await call('anon', fn, method, body)).status).toBe(401);
      expect((await call('ann', fn, method, body)).status).toBe(403);
      expect((await call('vic', fn, method, body)).status).toBe(403);
    }
    expect(q(`select count(*) from ops.admin_audit_log where admin_id = :'a'`, { a: id.admin })).toBe('0');
    expect(q(`select count(*) from ops.settings where key in ('pilot_end_date', 'pilot_outcome') and value <> ''`)).toBe('0');
    expect(exists(id.ann) && exists(id.bob) && exists(id.vic)).toBe(true);
  });

  it('settings: a future date and an outcome are stored and read back; a past date and bad bodies are refused', async () => {
    expect((await call('admin', settingsGet, 'GET')).json).toMatchObject({ pilot_end_date: null, pilot_outcome: null });
    expect((await call('admin', settingsPatch, 'PATCH', { pilot_end_date: '2020-01-01', pilot_outcome: 'close' })).status).toBe(422);
    expect((await call('admin', settingsPatch, 'PATCH', { pilot_end_date: '2099-01-01', pilot_outcome: 'maybe' })).status).toBe(400);
    expect((await call('admin', settingsPatch, 'PATCH', { pilot_end_date: '2099-01-01', pilot_outcome: 'close' })).json).toEqual({ pilot_end_date: '2099-01-01', pilot_outcome: 'close' });
    expect((await call('admin', settingsGet, 'GET')).json).toMatchObject({ pilot_end_date: '2099-01-01', pilot_outcome: 'close' });
    const p = (await call('admin', previewGet, 'GET')).json!;
    expect([p.consumers_to_delete, p.vendor_users]).toEqual([2, 1]);
  });

  it('the end route refuses without the confirmation (400) and before the end date (409), and deletes nothing', async () => {
    for (const body of [undefined, {}, { confirm: 'end' }, { confirm: 'END', x: 1 }]) expect((await call('admin', endPost, 'POST', body)).status).toBe(400);
    expect((await call('admin', endPost, 'POST', { confirm: 'END' })).json?.error.code).toBe('pilot_not_ended');
    expect(exists(id.ann) && exists(id.bob)).toBe(true);
    expect((await listed(id.ann)).length).toBe(3); expect((await listed(id.bob)).length).toBe(3);
  });

  it('after the end date under close: every file of both participants is gone from every bucket, then both accounts, then the vendor', async () => {
    expect(q(`select count(*) from app.profiles where role = 'consumer'`)).toBe('2');   // safety: only the two throwaway participants may be deleted
    expect(q(`select count(*) from app.profiles where role = 'vendor'`)).toBe('1');   // safety: only the one throwaway vendor may be deleted
    setPilot('2020-01-01', 'close');
    expect(onBackend(id.ann).length).toBe(3); expect(onBackend(id.bob).length).toBe(3);
    let last: Answer | null | undefined; let calls = 0;
    do { const r = await call('admin', endPost, 'POST', { confirm: 'END' }); expect(r.status).toBe(200); last = r.json; calls += 1; } while (last && !last.done && last.remaining > 0 && calls < 10 && !last.stuck);
    expect(last).toMatchObject({ remaining: 0, done: true, stuck: false, purge_failed: 0 });
    expect(last?.vendors).toMatchObject({ vendor_users_deleted: 1 });
    for (const u of [id.ann, id.bob]) {
      expect(await listed(u)).toEqual([]);            // the Storage API lists nothing under the folder
      expect(onBackend(u)).toEqual([]);                // and no file bytes are left in the storage container
      expect(objectRows(u)).toBe(0);
      expect(exists(u)).toBe(false);
    }
    expect(q(`select count(*) from app.profiles where role = 'consumer'`)).toBe('0');
    expect(exists(id.vic)).toBe(false);
    expect(exists(id.admin)).toBe(true);
    expect(q(`select string_agg(action, ',' order by id) from ops.admin_audit_log where admin_id = :'a' and action like 'pilot.end%'`, { a: id.admin })).toContain('pilot.end_next');
    // a call after the end changes nothing and is not an error
    expect((await call('admin', endPost, 'POST', { confirm: 'END' })).json).toMatchObject({ deleted: 0, remaining: 0, done: true });
  });
});
