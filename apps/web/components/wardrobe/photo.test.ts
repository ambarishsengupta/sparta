/// <reference types="vite/client" />
import type { SupabaseClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { a11yProblems } from '../../test-support/a11y';
import { SUGGESTED_LABEL, parsePhotoResult, prefillFrom } from '../../lib/photo-flow';
import { ItemForm } from './ItemForm';
import type { PhotoStart } from './ItemForm';
import { PhotoItemFlow } from './PhotoItemFlow';
import { BUCKET, browserEnv, photoDeps, previewUrls } from './photo-backend';

// Add by photo, component and backend level (WO-0073): static renders and a fake Supabase client. No browser, no network.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const UID = '5c1b3b52-0000-4000-8000-0000000000aa';
const embedding = Array.from({ length: 32 }, (_, i) => i / 31);
const result = (garment: unknown) => ({ path: `${UID}/7-cutout.webp`, thumb_path: `${UID}/7-thumb.webp`, original_thumb_path: `${UID}/7-orig-thumb.webp`, dominant_rgb: [10, 20, 30], garment });
const start = (garment: unknown): PhotoStart => {
  const r = parsePhotoResult(result(garment), UID, `${UID}/o-original.webp`)!;
  return { ...prefillFrom(r), photo: { imagePath: r.path, imageThumbPath: r.thumbPath, features: r.garment?.features ?? null } };
};
const sneakers = { model_version: 'garment-cnn-v1', class: 7, p: 0.93, category: 'Footwear', sub_type: 'Sneakers', embedding };
const html = (s?: PhotoStart) => renderToStaticMarkup(createElement(ItemForm, s ? { photoStart: s } : {}));

describe('the pre-filled add-item form (FR-23a)', () => {
  it('a result WITHOUT a garment (the default) shows NO garment suggestion: empty category and sub-type, no label', () => {
    const out = html(start(null));
    expect(out).not.toContain('data-suggestion="garment"');
    expect(out).toContain('<label>Category<select><option value="" selected="">Not set</option>');
    expect(out).toContain('<label>Sub-type<select><option value="" selected="">Not set</option></select>');
    expect(out).not.toMatch(/<option selected="">(Tops|Bottoms|Footwear|Outerwear)/);
    expect(out).toContain('data-suggestion="colour"'); // the dominant colour is still offered, labelled
  });
  it('a result with a confident garment pre-fills category and sub-type and labels them "Suggested from your photo"', () => {
    const out = html(start(sneakers));
    expect(out).toContain('data-suggestion="garment"');
    expect(out).toContain(SUGGESTED_LABEL);
    expect(out).toContain('<option selected="">Footwear</option>');
    expect(out).toContain('<option selected="">Sneakers</option>');
  });
  it('a garment with no category (below the confidence) is not labelled', () => {
    expect(html(start({ ...sneakers, category: null, sub_type: null }))).not.toContain('data-suggestion="garment"');
  });
  it('the manual form has no suggestion label at all', () => { expect(html()).not.toContain('Suggested from your photo'); });
  it('the form has accessible names and no a11y problems with a suggestion shown', () => { expect(a11yProblems(html(start(sneakers)))).toEqual([]); });
  it('the label is tied to the unchanged suggestion: the source drops it once the value differs', () => {
    const src = import.meta.glob<string>('./ItemForm.tsx', { query: '?raw', import: 'default', eager: true })['./ItemForm.tsx']!;
    expect(src).toContain('values.category === start?.category && values.subType === start?.subType');
    expect(src).toContain('values.hex === start?.hex');
  });
});

describe('the add-by-photo screen', () => {
  it('without the account backend it says so and offers the manual form; it has no file input', () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'local');
    const out = renderToStaticMarkup(createElement(PhotoItemFlow));
    expect(out).toContain('needs your account');
    expect(out).toContain('href="/items/new"');
    expect(out).not.toContain('type="file"');
  });
  it('with the account backend the first step has a labelled image file input, a manual alternative, and passes the accessibility checks', () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase');
    const out = renderToStaticMarkup(createElement(PhotoItemFlow));
    expect(out).toMatch(/<label[^>]*>Choose a photo<input[^>]*type="file"[^>]*accept="image\/\*"/);
    expect(out).toContain('Add the item without a photo');
    expect(a11yProblems(out)).toEqual([]);
  });
});

