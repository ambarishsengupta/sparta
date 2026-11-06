import { fail, ok, UUID, type StorageLike } from './api';
import { bearerToken, tokenMatches } from './limits';

/** LLD 6, 7.1: what the worker may fetch and write for ONE running job, as signed URLs. Every path comes from the job row (inputs) or is
 * derived here from the owner id and job id (outputs); nothing in the request body names a path. */
export const DOWNLOAD_SECONDS = 60;
const BUCKET: Record<string, string> = { photo: 'item-images', receipt: 'receipts' };
/** Output file names per job type, in the owner's folder (LLD 7.3). Receipts write no files (their result holds draft lines). */
const OUTPUTS: Record<string, [kind: string, suffix: string][]> = {
  photo: [['cutout', 'cutout.webp'], ['thumb', 'thumb.webp'], ['original_thumb', 'orig-thumb.webp']],
  receipt: [],
};

export interface JobRow { id: number; user_id: string; type: string; status: string; input: unknown }
export interface SignedUrlDeps {
  bearer: string | undefined;
  allow: () => boolean;
  lookupJob: (id: number) => Promise<JobRow | null>;
  storage: StorageLike;
}

/** The job id from the body: a positive safe integer, as a number or as a string of digits. Anything else is null. */
export function parseJobId(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'job_id') return null;
  const v = (body as { job_id: unknown }).job_id;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^[0-9]{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The input paths of a job, each `<owner id>/<plain file name>` exactly as the database check (app.job_input_ok) requires; null if any is not. */
export function inputPaths(userId: string, input: unknown): string[] | null {
  if (!UUID.test(userId) || typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const raw: unknown[] = [];
  if ('path' in o) raw.push(o.path);
  if ('paths' in o) { if (!Array.isArray(o.paths) || o.paths.length < 1 || o.paths.length > 4) return null; raw.push(...o.paths); }
  if (raw.length === 0) return null;
  const re = new RegExp(`^${userId}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`);
  if (!raw.every((p) => typeof p === 'string' && re.test(p))) return null;
  return [...new Set(raw as string[])];
}

/** The output paths the server derives for a job: `<owner id>/<job id>-<name>`. */
export const outputPaths = (type: string, userId: string, jobId: number): { kind: string; path: string }[] =>
  (OUTPUTS[type] ?? []).map(([kind, suffix]) => ({ kind, path: `${userId}/${jobId}-${suffix}` }));

export async function handleSignedUrls(req: Request, deps: SignedUrlDeps): Promise<Response> {
  if (req.method !== 'POST') return fail('method_not_allowed');
  if (!deps.allow()) return fail('rate_limited');
  if (!deps.bearer || deps.bearer.length < 32) return fail('unavailable');
  if (!tokenMatches(bearerToken(req.headers.get('authorization')), deps.bearer)) return fail('unauthorised');

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 256) return fail('bad_request');
    body = JSON.parse(text);
  } catch { return fail('bad_request'); }
  const jobId = parseJobId(body);
  if (jobId === null) return fail('bad_request');

  let job: JobRow | null;
  try { job = await deps.lookupJob(jobId); } catch { return fail('server_error'); }
  if (!job || job.id !== jobId) return fail('job_not_found');
  if (job.status !== 'running') return fail('job_not_running');
  const bucketName = BUCKET[job.type];
  const paths = inputPaths(job.user_id, job.input);
  if (!bucketName || !paths) return fail('invalid_job_input');

  try {
    const bucket = deps.storage.from(bucketName);
    const downloads: { path: string; url: string }[] = [];
    for (const path of paths) {
      const r = await bucket.createSignedUrl(path, DOWNLOAD_SECONDS);
      if (r.error || !r.data?.signedUrl) return fail('storage_unavailable');
      downloads.push({ path, url: r.data.signedUrl });
    }
    const uploads: { kind: string; path: string; url: string }[] = [];
    for (const { kind, path } of outputPaths(job.type, job.user_id, job.id)) {
      // upsert: a retried job writes the same names again
      const r = await bucket.createSignedUploadUrl(path, { upsert: true });
      if (r.error || !r.data?.signedUrl) return fail('storage_unavailable');
      uploads.push({ kind, path, url: r.data.signedUrl });
    }
    return ok({ job_id: job.id, bucket: bucketName, download_expires_in: DOWNLOAD_SECONDS, downloads, uploads });
  } catch { return fail('storage_unavailable'); }
}
