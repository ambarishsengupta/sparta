import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { leaveThePilot } from '../../components/account/account-actions';
import { cleanup, discover, lockStack, makeReady, provisionUser, sql } from '../../test-support/stack';
import { adminFor, purgeInProcess, purgeUserFiles } from '../../test-support/purge';
import { POST as workerRoute } from '../../app/api/worker/signed-urls/route';

// Integration suite against the REAL local stack (WO-0071): the worker's signed URLs move real bytes, and Leave removes every file of the person from the
// storage backend (the WO-0070 review's MAJOR-1). The secret key is read from `supabase status` into process.env for the route under test and never written anywhere.
const stack = discover();
if (!stack) console.warn('SKIPPED storage.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
const KEY_VARIABLE = ['SUPABASE', 'SECRET', 'KEY'].join('_');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

/** Every file the storage container holds whose path contains the id (the reviewer's MAJOR-1 command). */
function onBackend(id: string): string[] {
  try { return execFileSync('docker', ['exec', 'supabase_storage_sparta', 'find', '/', '-path', `*${id}*`, '-type', 'f'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n').filter(Boolean); }
  catch (e) { return ((e as { stdout?: Buffer }).stdout?.toString() ?? '').split('\n').filter(Boolean); }
}

describe.skipIf(!stack)('worker signed URLs and the storage purge against the real stack', () => {
  const run = randomUUID().slice(0, 8);
  const email = { ann: `it-${run}-sann@example.test`, bob: `it-${run}-sbob@example.test`, cat: `it-${run}-scat@example.test` };
  const pw = randomBytes(12).toString('base64url');
  const bearer = randomBytes(32).toString('base64url');
  const mailIds: string[] = [];
  let ann: SupabaseClient; let bob: SupabaseClient; let cat: SupabaseClient;
  let annId = ''; let bobId = ''; let catId = '';
  let unlock: (() => void) | undefined;
  const admin = () => adminFor(stack!);
  const q = (text: string, vars: Record<string, string> = {}) => sql(text, vars);
  const exists = (id: string) => q(`select count(*) from auth.users where id = :'u'`, { u: id }) === '1';
  const rows = (id: string) => Number(q(`select count(*) from storage.objects where (storage.foldername(name))[1] = :'u'`, { u: id }));
  const call = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${bearer}` }) =>
    workerRoute(new Request('http://127.0.0.1:3000/api/worker/signed-urls', { method: 'POST', headers, body: JSON.stringify(body) }));
  const up = async (c: SupabaseClient, bucket: string, path: string, bytes: Buffer, contentType: string) => {
    const r = await c.storage.from(bucket).upload(path, bytes, { contentType }); if (r.error) throw new Error(`upload failed: ${r.error.message}`);
  };

  beforeAll(async () => {
    unlock = await lockStack();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', stack!.url); vi.stubEnv(KEY_VARIABLE, stack!.secret); vi.stubEnv('WORKER_API_TOKEN', bearer);
    [ann, bob, cat] = [await provisionUser(stack!, email.ann, pw, mailIds), await provisionUser(stack!, email.bob, pw, mailIds), await provisionUser(stack!, email.cat, pw, mailIds)];
    [annId, bobId, catId] = (await Promise.all([ann, bob, cat].map((c) => c.auth.getUser()))).map((r) => r.data.user!.id) as [string, string, string];
    await makeReady(ann, 'IN'); await makeReady(bob, 'IN'); await makeReady(cat, 'IN');
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    try {
      for (const id of [annId, bobId, catId]) if (id) await purgeUserFiles(stack!, id);   // SQL clean-up of a user leaves the file bytes: remove them through the Storage API first
      for (const id of [annId, bobId, catId]) if (id) try { await admin().storage.from('item-images').remove([]); } catch { /* nothing to do */ }
      for (const e of Object.values(email)) {
        const found = (await (await fetch(`${stack!.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${e}`)}`)).json()) as { messages: { ID: string }[] };
        for (const m of found.messages) if (!mailIds.includes(m.ID)) mailIds.push(m.ID);
      }
      await cleanup(stack!, Object.values(email), mailIds);
    } finally { unlock?.(); }
  });

  // ---- the worker route -------------------------------------------------------------------------------------------------------------
  // Jobs are made in ONE transaction (insert, then claim by SQL, then the end state), so no other session ever sees a queued job of this suite:
  // workflow/gates/db_tests.test.ts requires that no queued job exists anywhere while it runs, and it does not take the suite lock.
  function jobIn(uid: string, input: Record<string, unknown>, end: 'running' | 'failed' = 'running'): number {
    const out = q(`begin;
      insert into app.jobs (user_id, type, input) values (:'u', 'photo', :'i'::jsonb) returning id;
      update app.jobs set status = 'running', attempts = 1 where id = (select max(id) from app.jobs where user_id = :'u');
      ${end === 'failed' ? "update app.jobs set status = 'failed', last_error = 'test' where id = (select max(id) from app.jobs where user_id = :'u');" : ''}
      commit;`, { u: uid, i: JSON.stringify(input) });
    return Number(out.split('\n').find((l) => /^[0-9]+$/.test(l)));
  }

  it('without the token, with a wrong one, with a short one: 401 and nothing from the database', async () => {
    for (const h of [{}, { authorization: `Bearer ${bearer}x` }, { authorization: 'Bearer short' }, { authorization: bearer }] as Record<string, string>[]) expect((await call({ job_id: 1 }, h)).status).toBe(401);
  });

  it('a server with no worker token configured refuses everybody, including a request that presents a long made-up token', async () => {
    vi.stubEnv('WORKER_API_TOKEN', '');
    try { expect((await call({ job_id: 1 }, { authorization: `Bearer ${'x'.repeat(40)}` })).status).toBe(503); } finally { vi.stubEnv('WORKER_API_TOKEN', bearer); }
    expect((await call({ job_id: 999999999 })).status).toBe(404);   // and with the token set again the same caller gets through to the job lookup
  });

  it('a running job gets a working GET URL for its input and working upload URLs for its outputs; the bytes round-trip', async () => {
    await up(ann, 'item-images', `${annId}/in-${run}.png`, PNG, 'image/png');
    const job = jobIn(annId, { path: `${annId}/in-${run}.png` });
    const res = await call({ job_id: job });
    expect(res.status).toBe(200);
    const body = await res.json() as { downloads: { path: string; url: string }[]; uploads: { kind: string; path: string; url: string }[]; download_expires_in: number };
    expect(body.download_expires_in).toBe(60);
    // download with the returned URL only (no key)
    const got = await fetch(body.downloads[0]!.url);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG)).toBe(true);
    // upload with each returned URL only
    expect(body.uploads.map((u) => u.path)).toEqual([`${annId}/${job}-cutout.webp`, `${annId}/${job}-thumb.webp`, `${annId}/${job}-orig-thumb.webp`]);
    for (const u of body.uploads) {
      const put = await fetch(u.url, { method: 'PUT', headers: { 'content-type': 'image/webp', 'x-upsert': 'true' }, body: WEBP });
      expect(put.status, `${u.kind}: ${await put.clone().text()}`).toBe(200);
    }
    // the owner reads the result; nobody else does
    const mine = await ann.storage.from('item-images').download(`${annId}/${job}-cutout.webp`);
    expect(mine.error).toBeNull(); expect(Buffer.from(await mine.data!.arrayBuffer()).equals(WEBP)).toBe(true);
    expect((await bob.storage.from('item-images').download(`${annId}/${job}-cutout.webp`)).error).not.toBeNull();
    expect((await bob.storage.from('item-images').list(annId)).data ?? []).toEqual([]);
    // a second call (a retry) can overwrite the same names
    const again = await (await call({ job_id: job })).json() as { uploads: { url: string }[] };
    expect((await fetch(again.uploads[0]!.url, { method: 'PUT', headers: { 'content-type': 'image/webp', 'x-upsert': 'true' }, body: WEBP })).status).toBe(200);
    // the download URL is short-lived: the route asked for 60 seconds (the exp claim of the token in the URL proves it)
    const jwt = new URL(body.downloads[0]!.url).searchParams.get('token')!;
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as { exp: number; iat?: number };
    expect(claims.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(60);
  });

  it('a URL for another user\'s path is never returned, even when the job row is forged by the database owner', async () => {
    await up(bob, 'item-images', `${bobId}/secret-${run}.png`, PNG, 'image/png');
    // the database owner can bypass the insert policy, so the route's own path check is what stops this
    const forge = (p: string) => jobIn(annId, { path: p });
    const r = await call({ job_id: forge(`${bobId}/secret-${run}.png`) });
    expect(r.status).toBe(422);
    expect(await r.text()).not.toContain(bobId);
    expect((await call({ job_id: forge(`${annId}/../${bobId}/secret-${run}.png`) })).status).toBe(422);
  });

  it('unknown jobs are 404 and jobs that are not running are 409 (a failed job here; queued and done are in the unit suite)', async () => {
    expect((await call({ job_id: 999999999 })).status).toBe(404);
    const failed = jobIn(annId, { path: `${annId}/q-${run}.png` }, 'failed');
    expect((await call({ job_id: failed })).status).toBe(409);
  });

  // ---- the purge and Leave (MAJOR-1) ------------------------------------------------------------------------------------------------
  it('purge removes every object and byte of the caller in every bucket (and only theirs); Leave then works end to end and the backend holds nothing', async () => {
    const a = admin();
    await up(ann, 'item-images', `${annId}/dd.png`, PNG, 'image/png');
    await up(ann, 'receipts', `${annId}/dd.pdf`, PDF, 'application/pdf');
    expect((await a.storage.from('exports').upload(`${annId}/exp-1/part-1.zip`, Buffer.from('PK'), { contentType: 'application/zip' })).error).toBeNull();
    expect((await a.storage.from('exports').upload(`${annId}/exp-1/part-2.zip`, Buffer.from('PK'), { contentType: 'application/zip' })).error).toBeNull();
    // more than one listing page: 105 tiny objects, written through the secret-key client in parallel batches
    const many = Array.from({ length: 105 }, (_, i) => `${annId}/bulk-${String(i).padStart(3, '0')}.png`);
    for (let i = 0; i < many.length; i += 15) await Promise.all(many.slice(i, i + 15).map(async (p) => { const r = await a.storage.from('item-images').upload(p, PNG, { contentType: 'image/png' }); if (r.error) throw new Error(r.error.message); }));
    await up(bob, 'item-images', `${bobId}/keep-${run}.png`, PNG, 'image/png');
    expect(onBackend(annId).length).toBeGreaterThan(108);
    const bobBefore = onBackend(bobId);
    expect(bobBefore.length).toBeGreaterThanOrEqual(2);

    expect(await purgeInProcess(stack!, ann)).toMatchObject({ ok: false, reason: 'credentials' });   // a confirmation-link session is not a fresh password sign-in: nothing is removed
    expect(onBackend(annId).length).toBeGreaterThan(108);
    expect((await ann.auth.signInWithPassword({ email: email.ann, password: pw })).error).toBeNull();   // what Leave does first
    const purged = await purgeInProcess(stack!, ann);
    expect(purged).toEqual({ ok: true });
    // through the Storage API: every folder of ann is empty in every bucket; on the backend: no file, no leftover folder path
    for (const b of ['item-images', 'receipts', 'exports']) expect((await a.storage.from(b).list(annId)).data, b).toEqual([]);
    expect(rows(annId)).toBe(0);
    expect(onBackend(annId)).toEqual([]);
    // bob is untouched
    expect(onBackend(bobId).sort()).toEqual(bobBefore.sort());
    expect((await bob.storage.from('item-images').download(`${bobId}/keep-${run}.png`)).error).toBeNull();
    expect(exists(annId)).toBe(true);   // the purge alone deletes no account
    // idempotent
    expect(await purgeInProcess(stack!, ann)).toEqual({ ok: true });
  });

  it('MAJOR-1 repro: an invited user uploads item-images/<uid>/dd.png and receipts/<uid>/dd.pdf, leaves, and the storage backend holds nothing for the uid', async () => {
    await up(cat, 'item-images', `${catId}/dd.png`, PNG, 'image/png');
    await up(cat, 'receipts', `${catId}/dd.pdf`, PDF, 'application/pdf');
    expect(onBackend(catId).length).toBe(2);
    const left = await leaveThePilot(cat, pw, () => purgeInProcess(stack!, cat));
    expect(left).toEqual({ ok: true, result: 'deleted' });
    expect(exists(catId)).toBe(false);
    expect(rows(catId)).toBe(0);
    expect(onBackend(catId)).toEqual([]);
  });

  it('if the file removal fails, Leave stops: the account and every file stay, the message says so, and a retry then works', async () => {
    const dan = `it-${run}-sdan@example.test`;
    const danClient = await provisionUser(stack!, dan, pw, mailIds);
    const danId = (await danClient.auth.getUser()).data.user!.id;
    try {
      await makeReady(danClient, 'IN');
      await up(danClient, 'item-images', `${danId}/dd.png`, PNG, 'image/png');
      const broken = { from: () => ({ list: async () => ({ data: null, error: new Error('storage down') }) }) } as unknown as SupabaseClient['storage'];
      const out = await leaveThePilot(danClient, pw, () => purgeInProcess(stack!, danClient, broken));
      expect(out).toMatchObject({ ok: false, reason: 'failed', message: expect.stringContaining('your account was not deleted') });
      expect(exists(danId)).toBe(true); expect(onBackend(danId).length).toBe(1); expect(rows(danId)).toBe(1);
      expect(await leaveThePilot(danClient, pw, () => purgeInProcess(stack!, danClient))).toEqual({ ok: true, result: 'deleted' });
      expect(exists(danId)).toBe(false); expect(onBackend(danId)).toEqual([]);
    } finally { await purgeUserFiles(stack!, danId); await cleanup(stack!, [dan], []); }
  });

  it('a sign-in older than the window is refused by the purge, with every file left in place', async () => {
    const eve = `it-${run}-seve@example.test`;
    const eveClient = await provisionUser(stack!, eve, pw, mailIds);
    const eveId = (await eveClient.auth.getUser()).data.user!.id;
    const original = q(`select value from ops.settings where key = 'reauth_window_seconds'`);
    try {
      await makeReady(eveClient, 'IN');
      await up(eveClient, 'item-images', `${eveId}/dd.png`, PNG, 'image/png');
      q(`update ops.settings set value = '1' where key = 'reauth_window_seconds'`);
      await sleep(2500);
      const out = await purgeInProcess(stack!, eveClient);
      expect(out).toMatchObject({ ok: false, reason: 'credentials' });
      expect(onBackend(eveId).length).toBe(1);
      q(`update ops.settings set value = :'v' where key = 'reauth_window_seconds'`, { v: original });
      expect(await leaveThePilot(eveClient, pw, () => purgeInProcess(stack!, eveClient))).toEqual({ ok: true, result: 'deleted' });   // the fresh password sign-in inside Leave makes it recent
      expect(onBackend(eveId)).toEqual([]);
    } finally { q(`update ops.settings set value = :'v' where key = 'reauth_window_seconds'`, { v: original }); await purgeUserFiles(stack!, eveId); await cleanup(stack!, [eve], []); }
  });

  it('without a session the purge does nothing and says so', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const anon = createClient(stack!.url, stack!.key, { auth: { persistSession: false } });
    expect(await purgeInProcess(stack!, anon)).toMatchObject({ ok: false, reason: 'session' });
  });
});