describe('the screen\'s source', () => {
  const src = import.meta.glob<string>(['./PhotoItemFlow.tsx', './photo-backend.ts'], { query: '?raw', import: 'default', eager: true });
  const flow = src['./PhotoItemFlow.tsx']!;
  it('stops the wait when the page is left: aborts the controller in the effect cleanup, and polls with no interval of its own', () => {
    expect(flow).toContain('useEffect(() => () => control.current?.abort(), [])');
    expect(flow).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    expect(flow).toContain('abortableSleep');
  });
  it('shows the failure sentence in an alert and the stage in a status region', () => {
    expect(flow).toContain('<p role="alert" className="error">{message}</p>');
    expect(flow).toContain('role="status"');
  });
  it('every picture has alt text, and the choice is a radio group inside a labelled fieldset', () => {
    expect([...flow.matchAll(/<img\b[^>]*>/g)].every((m) => /\balt=/.test(m[0]))).toBe(true);
    expect(flow).toContain('<legend>Which picture should we keep?</legend>');
    expect(flow).toContain('type="radio"');
  });
  it('uses no raw HTML, no secret key and no key of any kind', () => {
    for (const text of Object.values(src)) expect(text).not.toMatch(new RegExp(['dangerously', 'secret', ['service', 'role'].join('_'), 'process\\.env'].join('|'), 'i'));
  });
});

// ---- the Supabase side, over a fake client ----------------------------------------------------------------------------------
type Upload = { path: string; body: unknown; opts: Record<string, unknown> };
function fakeClient(o: { session?: boolean; uploadError?: { message: string; statusCode?: string } | null; insert?: { data: unknown; error: unknown; status?: number }; select?: { data: unknown; error: unknown; status?: number }; signed?: unknown } = {}) {
  const uploads: Upload[] = []; const inserts: Record<string, unknown>[] = []; const selects: [string, unknown][] = []; let bucket = '';
  const builder = (answer: () => unknown): unknown => new Proxy({}, { get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => unknown) => Promise.resolve(answer()).then(res) : (...args: unknown[]) => { if (prop === 'insert') inserts.push(args[0] as Record<string, unknown>); if (prop === 'eq') selects.push([String(args[0]), args[1]]); return builder(answer); }) });
  const client = {
    auth: { getSession: async () => ({ data: { session: o.session === false ? null : { user: { id: UID } } }, error: null }) },
    storage: { from: (b: string) => { bucket = b; return {
      upload: async (path: string, body: unknown, opts: Record<string, unknown>) => { uploads.push({ path, body, opts }); return { data: null, error: o.uploadError ?? null }; },
      createSignedUrls: async () => o.signed ?? { data: [{ path: `${UID}/a.webp`, signedUrl: 'https://x/a' }, { path: `${UID}/b.webp`, signedUrl: null }], error: null },
    }; } },
    schema: (s: string) => ({ from: (t: string) => { if (s !== 'app' || t !== 'jobs') throw new Error('unexpected table'); return builder(() => (inserts.length > 0 && !selects.length ? (o.insert ?? { data: { id: 41 }, error: null, status: 201 }) : (o.select ?? { data: { status: 'running', result: null }, error: null, status: 200 }))); } }),
  } as unknown as SupabaseClient;
  return { client, uploads, inserts, selects, bucket: () => bucket };
}
const prepared = { blob: { type: 'image/webp', size: 3 } as unknown as Blob, type: 'image/webp', ext: 'webp', width: 1, height: 1 } as const;
const sleep = async () => undefined;

