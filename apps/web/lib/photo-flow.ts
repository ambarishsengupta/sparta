import { isSubType } from '@sparta/taxonomy';
import type { Category, SubType } from '@sparta/taxonomy';
import { emptyForm, updateForm } from './item-form';
import type { ItemFormValues } from './item-form';
import { PrepareError } from './image-prep';
import type { Prepared } from './image-prep';
import type { PhotoAttachment, PhotoFeatures } from './repository';
import { RepositoryError, messageOf } from './supabase/errors';

// The add-by-photo flow (FR-23, FR-23a, LLD 7.3, 9.4; WO-0073) without any browser or network code: everything it needs from the outside
// arrives through `PhotoDeps`, so tests drive it with fakes. Order: prepare (re-encode) -> upload -> create the job -> poll with a hard
// timeout -> read the result.

/** Poll every 2 s and stop after 120 s: the worker needs about 20 s with a warm model and longer for its first picture. */
export const POLL_MS = 2000;
export const TIMEOUT_MS = 120_000;
/** Three reads in a row that fail end the wait (a dropped connection), so the page never spins on a dead network. */
export const MAX_READ_FAILURES = 3;
export const SUGGESTED_LABEL = 'Suggested from your photo';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export interface JobRow { status: JobStatus; result: unknown }
export type Stage = 'preparing' | 'uploading' | 'queued' | 'processing';

export interface PhotoDeps {
  prepare(file: Blob): Promise<Prepared>;
  /** Stores the re-encoded picture under the owner's folder; resolves the object path. */
  upload(prepared: Prepared): Promise<{ path: string; userId: string }>;
  /** Creates the photo job for that path; resolves its id. */
  createJob(path: string): Promise<number>;
  readJob(id: number): Promise<JobRow | null>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
}

/** What the worker's `result` holds once validated (LLD 7.3). Paths are the owner's own; `garment` only when the model ran and its numbers are sound. */
export interface PhotoResult {
  path: string;
  thumbPath: string;
  originalThumbPath: string;
  originalPath: string;
  dominantHex: string | null;
  garment: { features: PhotoFeatures; category: Category | null; subType: SubType | null } | null;
}

export type PhotoFailure = 'prepare' | 'upload' | 'job' | 'timeout' | 'failed' | 'unreadable' | 'cancelled';
export type PhotoOutcome = { ok: true; result: PhotoResult } | { ok: false; failure: PhotoFailure; message: string };

