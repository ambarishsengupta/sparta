import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ITEM_MAX_SIDE, MAX_SOURCE_BYTES, MAX_UPLOAD_BYTES, PrepareError, QUALITIES, SIDE_FACTORS, fitWithin, prepareImage } from './image-prep';
import type { Bitmap, PrepEnv } from './image-prep';

// Browser re-encoding of item photos (LLD 9.4; WO-0073), driven with a fake canvas so no browser is needed.
const image = (size = 1000, type = 'image/jpeg'): Blob => ({ type, size } as unknown as Blob);
const blobOf = (type: string, size: number): Blob => ({ type, size } as unknown as Blob);

function fakeEnv(opts: { bitmap?: Bitmap; decodeFails?: boolean; encode?: (type: string, quality: number, w: number, h: number) => Blob | null | Error } = {}) {
  const calls: { type: string; quality: number; w: number; h: number }[] = [];
  let closed = 0;
  const bitmap: Bitmap = opts.bitmap ?? { width: 4000, height: 3000 };
  const env: PrepEnv = {
    decode: async () => { if (opts.decodeFails) throw new Error('undecodable'); return { ...bitmap, close: () => { closed++; } }; },
    encode: async (_b, w, h, type, quality) => {
      calls.push({ type, quality, w, h });
      const r = opts.encode ? opts.encode(type, quality, w, h) : blobOf(type, 200_000);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { env, calls, closed: () => closed };
}
const failure = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof PrepareError) return e.failure; throw e; } throw new Error('did not reject'); };

describe('fitWithin', () => {
  it('scales the long side down to the limit and keeps the proportions', () => {
    expect(fitWithin(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 });
    expect(fitWithin(3000, 4000, 1200)).toEqual({ width: 900, height: 1200 });
    expect(fitWithin(1200, 1200, 1200)).toEqual({ width: 1200, height: 1200 });
  });
  it('never makes a small picture larger', () => { expect(fitWithin(300, 200, 1200)).toEqual({ width: 300, height: 200 }); });
  it('never returns less than one pixel, even for a very thin picture', () => { expect(fitWithin(10_000, 1, 1200)).toEqual({ width: 1200, height: 1 }); });
  it('property: the long side is at most the limit, both sides are at least 1, and the picture is never enlarged', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 20_000 }), fc.integer({ min: 1, max: 20_000 }), fc.integer({ min: 16, max: 4000 }), (w, h, max) => {
      const r = fitWithin(w, h, max);
      expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(max);
      expect(r.width).toBeGreaterThanOrEqual(1); expect(r.height).toBeGreaterThanOrEqual(1);
      expect(r.width).toBeLessThanOrEqual(w); expect(r.height).toBeLessThanOrEqual(h);
    }), { numRuns: 300 });
  });
});

describe('prepareImage', () => {
  it('the limits are the documented ones', () => {
    expect(ITEM_MAX_SIDE).toBe(1200);
    expect(MAX_UPLOAD_BYTES).toBeLessThan(5 * 1024 * 1024); // the item-images bucket limit
    expect([...QUALITIES]).toEqual([0.85, 0.7, 0.55]);
    expect([...SIDE_FACTORS]).toEqual([1, 0.7]);
  });
  it('re-encodes as WebP at most 1,200 pixels on the long side with the first quality, and closes the decoded picture', async () => {
    const f = fakeEnv();
    const out = await prepareImage(image(), f.env);
    expect(out).toMatchObject({ type: 'image/webp', ext: 'webp', width: 1200, height: 900 });
    expect(f.calls).toEqual([{ type: 'image/webp', quality: 0.85, w: 1200, h: 900 }]);
    expect(f.closed()).toBe(1);
  });
  it('refuses a file that is not an image before decoding anything', async () => {
    const f = fakeEnv();
    expect(await failure(prepareImage(blobOf('application/pdf', 10), f.env))).toBe('not_image');
    expect(await failure(prepareImage(blobOf('', 10), f.env))).toBe('not_image');
    expect(f.calls).toEqual([]);
  });
  it('refuses a source larger than the limit without decoding it', async () => {
    const f = fakeEnv();
    expect(await failure(prepareImage(image(MAX_SOURCE_BYTES + 1), f.env))).toBe('too_large');
    expect(f.calls).toEqual([]);
  });
  it('a picture the browser cannot decode, or one with no size, is "unreadable"', async () => {
    expect(await failure(prepareImage(image(), fakeEnv({ decodeFails: true }).env))).toBe('unreadable');
    const zero = fakeEnv({ bitmap: { width: 0, height: 10 } });
    expect(await failure(prepareImage(image(), zero.env))).toBe('unreadable');
    expect(zero.closed()).toBe(1);
  });
  it('steps down the quality when the result is too large, then keeps the first one that fits', async () => {
    const f = fakeEnv({ encode: (type, q) => blobOf(type, q > 0.8 ? MAX_UPLOAD_BYTES + 1 : q > 0.6 ? MAX_UPLOAD_BYTES : 10) });
    const out = await prepareImage(image(), f.env);
    expect(f.calls.map((c) => c.quality)).toEqual([0.85, 0.7]);
    expect(out.blob.size).toBe(MAX_UPLOAD_BYTES); // exactly the limit still fits
  });
  it('tries a smaller size when no quality fits at the first size', async () => {
    const f = fakeEnv({ encode: (type, _q, w) => blobOf(type, w > 900 ? MAX_UPLOAD_BYTES + 1 : 1000) });
    const out = await prepareImage(image(), f.env);
    expect(f.calls.slice(0, 3).map((c) => c.w)).toEqual([1200, 1200, 1200]);
    expect(out.width).toBe(840); expect(out.height).toBe(630);
  });
  it('falls back to JPEG when the browser cannot write WebP (it answers with another type), and stops asking for WebP at once', async () => {
    const f = fakeEnv({ encode: (type) => blobOf(type === 'image/webp' ? 'image/png' : type, 5000) });
    const out = await prepareImage(image(), f.env);
    expect(out).toMatchObject({ type: 'image/jpeg', ext: 'jpg' });
    expect(f.calls.filter((c) => c.type === 'image/webp')).toHaveLength(1);
  });
  it('a browser that produces nothing in either format ends with "encode", after a bounded number of attempts', async () => {
    const f = fakeEnv({ encode: () => null });
    expect(await failure(prepareImage(image(), f.env))).toBe('encode');
    expect(f.calls.length).toBeLessThanOrEqual(2);
    expect(f.closed()).toBe(1);
  });
  it('when every size and quality is too large it ends with "too_large" after at most 12 encodes', async () => {
    const f = fakeEnv({ encode: (type) => blobOf(type, MAX_UPLOAD_BYTES + 1) });
    expect(await failure(prepareImage(image(), f.env))).toBe('too_large');
    expect(f.calls.length).toBe(2 * SIDE_FACTORS.length * QUALITIES.length);
  });
  it('an encoder that throws is "encode"', async () => {
    expect(await failure(prepareImage(image(), fakeEnv({ encode: () => new Error('boom') }).env))).toBe('encode');
  });
  it('an empty result is not accepted', async () => {
    const f = fakeEnv({ encode: (type) => blobOf(type, 0) });
    expect(await failure(prepareImage(image(), f.env))).toBe('encode');
  });
  it('the sentences are human, fixed and do not name a file', async () => {
    for (const k of ['not_image', 'too_large', 'unreadable', 'encode'] as const) expect(new PrepareError(k).message).toMatch(/^[A-Z].*[.]$/);
  });
});