describe('photoDeps over a fake client', () => {
  it('uploads into item-images directly under the owner folder with a random name, the encoded type, and no overwrite', async () => {
    const f = fakeClient();
    const out = await photoDeps(f.client, sleep).upload(prepared);
    expect(f.bucket()).toBe(BUCKET);
    expect(BUCKET).toBe('item-images');
    expect(out.userId).toBe(UID);
    expect(out.path).toMatch(new RegExp(`^${UID}/[0-9a-f]{32}-original\\.webp$`));
    expect(f.uploads[0]).toMatchObject({ path: out.path, opts: { contentType: 'image/webp', upsert: false } });
    const again = await photoDeps(f.client, sleep).upload(prepared);
    expect(again.path).not.toBe(out.path);
  });
  it('a JPEG fallback is uploaded as image/jpeg with a .jpg name', async () => {
    const f = fakeClient();
    const out = await photoDeps(f.client, sleep).upload({ ...prepared, type: 'image/jpeg', ext: 'jpg' });
    expect(out.path.endsWith('-original.jpg')).toBe(true);
    expect(f.uploads[0]!.opts.contentType).toBe('image/jpeg');
  });
  it('the uploaded name fits the database\'s file-name check', async () => {
    const out = await photoDeps(fakeClient().client, sleep).upload(prepared);
    expect(out.path.slice(UID.length + 1)).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
  });
  it('no session is a session error and uploads nothing; a refusal by the storage policy is a "refused" error', async () => {
    const none = fakeClient({ session: false });
    await expect(photoDeps(none.client, sleep).upload(prepared)).rejects.toMatchObject({ kind: 'session' });
    expect(none.uploads).toEqual([]);
    const refused = fakeClient({ uploadError: { message: 'new row violates row-level security policy', statusCode: '403' } });
    await expect(photoDeps(refused.client, sleep).upload(prepared)).rejects.toMatchObject({ kind: 'refused' });
  });
  it('server text never reaches the error message', async () => {
    const f = fakeClient({ uploadError: { message: 'bucket item-images secret detail', statusCode: '500' } });
    await expect(photoDeps(f.client, sleep).upload(prepared)).rejects.toSatisfy((e: Error) => !/bucket|secret|item-images/.test(e.message));
  });
  it('creates the job with exactly user_id, type photo and the path as input, and returns its numeric id', async () => {
    const f = fakeClient();
    expect(await photoDeps(f.client, sleep).createJob(`${UID}/a.webp`)).toBe(41);
    expect(f.inserts).toEqual([{ user_id: UID, type: 'photo', input: { path: `${UID}/a.webp` } }]);
  });
  it('a job insert that returns no numeric id is an error; a refused insert is "refused"', async () => {
    await expect(photoDeps(fakeClient({ insert: { data: { id: 'x' }, error: null } }).client, sleep).createJob('p')).rejects.toMatchObject({ kind: 'unexpected' });
    await expect(photoDeps(fakeClient({ insert: { data: null, error: { code: '42501', message: 'rls' }, status: 403 } }).client, sleep).createJob('p')).rejects.toMatchObject({ kind: 'refused' });
  });
  it('reads a job by id and maps status and result; an unknown status or a missing row reads as null', async () => {
    const done = fakeClient({ select: { data: { status: 'done', result: { path: 'x' } }, error: null, status: 200 } });
    expect(await photoDeps(done.client, sleep).readJob(41)).toEqual({ status: 'done', result: { path: 'x' } });
    expect(done.selects).toEqual([['id', 41]]);
    expect(await photoDeps(fakeClient({ select: { data: { status: 'weird', result: null }, error: null } }).client, sleep).readJob(1)).toBeNull();
    expect(await photoDeps(fakeClient({ select: { data: null, error: null } }).client, sleep).readJob(1)).toBeNull();
    await expect(photoDeps(fakeClient({ select: { data: null, error: { code: 'x', message: 'm' }, status: 500 } }).client, sleep).readJob(1)).rejects.toMatchObject({ kind: 'unexpected' });
  });
  it('preview links are short-lived and a path that could not be signed is left out', async () => {
    const f = fakeClient();
    expect(await previewUrls(f.client, [`${UID}/a.webp`, `${UID}/b.webp`])).toEqual({ [`${UID}/a.webp`]: 'https://x/a' });
    expect(await previewUrls(fakeClient({ signed: { data: null, error: { message: 'x' } } }).client, ['p'])).toEqual({});
  });
  it('the source asks for 10-minute links and for nothing else from storage', () => {
    const text = import.meta.glob<string>('./photo-backend.ts', { query: '?raw', import: 'default', eager: true })['./photo-backend.ts']!;
    expect(text).toContain('createSignedUrls([...paths], 600)');
    expect(text).not.toMatch(/\.remove\(|\.list\(|\.download\(|\.update\(|\.move\(|\.copy\(/);
  });
});

describe('browserEnv', () => {
  it('decodes with the picture\'s own orientation applied', async () => {
    const decode = vi.fn(async () => ({ width: 2, height: 3 }));
    vi.stubGlobal('createImageBitmap', decode);
    const file = { type: 'image/jpeg', size: 1 } as unknown as Blob;
    await browserEnv().decode(file);
    expect(decode).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
  });
  it('draws on a canvas of the asked size and encodes with the asked type and quality', async () => {
    const draws: unknown[][] = []; const asked: unknown[][] = [];
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...a: unknown[]) => draws.push(a) }), toBlob: (cb: (b: Blob | null) => void, ...rest: unknown[]) => { asked.push(rest); cb({ type: 'image/webp', size: 9 } as unknown as Blob); } };
    vi.stubGlobal('document', { createElement: (tag: string) => { expect(tag).toBe('canvas'); return canvas; } });
    const bitmap = { width: 4000, height: 3000 };
    const blob = await browserEnv().encode(bitmap, 1200, 900, 'image/webp', 0.85);
    expect(blob).toMatchObject({ type: 'image/webp' });
    expect(canvas).toMatchObject({ width: 1200, height: 900 });
    expect(draws[0]).toEqual([bitmap, 0, 0, 1200, 900]);
    expect(asked[0]).toEqual(['image/webp', 0.85]);
  });
  it('no 2d context gives null instead of a throw', async () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    expect(await browserEnv().encode({ width: 1, height: 1 }, 1, 1, 'image/webp', 0.8)).toBeNull();
  });
});
