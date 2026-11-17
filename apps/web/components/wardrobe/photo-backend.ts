import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/supabase/database.types';
import { prepareImage } from '../../lib/image-prep';
import type { Prepared, PrepEnv } from '../../lib/image-prep';
import type { JobRow, JobStatus, PhotoDeps } from '../../lib/photo-flow';
import { RepositoryError, asRepositoryError, classify } from '../../lib/supabase/errors';

// The Supabase side of add-by-photo (WO-0073): the signed-in person's own session and the publishable key only, through the same client
// the rest of the app uses. Storage: the private `item-images` bucket, directly under `<user id>/` (the policy of LLD 4.6). Jobs: `app.jobs`,
// insert (user_id, type, input) and select, nothing else (LLD 7.2). No server text is shown: every failure is a RepositoryError sentence.
export const BUCKET = 'item-images';
const STATES: readonly JobStatus[] = ['queued', 'running', 'done', 'failed'];
type Failure = { status?: number; statusCode?: string | number; code?: string | null; message?: string | null; name?: string | null };

/** A storage or PostgREST error as a RepositoryError (the storage API names its HTTP status `statusCode`). */
function fail(e: Failure | null, write: boolean): RepositoryError {
  const status = Number(e?.status ?? e?.statusCode ?? 0);
  return classify({ status: Number.isFinite(status) ? status : 0, error: { code: e?.code ?? null, message: e?.message ?? null, name: e?.name ?? null } }, write);
}

const randomName = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

/** The real browser parts. `createImageBitmap` with `imageOrientation: 'from-image'` applies the EXIF rotation; the canvas then drops all metadata. */
export function browserEnv(): PrepEnv {
  return {
    decode: (file) => createImageBitmap(file, { imageOrientation: 'from-image' }),
    encode: (bitmap, width, height, type, quality) => new Promise<Blob | null>((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(bitmap as ImageBitmap, 0, 0, width, height);
      canvas.toBlob(resolve, type, quality);
    }),
  };
}

export function photoDeps(client: Pick<SupabaseClient<Database>, 'auth' | 'schema' | 'storage'>, sleep: PhotoDeps['sleep'], now: () => number = Date.now): PhotoDeps {
  const userId = async (): Promise<string> => {
    const { data, error } = await client.auth.getSession();
    if (error) throw fail(error, true);
    if (!data.session) throw new RepositoryError('session', true);
    return data.session.user.id;
  };
  return {
    prepare: (file) => prepareImage(file, browserEnv()),
    upload: async (p: Prepared) => {
      try {
        const uid = await userId();
        const path = `${uid}/${randomName()}-original.${p.ext}`;
        const { error } = await client.storage.from(BUCKET).upload(path, p.blob, { contentType: p.type, upsert: false });
        if (error) throw fail(error as Failure, true);
        return { path, userId: uid };
      } catch (e) { throw asRepositoryError(e, true); }
    },
    createJob: async (path) => {
      try {
        const uid = await userId();
        const { data, error, status } = await client.schema('app').from('jobs').insert({ user_id: uid, type: 'photo', input: { path } }).select('id').single();
        if (error) throw fail({ ...error, status }, true);
        const id = (data as { id?: unknown } | null)?.id;
        if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new RepositoryError('unexpected', true);
        return id;
      } catch (e) { throw asRepositoryError(e, true); }
    },
    readJob: async (id): Promise<JobRow | null> => {
      try {
        const { data, error, status } = await client.schema('app').from('jobs').select('status,result').eq('id', id).maybeSingle();
        if (error) throw fail({ ...error, status }, false);
        if (!data) return null;
        const row = data as { status?: unknown; result?: unknown };
        return STATES.includes(row.status as JobStatus) ? { status: row.status as JobStatus, result: row.result ?? null } : null;
      } catch (e) { throw asRepositoryError(e, false); }
    },
    sleep,
    now,
  };
}

/** Short-lived links (10 minutes) to look at the stored pictures; the bucket is private. A path that cannot be signed is simply left out. */
export async function previewUrls(client: Pick<SupabaseClient<Database>, 'storage'>, paths: readonly string[]): Promise<Record<string, string>> {
  try {
    const { data, error } = await client.storage.from(BUCKET).createSignedUrls([...paths], 600);
    if (error || !data) return {};
    return Object.fromEntries(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])));
  } catch { return {}; }
}
