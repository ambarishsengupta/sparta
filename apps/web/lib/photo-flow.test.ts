import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrepareError } from './image-prep';
import type { Prepared } from './image-prep';
import {
  FAILED_MESSAGE, JOB_REFUSED_MESSAGE, MAX_READ_FAILURES, POLL_MS, SUGGESTED_LABEL, TIMEOUT_MESSAGE, TIMEOUT_MS, UNREADABLE_MESSAGE, UPLOAD_REFUSED_MESSAGE,
  abortableSleep, addByPhoto, attachmentOf, parsePhotoResult, prefillFrom,
} from './photo-flow';
import type { JobRow, PhotoDeps, Stage } from './photo-flow';
import { RepositoryError } from './supabase/errors';

// The add-by-photo flow with fakes (WO-0073): no browser, no network, a fake clock.
const UID = '5c1b3b52-0000-4000-8000-0000000000aa';
const ORIGINAL = `${UID}/abc-original.webp`;
const embedding = Array.from({ length: 32 }, (_, i) => i / 10);
const garment = { model_version: 'garment-cnn-v1', class: 7, p: 0.93, category: 'Footwear', sub_type: 'Sneakers', embedding };
const result = (over: Record<string, unknown> = {}) => ({
  path: `${UID}/7-cutout.webp`, thumb_path: `${UID}/7-thumb.webp`, original_thumb_path: `${UID}/7-orig-thumb.webp`, dominant_rgb: [10, 20, 30], garment: null, ...over,
});
const PREPARED = { blob: { type: 'image/webp', size: 5 }, type: 'image/webp', ext: 'webp', width: 10, height: 10 } as unknown as Prepared;

function harness(jobs: (JobRow | Error | null)[] | ((n: number) => JobRow | Error | null), over: Partial<PhotoDeps> = {}) {
  let clock = 0;
  const log: string[] = [];
  const sleeps: number[] = [];
  let reads = 0;
  const deps: PhotoDeps = {
    prepare: async () => { log.push('prepare'); return PREPARED; },
    upload: async () => { log.push('upload'); return { path: ORIGINAL, userId: UID }; },
    createJob: async (path) => { log.push(`job:${path}`); return 7; },
    readJob: async () => {
      const n = reads++;
      const r = typeof jobs === 'function' ? jobs(n) : (jobs[Math.min(n, jobs.length - 1)] ?? null);
      if (r instanceof Error) throw r;
      return r;
    },
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    now: () => clock,
    ...over,
  };
  return { deps, log, sleeps, reads: () => reads, advance: (ms: number) => { clock += ms; } };
}
const run = (h: ReturnType<typeof harness>, extra: { onStage?: (s: Stage) => void; signal?: AbortSignal; pollMs?: number; timeoutMs?: number } = {}) =>
  addByPhoto({ type: 'image/jpeg', size: 10 } as unknown as Blob, h.deps, { signal: extra.signal ?? new AbortController().signal, ...extra });
const done = (garmentValue: unknown = null): JobRow => ({ status: 'done', result: result({ garment: garmentValue }) });