export const TIMEOUT_MESSAGE = 'Preparing your photo is taking longer than expected, so we stopped waiting. You can try again later, or add the item without a photo.';
export const FAILED_MESSAGE = 'We could not prepare that photo. Try another photo, or add the item without one.';
export const UNREADABLE_MESSAGE = 'The photo was prepared, but its result could not be read. Please try again, or add the item without a photo.';
export const JOB_REFUSED_MESSAGE = 'We could not start preparing the photo. You may have added many photos in the last hour, or your account is not ready for photos yet. Try again later.';
export const UPLOAD_REFUSED_MESSAGE = 'Your photo could not be stored. Your photo storage may be full, or your account is not ready for photos yet.';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** `<owner>/<file name>`, the shape the bucket's policies and the job check use. */
const ownPath = (v: unknown, uid: string): v is string => typeof v === 'string' && v.startsWith(`${uid}/`) && NAME.test(v.slice(uid.length + 1));
const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** The model's answer if it is sound: version 1 with a class 0 to 9, a probability 0 to 1 and exactly 32 finite numbers. Anything else is no answer. */
function parseGarment(raw: unknown): PhotoResult['garment'] {
  if (!isObject(raw) || raw.model_version !== 'garment-cnn-v1') return null;
  const { class: cls, p, embedding, category, sub_type: sub } = raw;
  if (!Array.isArray(embedding) || embedding.length !== 32 || !embedding.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const garmentClass = typeof cls === 'number' && Number.isInteger(cls) && cls >= 0 && cls <= 9 ? cls : null;
  const prob = typeof p === 'number' && p >= 0 && p <= 1 ? p : null;
  // a suggestion is shown only when BOTH are present and form a real pair of the taxonomy
  const pair = typeof category === 'string' && typeof sub === 'string' && isSubType(category, sub);
  return {
    features: { modelVersion: 'garment-cnn-v1', garmentClass, p: prob, embedding: embedding as number[] },
    category: pair ? (category as Category) : null,
    subType: pair ? (sub as SubType) : null,
  };
}

/** The worker's result as the screens use it, or null when it is not what the worker writes (a path of someone else, a missing field). */
export function parsePhotoResult(raw: unknown, userId: string, originalPath: string): PhotoResult | null {
  if (!isObject(raw) || !ownPath(originalPath, userId)) return null;
  const { path, thumb_path: thumb, original_thumb_path: origThumb, dominant_rgb: rgb } = raw;
  if (!ownPath(path, userId) || !ownPath(thumb, userId) || !ownPath(origThumb, userId)) return null;
  const colour = Array.isArray(rgb) && rgb.length === 3 && rgb.every((c) => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 255)
    ? `#${(rgb as number[]).map(hex2).join('').toUpperCase()}` : null;
  return { path, thumbPath: thumb, originalThumbPath: origThumb, originalPath, dominantHex: colour, garment: parseGarment(raw.garment) };
}

/**
 * Runs the whole flow. Never throws: every failure is an outcome with a fixed human sentence (no server text). Polling is bounded by
 * `timeoutMs` (and ends at once on `signal`, which the screen aborts when it unmounts), so nothing keeps running after the person leaves.
 */
export async function addByPhoto(
  file: Blob, deps: PhotoDeps, o: { signal: AbortSignal; onStage?: (s: Stage) => void; pollMs?: number; timeoutMs?: number },
): Promise<PhotoOutcome> {
  const fail = (failure: PhotoFailure, message: string): PhotoOutcome => ({ ok: false, failure, message });
  const cancelled = () => fail('cancelled', '');
  const stage = (s: Stage) => o.onStage?.(s);
  const pollMs = o.pollMs ?? POLL_MS;
  const timeoutMs = o.timeoutMs ?? TIMEOUT_MS;

  stage('preparing');
  let prepared: Prepared;
  try { prepared = await deps.prepare(file); } catch (e) { return fail('prepare', e instanceof PrepareError ? e.message : messageOf(e)); }
  if (o.signal.aborted) return cancelled();

  stage('uploading');
  let stored: { path: string; userId: string };
  try { stored = await deps.upload(prepared); } catch (e) { return fail('upload', e instanceof RepositoryError && e.kind === 'refused' ? UPLOAD_REFUSED_MESSAGE : messageOf(e)); }
  if (o.signal.aborted) return cancelled();

  let id: number;
  try { id = await deps.createJob(stored.path); } catch (e) { return fail('job', e instanceof RepositoryError && e.kind === 'refused' ? JOB_REFUSED_MESSAGE : messageOf(e)); }

  stage('queued');
  const started = deps.now();
  let failures = 0;
  for (;;) {
    if (o.signal.aborted) return cancelled();
    let job: JobRow | null = null;
    try { job = await deps.readJob(id); failures = 0; } catch (e) {
      if (++failures >= MAX_READ_FAILURES) return fail('job', messageOf(e, false));
    }
    if (o.signal.aborted) return cancelled();
    if (job?.status === 'done') {
      const result = parsePhotoResult(job.result, stored.userId, stored.path);
      return result ? { ok: true, result } : fail('unreadable', UNREADABLE_MESSAGE);
    }
    if (job?.status === 'failed') return fail('failed', FAILED_MESSAGE);
    if (job) stage(job.status === 'running' ? 'processing' : 'queued');
    const left = timeoutMs - (deps.now() - started);
    if (left <= 0) return fail('timeout', TIMEOUT_MESSAGE);
    await deps.sleep(Math.min(pollMs, left), o.signal);
  }
}

export type ImageChoice = 'cutout' | 'original';

/** The picture and features to store with the item. The unchosen files stay in storage (users have no delete right, LLD 4.6); see the evidence notes. */
export function attachmentOf(result: PhotoResult, choice: ImageChoice): PhotoAttachment {
  return {
    imagePath: choice === 'cutout' ? result.path : result.originalPath,
    imageThumbPath: choice === 'cutout' ? result.thumbPath : result.originalThumbPath,
    features: result.garment?.features ?? null,
  };
}

export interface Prefill { values: ItemFormValues; garmentSuggested: boolean; colourSuggested: boolean }
/** The add-item form as the photo fills it: the suggested category and sub-type only when the result carries a real pair, and the dominant colour when present. */
export function prefillFrom(result: PhotoResult): Prefill {
  let values = emptyForm();
  const g = result.garment;
  const garmentSuggested = !!(g && g.category && g.subType);
  if (garmentSuggested) values = updateForm(values, { category: g!.category!, subType: g!.subType! });
  const colourSuggested = result.dominantHex !== null;
  if (colourSuggested) values = updateForm(values, { hex: result.dominantHex!.toLowerCase() });
  return { values, garmentSuggested, colourSuggested };
}

/** A sleep that ends early, and clears its timer, when the signal aborts (the screen leaves). */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}
