import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { purgeUserFiles } from '../../test-support/purge';
import { cleanup, discover, lockStack, makeReady, provisionUser, sql } from '../../test-support/stack';
import { FAILED_MESSAGE, JOB_REFUSED_MESSAGE, TIMEOUT_MESSAGE, addByPhoto, attachmentOf, prefillFrom } from '../../lib/photo-flow';
import type { PhotoDeps } from '../../lib/photo-flow';
import { SupabaseRepository } from '../../lib/supabase/repository';
import { photoDeps, previewUrls } from './photo-backend';

// Add by photo against the REAL local stack (WO-0073): the private bucket and its policies, the jobs table with its status machine and the
// hourly limit, previews, and the saved item with its item_features row. The WORKER is not running here: its result is written by SQL in the
// worker's own shape (the real worker is tested in services/worker and by its end-to-end script). Skips, with a message, without the stack.
const stack = discover();
if (!stack) console.warn('SKIPPED photo.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const prepared = { blob: new Blob([WEBP], { type: 'image/webp' }), type: 'image/webp', ext: 'webp', width: 1, height: 1 } as const;
const embedding = Array.from({ length: 32 }, (_, i) => Math.round((i / 31) * 1000) / 1000);
const real = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One long-lived psql, so that a job the browser code creates is moved out of "queued" within milliseconds (another suite requires that no queued job is visible). */
function psql(): { run: (text: string) => Promise<string>; close: () => void } {
  const p: ChildProcessWithoutNullStreams = spawn('docker', ['exec', '-i', 'supabase_db_sparta', 'psql', '-U', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1']);
  let buf = ''; let waiting: ((s: string) => void) | null = null;
  p.stdout.on('data', (d: Buffer) => { buf += d.toString(); const i = buf.indexOf('@@done\n'); if (i >= 0 && waiting) { const out = buf.slice(0, i); buf = buf.slice(i + 7); const w = waiting; waiting = null; w(out); } });
  return { run: (text) => new Promise((res) => { waiting = res; p.stdin.write(`${text}\n\\echo @@done\n`); }), close: () => { p.stdin.end(); p.kill(); } };
}

describe.skipIf(!stack)('add by photo against the real stack', () => {
  const run = randomUUID().slice(0, 8);
  const email = { ann: `it-${run}-pann@example.test`, bob: `it-${run}-pbob@example.test`, cat: `it-${run}-pcat@example.test` };
  const pw = randomBytes(12).toString('base64url');
  const mailIds: string[] = [];
  let ann: SupabaseClient; let bob: SupabaseClient; let cat: SupabaseClient;
  let annId = ''; let bobId = ''; let catId = '';
  let unlock: (() => void) | undefined;
  let db: ReturnType<typeof psql>;
  const q = (text: string, vars: Record<string, string> = {}) => sql(text, vars);

  beforeAll(async () => {
    unlock = await lockStack();
    db = psql();
    [ann, bob, cat] = [await provisionUser(stack!, email.ann, pw, mailIds), await provisionUser(stack!, email.bob, pw, mailIds), await provisionUser(stack!, email.cat, pw, mailIds)];
    [annId, bobId, catId] = (await Promise.all([ann, bob, cat].map((c) => c.auth.getUser()))).map((r) => r.data.user!.id) as [string, string, string];
    await makeReady(ann, 'IN'); await makeReady(bob, 'IN'); await makeReady(cat, 'IN');
  });
  afterAll(async () => {
    try {
      db?.close();
      for (const id of [annId, bobId, catId]) if (id) await purgeUserFiles(stack!, id);
      for (const e of Object.values(email)) {
        const found = (await (await fetch(`${stack!.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${e}`)}`)).json()) as { messages: { ID: string }[] };
        for (const m of found.messages) if (!mailIds.includes(m.ID)) mailIds.push(m.ID);
      }
      await cleanup(stack!, Object.values(email), mailIds);
    } finally { unlock?.(); }
  });

  /** A running job in one transaction (never visible as queued). */
  const runningJob = (uid: string, path: string, end: 'running' | 'failed' = 'running'): number =>
    Number(q(`begin;
      insert into app.jobs (user_id, type, input) values (:'u', 'photo', :'i'::jsonb) returning id;
      update app.jobs set status = 'running', attempts = 1 where id = (select max(id) from app.jobs where user_id = :'u');
      ${end === 'failed' ? "update app.jobs set status = 'failed', last_error = 'internal detail that must not be shown' where id = (select max(id) from app.jobs where user_id = :'u');" : ''}
      commit;`, { u: uid, i: JSON.stringify({ path }) }).split('\n').find((l) => /^[0-9]+$/.test(l)));
  const finishJob = (id: number, result: unknown) => q(`update app.jobs set status = 'done', result = :'r'::jsonb where id = :id`, { id: String(id), r: JSON.stringify(result) });
  /** What the real worker writes (LLD 7.3), and the three output files it would upload (here uploaded by the owner, which the policy allows). */
  async function workerOutputs(id: number, garment: unknown) {
    for (const n of ['cutout', 'thumb', 'orig-thumb']) {
      const r = await ann.storage.from('item-images').upload(`${annId}/${id}-${n}.webp`, WEBP, { contentType: 'image/webp' });
      expect(r.error).toBeNull();
    }
    return { path: `${annId}/${id}-cutout.webp`, thumb_path: `${annId}/${id}-thumb.webp`, original_thumb_path: `${annId}/${id}-orig-thumb.webp`, dominant_rgb: [200, 30, 40], garment };
  }
  const features = (over: Record<string, unknown> = {}) => ({ model_version: 'garment-cnn-v1', class: 7, p: 0.93, category: 'Footwear', sub_type: 'Sneakers', embedding, ...over });
  const flow = (deps: PhotoDeps, extra: { timeoutMs?: number; pollMs?: number } = {}) => addByPhoto(new Blob([WEBP], { type: 'image/webp' }), { ...deps, prepare: async () => prepared }, { signal: new AbortController().signal, ...extra });

  it('the whole flow: upload, job, wait, result, previews, pre-filled form, item with its image paths and its 32-number features row; nobody else can read any of it', async () => {
    const deps = photoDeps(ann, real);
    let jobId = 0;
    let outputs: Record<string, unknown> = {};
    // the worker: after the first read it claims (running), then finishes with its outputs
    let reads = 0;
    const out = await flow({
      ...deps,
      createJob: async (path) => { jobId = await deps.createJob(path); await db.run(`update app.jobs set status = 'running', attempts = attempts + 1 where id = ${jobId};`); return jobId; },
      readJob: async (id) => { if (++reads === 2) { outputs = await workerOutputs(id, features()); finishJob(id, outputs); } return deps.readJob(id); },
      sleep: async () => undefined,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.originalPath).toMatch(new RegExp(`^${annId}/[0-9a-f]{32}-original\\.webp$`));
    expect(q(`select status, attempts from app.jobs where id = :id`, { id: String(jobId) })).toBe('done|1');

    // the original really is in the private bucket, owner folder, and only its owner can read it
    expect((await ann.storage.from('item-images').download(out.result.originalPath)).error).toBeNull();
    expect((await bob.storage.from('item-images').download(out.result.originalPath)).error).not.toBeNull();
    expect((await bob.storage.from('item-images').list(annId)).data ?? []).toEqual([]);
    // previews: signed links work for the owner and fetch the bytes
    const urls = await previewUrls(ann, [out.result.thumbPath, out.result.originalThumbPath]);
    expect(Object.keys(urls).sort()).toEqual([out.result.originalThumbPath, out.result.thumbPath].sort());
    expect(Buffer.from(await (await fetch(urls[out.result.thumbPath]!)).arrayBuffer()).equals(WEBP)).toBe(true);
    expect(await previewUrls(bob, [out.result.thumbPath])).toEqual({});
    // another user cannot read the job
    expect((await bob.schema('app').from('jobs').select('id').eq('id', jobId)).data).toEqual([]);

    // the form is pre-filled (the result carries a confident garment) and the item saves with its picture and features
    const pre = prefillFrom(out.result);
    expect(pre.values).toMatchObject({ category: 'Footwear', subType: 'Sneakers' });
    const repo = new SupabaseRepository(ann);
    const item = await repo.items.create({
      name: pre.values.name, category: 'Footwear', subType: 'Sneakers', rgb: [200, 30, 40], hex: '#C81E28', colourFamily: 'Red', fit: null, material: null, pattern: null,
      seasons: [], occasions: [], condition: null, favourite: false, neverWorn: false, status: 'active', archiveReason: null, photo: attachmentOf(out.result, 'cutout'),
    });
    expect(q(`select origin, image_path, image_thumb_path from app.items where id = :'id'`, { id: item.id })).toBe(`photo|${annId}/${jobId}-cutout.webp|${annId}/${jobId}-thumb.webp`);
    expect(q(`select model_version, garment_class, garment_p, cardinality(embedding), user_id = :'u' from app.item_features where item_id = :'id'`, { id: item.id, u: annId })).toBe('garment-cnn-v1|7|0.93|32|t');
    expect(Number(q(`select embedding[2] * 1000 from app.item_features where item_id = :'id'`, { id: item.id }))).toBeCloseTo(32, 0);
    // keeping the original stores the original with its thumbnail
    const item2 = await repo.items.create({ ...item, name: 'Original kept', photo: attachmentOf(out.result, 'original') } as never);
    expect(q(`select image_path from app.items where id = :'id'`, { id: item2.id })).toBe(out.result.originalPath);
    // another person sees neither the item nor its features
    expect(await new SupabaseRepository(bob).items.list()).toEqual([]);
    expect((await bob.schema('app').from('item_features').select('item_id')).data).toEqual([]);
  });

  it('a result with the garment off (garment null) fills no category, and the item is saved with NO item_features row', async () => {
    const id = runningJob(annId, `${annId}/off-${run}.webp`);
    const r = await workerOutputs(id, null);
    finishJob(id, r);
    const out = await flow({ ...photoDeps(ann, real), upload: async () => ({ path: `${annId}/off-${run}.webp`, userId: annId }), createJob: async () => id });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const pre = prefillFrom(out.result);
    expect(pre.garmentSuggested).toBe(false);
    expect(pre.values.category).toBe('');
    const item = await new SupabaseRepository(ann).items.create({
      name: 'Red thing', category: 'Tops', subType: 'T-shirt', rgb: [200, 30, 40], hex: '#C81E28', colourFamily: 'Red', fit: null, material: null, pattern: null,
      seasons: [], occasions: [], condition: null, favourite: false, neverWorn: false, status: 'active', archiveReason: null, photo: attachmentOf(out.result, 'cutout'),
    });
    expect(q(`select count(*) from app.item_features where item_id = :'id'`, { id: item.id })).toBe('0');
    expect(q(`select origin from app.items where id = :'id'`, { id: item.id })).toBe('photo');
  });

  it('a failed job shows the fixed sentence and never the stored error text', async () => {
    const id = runningJob(annId, `${annId}/f-${run}.webp`, 'failed');
    const out = await flow({ ...photoDeps(ann, real), upload: async () => ({ path: `${annId}/f-${run}.webp`, userId: annId }), createJob: async () => id });
    expect(out).toEqual({ ok: false, failure: 'failed', message: FAILED_MESSAGE });
    expect(JSON.stringify(out)).not.toContain('internal detail');
  });

  it('a job that never finishes ends at the timeout with the clear message after a bounded number of reads, in real time', async () => {
    const id = runningJob(annId, `${annId}/t-${run}.webp`);
    const base = photoDeps(ann, real);
    let reads = 0;
    const started = Date.now();
    const out = await flow({ ...base, upload: async () => ({ path: `${annId}/t-${run}.webp`, userId: annId }), createJob: async () => id, readJob: async (i) => { reads++; return base.readJob(i); } }, { timeoutMs: 2500, pollMs: 500 });
    expect(out).toEqual({ ok: false, failure: 'timeout', message: TIMEOUT_MESSAGE });
    expect(Date.now() - started).toBeLessThan(6000);
    expect(reads).toBeLessThanOrEqual(6);
  });

  it('a result that names another user\'s file is refused as unreadable', async () => {
    const id = runningJob(annId, `${annId}/x-${run}.webp`);
    finishJob(id, { path: `${bobId}/steal.webp`, thumb_path: `${annId}/${id}-thumb.webp`, original_thumb_path: `${annId}/${id}-orig-thumb.webp`, dominant_rgb: null, garment: null });
    const out = await flow({ ...photoDeps(ann, real), upload: async () => ({ path: `${annId}/x-${run}.webp`, userId: annId }), createJob: async () => id });
    expect(out).toMatchObject({ ok: false, failure: 'unreadable' });
  });

  it('the hourly limit (20 jobs) is refused by the database and shown in plain words; no file other than the owner\'s folder is accepted', async () => {
    q(`begin;
       insert into app.jobs (user_id, type, input) select :'u', 'photo', jsonb_build_object('path', :'u' || '/l-' || g || '.webp') from generate_series(1, 20) g;
       update app.jobs set status = 'running', attempts = 1 where user_id = :'u';
       commit;`, { u: catId });
    const out = await flow(photoDeps(cat, real));
    expect(out).toEqual({ ok: false, failure: 'job', message: JOB_REFUSED_MESSAGE });
    // an upload into someone else's folder is refused by the storage policy (the bucket is private)
    expect((await cat.storage.from('item-images').upload(`${annId}/evil-${run}.webp`, WEBP, { contentType: 'image/webp' })).error).not.toBeNull();
  });

  it('only image types are accepted by the bucket (a text file is refused), and nothing can be deleted by the user (so unchosen files stay until Leave)', async () => {
    expect((await ann.storage.from('item-images').upload(`${annId}/note-${run}.txt`, Buffer.from('hello'), { contentType: 'text/plain' })).error).not.toBeNull();
    const kept = `${annId}/keep-${run}.webp`;
    expect((await ann.storage.from('item-images').upload(kept, WEBP, { contentType: 'image/webp' })).error).toBeNull();
    await ann.storage.from('item-images').remove([kept]);
    expect((await ann.storage.from('item-images').download(kept)).error).toBeNull(); // still there: no delete policy for users (LLD 4.6)
  });
});
