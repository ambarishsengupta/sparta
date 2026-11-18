import { fail, ok, UUID, type StorageLike } from './api';
import type { RouteLimit } from './limits';

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
  /** WO-0130: the per-process brake and the shared (database) count. Optional only because other callers of handlePurge (test-support/purge.ts, outside the scope of WO-0130) pass none; the route always passes it (pinned by limits-shared.test.ts). */
  limit?: RouteLimit;
  /** The site's public origin, when configured (for example `https://app.example`): its scheme is then the scheme the browser used. Optional; not yet set by the route. */
  publicOrigin?: string | null;
}

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
  if (origin === null) { const site = req.headers.get('sec-fetch-site'); return site === 'same-origin' || site === 'none'; }
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

/** WO-0160: removes every object of one user in every bucket (`BUCKETS`) through the Storage API, and returns how many were removed per bucket. The ONE
 * routine of the self-service path (`handlePurge`) and of the administrator's end of the pilot (lib/server/admin-pilot.ts): the listing, paging and depth limits
 * live only in `purgeBucket`. THROWS when any bucket could not be listed, emptied or checked; the caller then must not delete the account. The id must be a
 * UUID: an empty or odd id would make the listing cover more than one user's folder, so it is refused before anything is listed. */
export async function purgeUserFolders(storage: StorageLike, uid: string): Promise<Record<string, number>> {
  if (!UUID.test(uid)) throw new Error('not a user id');
  const removed: Record<string, number> = {};
  for (const bucket of BUCKETS) removed[bucket] = await purgeBucket(storage, bucket, uid);
  return removed;
}

/** WO-0130: at most this many purges per person in this many seconds, counted in the database (every instance). A purge that ends `purge_incomplete`
 * is retried by the person, so the limit is not 1; it is low because each call lists and removes every file of the person. */
export const PURGE_LIMIT = { max: 6, windowSeconds: 600 } as const;
/** The per-process brake, over all callers of this process, asked once the person is verified and within their own shared limit (see handlePurge). */
export const PURGE_BRAKE = { max: 30, windowMs: 60_000 } as const;

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
  // Counted per verified person, before the re-authentication check and before any file is listed. If the count can not be read the purge is not run (fail closed).
  // The shared count comes BEFORE the per-process brake: a call the person's own limit refuses must not use up the brake that every other person on this
  // instance shares, so one person takes at most PURGE_LIMIT.max brake slots per window. Calls with no valid session never get here.
  if (deps.limit) { try { if (!(await deps.limit.count(`purge:${uid}`))) return fail('rate_limited'); } catch { return fail('unavailable'); } }
  if (deps.limit && !deps.limit.brake()) return fail('rate_limited');

  // The same proof of a recent primary sign-in as app.delete_my_account() (database function, one source of truth): nothing is removed otherwise.
  try {
    const r = await deps.caller.schema('app').rpc('is_recent_sign_in');
    if (r.error) return fail('unavailable');
    if (r.data !== true) return fail('reauthentication_required');
  } catch { return fail('unavailable'); }

  let removed: Record<string, number>;
  try { removed = await purgeUserFolders(deps.storage, uid); } catch { return fail('purge_incomplete'); }
  return ok({ ok: true, removed });
}

/** WO-0130: `handlePurge` with the limit filled in. The route binds it per request (the shared count needs that request's secret-key client) under the
 * name `handlePurge`, so the route reads as it always did and the limit can not be left out of the call. */
export const limitedPurge = (limit: RouteLimit) => (req: Request, deps: PurgeDeps): Promise<Response> => handlePurge(req, { ...deps, limit });
