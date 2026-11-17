// Browser re-encoding of an item photo before it is uploaded (LLD 9.4, FDD FR-23, WO-0073). The photo is decoded with its orientation applied,
// drawn on a canvas at most 1,200 pixels on the long side and encoded again as WebP (JPEG when the browser cannot encode WebP). Drawing on a
// canvas drops EXIF and every other metadata block, including the GPS position. The result is kept under the bucket's 5 MB limit, with a
// fixed, small number of encode attempts. The browser parts are behind `PrepEnv` so the logic runs in tests without a browser
// (the real ones, `browserEnv`, are in components/wardrobe/photo-backend.ts).

export const ITEM_MAX_SIDE = 1200;
/** The `item-images` bucket accepts 5 MB (LLD 4.6); stay clearly below it. */
export const MAX_UPLOAD_BYTES = 4_500_000;
/** The largest picture we agree to decode at all (a phone photo is 2 to 12 MB). */
export const MAX_SOURCE_BYTES = 30_000_000;
export const QUALITIES = [0.85, 0.7, 0.55] as const;
/** The second size is tried only when no quality of the first fits. */
export const SIDE_FACTORS = [1, 0.7] as const;

export type PrepareFailure = 'not_image' | 'too_large' | 'unreadable' | 'encode';
const MESSAGES: Record<PrepareFailure, string> = {
  not_image: 'That file is not a picture. Choose a photo (JPEG, PNG or WebP).',
  too_large: 'That photo is too large to prepare here. Choose a smaller photo.',
  unreadable: 'This browser could not read that photo. Try a JPEG or PNG photo.',
  encode: 'This browser could not shrink that photo. Try another photo.',
};
export class PrepareError extends Error {
  constructor(readonly failure: PrepareFailure) { super(MESSAGES[failure]); this.name = 'PrepareError'; }
}

export interface Bitmap { width: number; height: number; close?: () => void }
/** The browser's part: decode (orientation applied) and encode on a canvas. `encode` resolves null when the browser produced nothing. */
export interface PrepEnv {
  decode(file: Blob): Promise<Bitmap>;
  encode(bitmap: Bitmap, width: number, height: number, type: string, quality: number): Promise<Blob | null>;
}
export interface Prepared { blob: Blob; type: 'image/webp' | 'image/jpeg'; ext: 'webp' | 'jpg'; width: number; height: number }

/** The size that fits `max` on the long side, never larger than the source, at least 1 pixel each way. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const FORMATS = [{ type: 'image/webp', ext: 'webp' }, { type: 'image/jpeg', ext: 'jpg' }] as const;

export async function prepareImage(file: Blob, env: PrepEnv, maxSide: number = ITEM_MAX_SIDE): Promise<Prepared> {
  if (!/^image\//.test(file.type)) throw new PrepareError('not_image');
  if (file.size > MAX_SOURCE_BYTES) throw new PrepareError('too_large');
  let bitmap: Bitmap;
  try { bitmap = await env.decode(file); } catch { throw new PrepareError('unreadable'); }
  try {
    if (!(bitmap.width > 0 && bitmap.height > 0)) throw new PrepareError('unreadable');
    let tooBig = false;
    for (const format of FORMATS) {
      sizes: for (const factor of SIDE_FACTORS) {
        const size = fitWithin(bitmap.width, bitmap.height, Math.round(maxSide * factor));
        for (const quality of QUALITIES) {
          let blob: Blob | null;
          try { blob = await env.encode(bitmap, size.width, size.height, format.type, quality); } catch { throw new PrepareError('encode'); }
          if (!blob || blob.type !== format.type || blob.size === 0) break sizes; // this browser cannot write the format: try the next one
          if (blob.size <= MAX_UPLOAD_BYTES) return { blob, type: format.type, ext: format.ext, width: size.width, height: size.height };
          tooBig = true;
        }
      }
    }
    throw new PrepareError(tooBig ? 'too_large' : 'encode');
  } finally { bitmap.close?.(); }
}