describe('parsePhotoResult', () => {
  it('reads a result with the model off (garment null): paths, colour, no garment', () => {
    expect(parsePhotoResult(result(), UID, ORIGINAL)).toEqual({
      path: `${UID}/7-cutout.webp`, thumbPath: `${UID}/7-thumb.webp`, originalThumbPath: `${UID}/7-orig-thumb.webp`, originalPath: ORIGINAL, dominantHex: '#0A141E', garment: null,
    });
  });
  it('reads the garment: category, sub-type, class, p and exactly 32 numbers', () => {
    const r = parsePhotoResult(result({ garment }), UID, ORIGINAL)!;
    expect(r.garment).toEqual({ features: { modelVersion: 'garment-cnn-v1', garmentClass: 7, p: 0.93, embedding }, category: 'Footwear', subType: 'Sneakers' });
  });
  it('keeps the features but suggests nothing when category and sub-type are null (below the confidence, or Dress)', () => {
    const r = parsePhotoResult(result({ garment: { ...garment, category: null, sub_type: null, class: 3 } }), UID, ORIGINAL)!;
    expect(r.garment!.category).toBeNull(); expect(r.garment!.subType).toBeNull(); expect(r.garment!.features.embedding).toHaveLength(32);
  });
  it('a pair that is not in the taxonomy suggests nothing', () => {
    for (const [category, sub_type] of [['Tops', 'Sneakers'], ['Nonsense', 'T-shirt'], ['Tops', null], [null, 'T-shirt'], [5, 6]])
      expect(parsePhotoResult(result({ garment: { ...garment, category, sub_type } }), UID, ORIGINAL)!.garment!.category).toBeNull();
  });
  it('drops a garment whose numbers are not sound: wrong count, NaN, a string, another model version, a missing version', () => {
    const bad = [
      { ...garment, embedding: embedding.slice(0, 31) }, { ...garment, embedding: [...embedding, 1] }, { ...garment, embedding: [...embedding.slice(1), Number.NaN] },
      { ...garment, embedding: [...embedding.slice(1), '1'] }, { ...garment, embedding: [...embedding.slice(1), null] }, { ...garment, model_version: 'garment-cnn-v2' },
      { ...garment, model_version: undefined }, { ...garment, embedding: 'x' }, 'garment', [], 5,
    ];
    for (const g of bad) expect(parsePhotoResult(result({ garment: g }), UID, ORIGINAL)!.garment, JSON.stringify(g).slice(0, 60)).toBeNull();
  });
  it('an out-of-range class or probability is stored as null, not as given', () => {
    const f = parsePhotoResult(result({ garment: { ...garment, class: 10, p: 1.5 } }), UID, ORIGINAL)!.garment!.features;
    expect(f.garmentClass).toBeNull(); expect(f.p).toBeNull();
    expect(parsePhotoResult(result({ garment: { ...garment, class: 0, p: 0 } }), UID, ORIGINAL)!.garment!.features).toMatchObject({ garmentClass: 0, p: 0 });
  });
  it('refuses a result with a path outside the owner\'s folder, a nested or odd path, or a missing field', () => {
    const other = '5c1b3b52-0000-4000-8000-0000000000bb';
    for (const bad of [{ path: `${other}/7-cutout.webp` }, { thumb_path: `${other}/x.webp` }, { original_thumb_path: '../x.webp' }, { path: `${UID}/a/b.webp` }, { path: `${UID}/` }, { path: 5 }, { path: undefined }, { thumb_path: undefined }])
      expect(parsePhotoResult(result(bad), UID, ORIGINAL), JSON.stringify(bad)).toBeNull();
    expect(parsePhotoResult(null, UID, ORIGINAL)).toBeNull();
    expect(parsePhotoResult([], UID, ORIGINAL)).toBeNull();
    expect(parsePhotoResult(result(), UID, `${UID}/../x`)).toBeNull();
    expect(parsePhotoResult(result(), UID, 'elsewhere/x.webp')).toBeNull();
  });
  it('a missing or malformed colour is no colour', () => {
    for (const rgb of [undefined, [1, 2], [1, 2, 3, 4], [1, 2, 256], [1, 2, -1], [1, 2, 1.5], ['1', 2, 3]]) expect(parsePhotoResult(result({ dominant_rgb: rgb }), UID, ORIGINAL)!.dominantHex).toBeNull();
    expect(parsePhotoResult(result({ dominant_rgb: [255, 0, 128] }), UID, ORIGINAL)!.dominantHex).toBe('#FF0080');
  });
});

describe('prefillFrom and attachmentOf', () => {
  it('with no garment (the default: the guess switch is off) the form has NO category or sub-type and nothing is labelled as a garment suggestion', () => {
    const p = prefillFrom(parsePhotoResult(result(), UID, ORIGINAL)!);
    expect(p.garmentSuggested).toBe(false);
    expect(p.values.category).toBe(''); expect(p.values.subType).toBe('');
    expect(p.colourSuggested).toBe(true); expect(p.values.hex).toBe('#0a141e');
  });
  it('a garment without a category pair also pre-fills nothing', () => {
    const p = prefillFrom(parsePhotoResult(result({ garment: { ...garment, category: null, sub_type: null } }), UID, ORIGINAL)!);
    expect(p.garmentSuggested).toBe(false); expect(p.values.category).toBe('');
  });
  it('a confident garment pre-fills category and sub-type, and the name follows colour and sub-type', () => {
    const p = prefillFrom(parsePhotoResult(result({ garment }), UID, ORIGINAL)!);
    expect(p.garmentSuggested).toBe(true);
    expect(p.values).toMatchObject({ category: 'Footwear', subType: 'Sneakers' });
    expect(p.values.name).toMatch(/Sneakers$/);
  });
  it('no colour in the result leaves the default colour and no colour label', () => {
    const p = prefillFrom(parsePhotoResult(result({ dominant_rgb: null }), UID, ORIGINAL)!);
    expect(p.colourSuggested).toBe(false); expect(p.values.hex).toBe('#808080');
  });
  it('the label text is exactly the one the specification names', () => { expect(SUGGESTED_LABEL).toBe('Suggested from your photo'); });
  it('accepting the cut-out stores the cut-out and its thumbnail; keeping the original stores the original and its thumbnail; features come with either', () => {
    const r = parsePhotoResult(result({ garment }), UID, ORIGINAL)!;
    expect(attachmentOf(r, 'cutout')).toEqual({ imagePath: `${UID}/7-cutout.webp`, imageThumbPath: `${UID}/7-thumb.webp`, features: r.garment!.features });
    expect(attachmentOf(r, 'original')).toEqual({ imagePath: ORIGINAL, imageThumbPath: `${UID}/7-orig-thumb.webp`, features: r.garment!.features });
  });
  it('without a garment there are no features to store', () => {
    expect(attachmentOf(parsePhotoResult(result(), UID, ORIGINAL)!, 'cutout').features).toBeNull();
  });
});

