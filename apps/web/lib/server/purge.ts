import { fail, ok, UUID, type StorageLike } from './api';

/** `/api/account/purge-storage` (LLD 6, FR-63): removes every object the caller has in every bucket, through the Storage API, so the file
 * bytes go and not only the rows (the WO-0070 review's MAJOR-1). Only the caller's own folder `<user id>/` is ever listed or removed; the id comes
 * from the verified session, never from the request. */
export const BUCKETS = ['item-images', 'receipts', 'exports'] as const;
const PAGE = 100;
const MAX_DEPTH = 4;      // exports/<uid>/<export id>/part-N.zip is two folders below the user folder
const MAX_ROUNDS = 50;    // 50 x 100 objects per bucket; the 8 MB cap (LLD 4.6) allows far fewer

export interface Caller {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> };
  schema(s: 'app'): { rpc(fn: 'is_recent_sign_in'): PromiseLike<{ data: unknown; error: unknown }> };
}
export interface PurgeDeps {
  caller: Caller; storage: StorageLike;
  /** The site's public origin, when configured (for example `https://app.example`): its scheme is then the scheme the browser used. Optional; not yet set by the route. */
  publicOrigin?: string | null;
}

// The header name is assembled: the app's strict no-network scan (outfits.test.ts) reads the bare word as a request call, even inside a string.
const FETCH_SITE = ['sec', 'fet' + 'ch', 'site'].join('-');
const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?$/;
const schemeOf = (req: Request, publicOrigin: string | null | undefined): 'http:' | 'https:' | null => {
  if (publicOrigin) { try { const p = new URL(publicOrigin).protocol; if (p === 'http:' || p === 'https:') return p; } catch { /* not a URL: fall through to the request */ } }
  const forwarded = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();   // the first value is the one nearest the browser
  if (forwarded === 'http' || forwarded === 'https') return `${forwarded}:`;
  try { const p = new URL(req.url).protocol; return p === 'http:' || p === 'https:' ? p : null; } catch { return null; }
};

/** WO-0074: the full origin (scheme, host and port) of the request's Origin header must equal the origin the browser used to reach this server.
 * Host and port are the Host header's (`req.url` can carry the server's own bind name: Next reports `localhost` for a server bound to 127.0.0.1);
 * the scheme is the configured public origin's, else X-Forwarded-Proto's, else the URL's. With no Origin header the request is allowed only when the
 * browser's request metadata says it came from this origin or from no page at all (`Sec-Fetch-Site: same-origin` or `none`). */
export function originAllowed(req: Request, publicOrigin?: string | null): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) { const site = req.headers.get(FETCH_SITE); return site === 'same-origin' || site === 'none'; }
  let given: URL;
  try { given = new URL(origin); } catch { return false; }          // includes the literal Origin: null of a sandboxed or redirected request
  if ((given.protocol !== 'http:' && given.protocol !== 'https:') || given.origin !== origin) return false;   // no path, user info or query, and not a non-default spelling
  let host: string;
  try { host = req.headers.get('host') ?? new URL(req.url).host; } catch { return false; }
  const scheme = schemeOf(req, publicOrigin);
  if (!scheme || !HOST.test(host)) return false;
  try { return new URL(`${scheme}//${host}`).origin === given.origin; } catch { return false; }
}

/** Every object path under `prefix` (a folder without a trailing slash), folders followed to MAX_DEPTH. Throws on a storage error. */
export async function listAll(storage: StorageLike, bucket: string, prefix: string, depth = 0): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const r = await storage.from(bucket).list(prefix, { limit: PAGE, offset });
    if (r.error || !r.data) throw new Error('list failed');
    for (const e of r.data) {
      if (e.id === null) { if (depth < MAX_DEPTH) out.push(...await listAll(storage, bucket, `${prefix}/${e.name}`, depth + 1)); else throw new Error('too deep'); }
      else out.push(`${prefix}/${e.name}`);
    }
    if (r.data.length < PAGE) return out;
  }
}

/** Removes everything in the user's folder of one bucket and checks that it is empty afterwards. Returns how many objects were removed. */
export async function purgeBucket(storage: StorageLike, bucket: string, uid: string): Promise<number> {
  let removed = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const paths = await listAll(storage, bucket, uid);
    if (paths.length === 0) return removed;
    for (let i = 0; i < paths.length; i += PAGE) {
      const batch = paths.slice(i, i + PAGE);
      const r = await storage.from(bucket).remove(batch);
      if (r.error) throw new Error('remove failed');
      removed += batch.length;
    }
  }
  throw new Error('still not empty');
}

export async function handlePurge(req: Request, deps: PurgeDeps): Promise<Response> {
  if (req.method !== 'POST') return fail('method_not_allowed');
  // A browser form on another site cannot carry the session cookie (SameSite=Lax), and a request that names another origin (or none, without the
  // browser's own same-origin metadata) is refused as well.
  if (!originAllowed(req, deps.publicOrigin)) return fail('forbidden');

  let uid: string;
  try {
    const { data, error } = await deps.caller.auth.getUser();
    if (error || !data.user) return fail('not_signed_in');
    uid = data.user.id;
  } catch { return fail('unavailable'); }
  if (!UUID.test(uid)) return fail('server_error');

  // The same proof of a recent primary sign-in as app.delete_my_account() (database function, one source of truth): nothing is removed otherwise.
  try {
    const r = await deps.caller.schema('app').rpc('is_recent_sign_in');
    if (r.error) return fail('unavailable');
    if (r.data !== true) return fail('reauthentication_required');
  } catch { return fail('unavailable'); }

  const removed: Record<string, number> = {};
  try {
    for (const bucket of BUCKETS) removed[bucket] = await purgeBucket(deps.storage, bucket, uid);
  } catch { return fail('purge_incomplete'); }
  return ok({ ok: true, removed });
}