describe('addByPhoto', () => {
  it('runs prepare, upload, job and one read when the job is already done, and returns the validated result', async () => {
    const h = harness([done(garment)]);
    const stages: Stage[] = [];
    const out = await run(h, { onStage: (s) => stages.push(s) });
    expect(out.ok).toBe(true);
    expect(h.log).toEqual(['prepare', 'upload', `job:${ORIGINAL}`]);
    expect(stages).toEqual(['preparing', 'uploading', 'queued']);
    expect(h.sleeps).toEqual([]);
    if (out.ok) expect(out.result.garment?.category).toBe('Footwear');
  });
  it('polls while queued and running, and reports the processing stage', async () => {
    const h = harness([{ status: 'queued', result: null }, { status: 'running', result: null }, done()]);
    const stages: Stage[] = [];
    const out = await run(h, { onStage: (s) => stages.push(s) });
    expect(out.ok).toBe(true);
    expect(h.reads()).toBe(3);
    expect(h.sleeps).toEqual([POLL_MS, POLL_MS]);
    expect(stages).toContain('processing');
  });
  it('gives up at the hard timeout with the timeout sentence, after a bounded number of reads', async () => {
    const h = harness([{ status: 'running', result: null }]);
    const out = await run(h);
    expect(out).toEqual({ ok: false, failure: 'timeout', message: TIMEOUT_MESSAGE });
    expect(h.reads()).toBeLessThanOrEqual(TIMEOUT_MS / POLL_MS + 1);
    expect(h.sleeps.reduce((a, b) => a + b, 0)).toBe(TIMEOUT_MS);
  });
  it('the timeout is checked even when every read is slow (the clock moves during the read)', async () => {
    const h = harness([{ status: 'queued', result: null }]);
    const read = h.deps.readJob;
    h.deps.readJob = async (id) => { h.advance(70_000); return read(id); };
    const out = await run(h, { timeoutMs: 100_000 });
    expect(out).toMatchObject({ ok: false, failure: 'timeout' });
    expect(h.reads()).toBe(2);
  });
  it('the last sleep never goes past the deadline', async () => {
    const h = harness([{ status: 'queued', result: null }]);
    await run(h, { pollMs: 700, timeoutMs: 2000 });
    expect(h.sleeps).toEqual([700, 700, 600]);
  });
  it('a failed job gives the fixed failure sentence and never the stored error text', async () => {
    const h = harness([{ status: 'failed', result: null }]);
    const out = await run(h);
    expect(out).toEqual({ ok: false, failure: 'failed', message: FAILED_MESSAGE });
  });
  it('the sentences shown for a failed or slow photo are the fixed ones, in plain words', () => {
    expect(FAILED_MESSAGE).toBe('We could not prepare that photo. Try another photo, or add the item without one.');
    expect(TIMEOUT_MESSAGE).toBe('Preparing your photo is taking longer than expected, so we stopped waiting. You can try again later, or add the item without a photo.');
    for (const m of [FAILED_MESSAGE, TIMEOUT_MESSAGE, UNREADABLE_MESSAGE, JOB_REFUSED_MESSAGE, UPLOAD_REFUSED_MESSAGE]) expect(m).not.toMatch(/internal|error code|exception|stack|app\.jobs|item-images/i);
  });
  it('a done job whose result cannot be read (another user\'s path) is "unreadable", not a success', async () => {
    const h = harness([{ status: 'done', result: result({ path: '5c1b3b52-0000-4000-8000-0000000000bb/x.webp' }) }]);
    expect(await run(h)).toEqual({ ok: false, failure: 'unreadable', message: UNREADABLE_MESSAGE });
  });
  it('a dropped connection during the wait ends after three reads in a row fail, but one failure in between is forgiven', async () => {
    const net = new RepositoryError('network', false);
    const down = harness([net]);
    expect(await run(down)).toMatchObject({ ok: false, failure: 'job', message: net.message });
    expect(down.reads()).toBe(MAX_READ_FAILURES);
    const blip = harness([net, { status: 'running', result: null }, net, done()]);
    expect((await run(blip)).ok).toBe(true);
  });
  it('a job that is not visible (null) is waited for until the timeout', async () => {
    const h = harness([null]);
    expect(await run(h, { timeoutMs: 6000 })).toMatchObject({ failure: 'timeout' });
  });
  it('a prepare failure stops before any upload and uses the image sentence', async () => {
    const h = harness([done()], { prepare: async () => { throw new PrepareError('not_image'); } });
    const out = await run(h);
    expect(out).toEqual({ ok: false, failure: 'prepare', message: new PrepareError('not_image').message });
    expect(h.log).toEqual([]);
  });
  it('an upload refused by the storage policy says the storage may be full; no job is created', async () => {
    const h = harness([done()], { upload: async () => { throw new RepositoryError('refused', true); } });
    expect(await run(h)).toEqual({ ok: false, failure: 'upload', message: UPLOAD_REFUSED_MESSAGE });
    expect(h.log).toEqual(['prepare']);
  });
  it('an upload that fails on the network uses the network sentence', async () => {
    const h = harness([done()], { upload: async () => { throw new TypeError('x'); } });
    expect(await run(h)).toEqual({ ok: false, failure: 'upload', message: new RepositoryError('network', true).message });
  });
  it('a job refused (the hourly limit, or no consent) says so in plain words', async () => {
    const h = harness([done()], { createJob: async () => { throw new RepositoryError('refused', true); } });
    expect(await run(h)).toEqual({ ok: false, failure: 'job', message: JOB_REFUSED_MESSAGE });
  });
  it('an abort during the wait stops at once with "cancelled", reads nothing further and shows no message', async () => {
    const ctl = new AbortController();
    const h = harness([{ status: 'queued', result: null }], { sleep: async () => { ctl.abort(); } });
    const out = await run(h, { signal: ctl.signal });
    expect(out).toEqual({ ok: false, failure: 'cancelled', message: '' });
    expect(h.reads()).toBe(1);
  });
  it('an abort before the upload stops the flow before the upload is made', async () => {
    const ctl = new AbortController();
    const h = harness([done()], { prepare: async () => { ctl.abort(); return PREPARED; } });
    expect(await run(h, { signal: ctl.signal })).toMatchObject({ failure: 'cancelled' });
    expect(h.log).toEqual([]);
  });
  it('an abort while the last read is in flight discards its answer', async () => {
    const ctl = new AbortController();
    const h = harness([done()]);
    const read = h.deps.readJob;
    h.deps.readJob = async (id) => { const r = await read(id); ctl.abort(); return r; };
    expect(await run(h, { signal: ctl.signal })).toMatchObject({ ok: false, failure: 'cancelled' });
  });
});

describe('abortableSleep', () => {
  afterEach(() => vi.useRealTimers());
  it('resolves after the time and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const ctl = new AbortController();
    let ended = false;
    const p = abortableSleep(5000, ctl.signal).then(() => { ended = true; });
    await vi.advanceTimersByTimeAsync(4999);
    expect(ended).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(ended).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('an abort ends it at once and clears the timer (the page was left)', async () => {
    vi.useFakeTimers();
    const ctl = new AbortController();
    const p = abortableSleep(60_000, ctl.signal);
    expect(vi.getTimerCount()).toBe(1);
    ctl.abort();
    await p;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('an already aborted signal does not even start a timer', async () => {
    vi.useFakeTimers();
    const ctl = new AbortController(); ctl.abort();
    await abortableSleep(60_000, ctl.signal);
    expect(vi.getTimerCount()).toBe(0);
  });
});
