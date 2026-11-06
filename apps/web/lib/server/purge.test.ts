import { describe, expect, it } from 'vitest';
import type { BucketApi, StorageLike } from './api';
import { BUCKETS, handlePurge, listAll, originAllowed, purgeBucket, type Caller } from './purge';

const ME = '11111111-1111-4111-8111-111111111111';
const NEIGHBOUR = '11111111-1111-4111-8111-111111111112';   // shares a long prefix with ME

/** An in-memory Storage: objects are `bucket/path`; list returns one folder level (folders have id null), like the real API. */
function fakeStorage(objects: string[], opts: { removeDoesNothing?: boolean; listError?: boolean; removeError?: boolean; pageLimit?: number } = {}) {
  const store = new Set(objects);
  const log: string[] = [];
  const api = (bucket: string): BucketApi => ({
    createSignedUrl: async () => ({ data: null, error: new Error('unused') }), createSignedUploadUrl: async () => ({ data: null, error: new Error('unused') }),
    async list(prefix, o) {
      log.push(`list ${bucket}/${prefix}@${o?.offset ?? 0}`);
      if (opts.listError) return { data: null, error: new Error('down') };
      const base = `${bucket}/${prefix}/`;
      const level = new Map<string, string | null>();
      for (const k of [...store].sort()) if (k.startsWith(base)) { const rest = k.slice(base.length); const i = rest.indexOf('/'); if (i < 0) level.set(rest, 'id'); else level.set(rest.slice(0, i), null); }
      const all = [...level].map(([name, id]) => ({ name, id }));
      const lim = o?.limit ?? 100;
      return { data: all.slice(o?.offset ?? 0, (o?.offset ?? 0) + lim), error: null };
    },
    async remove(paths) {
      log.push(`remove ${bucket} x${paths.length}`);
      for (const p of paths) log.push(`  ${bucket}/${p}`);
      if (opts.removeError) return { data: null, error: new Error('down') };
      if (!opts.removeDoesNothing) for (const p of paths) store.delete(`${bucket}/${p}`);
      return { data: paths.map((name) => ({ name })), error: null };
    },
  });
  return { storage: { from: api } as StorageLike, store, log };
}
const caller = (over: { user?: { id: string } | null; getUserError?: unknown; recent?: unknown; rpcError?: unknown; throws?: boolean } = {}): Caller & { rpcCalls: string[] } => {
  const rpcCalls: string[] = [];
  return {
    rpcCalls,
    auth: { getUser: async () => { if (over.throws) throw new TypeError('fetch failed'); return { data: { user: 'user' in over ? over.user! : { id: ME } }, error: over.getUserError ?? null }; } },
    schema: () => ({ rpc: async (fn) => { rpcCalls.push(fn); return { data: 'recent' in over ? over.recent : true, error: over.rpcError ?? null }; } }),
  };
};
// WO-0074: a request with no Origin header is allowed only with same-origin fetch metadata, so the default test request carries it (as a browser's own fetch does).
const post = (headers: Record<string, string> = {}, method = 'POST') => new Request('https://app.test/api/account/purge-storage', { method, headers: { 'sec-fetch-site': 'same-origin', ...headers } });
const code = async (r: Response) => ((await r.clone().json()) as { error?: { code: string } }).error?.code;
const mine = (n: number) => Array.from({ length: n }, (_, i) => `item-images/${ME}/f${String(i).padStart(4, '0')}.webp`);
const others = ['item-images/' + NEIGHBOUR + '/n.webp', 'receipts/' + NEIGHBOUR + '/n.pdf', 'exports/' + NEIGHBOUR + '/e1/part-1.zip', `item-images/${ME}x/y.webp`, 'item-images/orphan.webp'];

describe('the purge route', () => {
  it('removes every object of the caller in every bucket, at any depth, and nothing of anyone else', async () => {
    const f = fakeStorage([...mine(3), `receipts/${ME}/r.pdf`, `exports/${ME}/e1/part-1.zip`, `exports/${ME}/e1/part-2.zip`, `exports/${ME}/e2/part-1.zip`, ...others]);
    const r = await handlePurge(post(), { caller: caller(), storage: f.storage });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, removed: { 'item-images': 3, receipts: 1, exports: 3 } });
    expect([...f.store].sort()).toEqual([...others].sort());
  });
  it('pages: 250 objects (more than one listing page and one removal batch) all go', async () => {
    const f = fakeStorage([...mine(250), ...others]);
    const r = await handlePurge(post(), { caller: caller(), storage: f.storage });
    expect((await r.json() as { removed: Record<string, number> }).removed['item-images']).toBe(250);
    expect([...f.store].sort()).toEqual([...others].sort());
    expect(f.log.filter((l) => l.startsWith('remove item-images')).every((l) => /x(100|50)$/.test(l))).toBe(true);
    expect(f.log).toContain(`list item-images/${ME}@100`);   // the second page of the first listing is read (not only left to the next round)
    expect(f.log.filter((l) => l.startsWith('remove item-images')).length).toBe(3);
  });
  it('lists and removes only paths under the session user id; the id never comes from the request', async () => {
    const f = fakeStorage([...mine(2), ...others]);
    await handlePurge(new Request(`https://app.test/api/account/purge-storage?user=${NEIGHBOUR}&uid=${NEIGHBOUR}`, { method: 'POST', headers: { 'x-user-id': NEIGHBOUR }, body: JSON.stringify({ user_id: NEIGHBOUR, path: NEIGHBOUR }) }), { caller: caller(), storage: f.storage });
    for (const l of f.log.filter((x) => x.startsWith('list '))) expect(l).toMatch(new RegExp(`^list [a-z-]+/${ME}(/|@)`));
    for (const l of f.log.filter((x) => x.startsWith('  '))) expect(l.trim()).toMatch(new RegExp(`^[a-z-]+/${ME}/`));
    expect(f.store.has(`item-images/${NEIGHBOUR}/n.webp`)).toBe(true);
  });
  it('the response carries counts only: no object name, id or path', async () => {
    const f = fakeStorage(mine(2)); const text = await (await handlePurge(post(), { caller: caller(), storage: f.storage })).text();
    expect(text).not.toMatch(/f0000|webp|11111111/);
  });
  it('an empty account is fine: zero everywhere', async () => {
    const r = await handlePurge(post(), { caller: caller(), storage: fakeStorage([]).storage });
    expect(await r.json()).toEqual({ ok: true, removed: { 'item-images': 0, receipts: 0, exports: 0 } });
  });
  it('is idempotent: a second run finds nothing', async () => {
    const f = fakeStorage(mine(2)); await handlePurge(post(), { caller: caller(), storage: f.storage });
    expect(((await (await handlePurge(post(), { caller: caller(), storage: f.storage })).json()) as { removed: Record<string, number> }).removed['item-images']).toBe(0);
  });
});

describe('who may purge', () => {
  it('no session is 401 and storage is not touched', async () => {
    const f = fakeStorage(mine(2)); const c = caller({ user: null });
    const r = await handlePurge(post(), { caller: c, storage: f.storage });
    expect([r.status, await code(r)]).toEqual([401, 'not_signed_in']); expect(f.log).toEqual([]); expect(c.rpcCalls).toEqual([]);
  });
  it('a session check that errors is 401; one that throws is 503; neither touches storage', async () => {
    const f = fakeStorage(mine(2));
    expect((await handlePurge(post(), { caller: caller({ getUserError: { message: 'jwt expired' } }), storage: f.storage })).status).toBe(401);
    expect((await handlePurge(post(), { caller: caller({ throws: true }), storage: f.storage })).status).toBe(503);
    expect(f.log).toEqual([]);
  });
  it.each([false, null, undefined, 'true', 1, 0, {}])('a sign-in that is not recent (%j) is 403 reauthentication_required and nothing is removed', async (recent) => {
    const f = fakeStorage(mine(2)); const r = await handlePurge(post(), { caller: caller({ recent }), storage: f.storage });
    expect([r.status, await code(r)]).toEqual([403, 'reauthentication_required']); expect(f.log).toEqual([]);
  });
  it('the proof is asked of the database function app.is_recent_sign_in, with the caller\'s own session', async () => {
    const c = caller(); await handlePurge(post(), { caller: c, storage: fakeStorage([]).storage }); expect(c.rpcCalls).toEqual(['is_recent_sign_in']);
  });
  it('a database error while checking the sign-in is 503 and nothing is removed', async () => {
    const f = fakeStorage(mine(2)); const r = await handlePurge(post(), { caller: caller({ rpcError: { message: 'x' } }), storage: f.storage });
    expect(r.status).toBe(503); expect(f.log).toEqual([]);
  });
  it('a request from another origin is 403 before anything else; the same origin is fine', async () => {
    const f = fakeStorage(mine(1)); const c = caller();
    expect((await handlePurge(post({ origin: 'https://evil.example' }), { caller: c, storage: f.storage })).status).toBe(403);
    expect((await handlePurge(post({ origin: 'null' }), { caller: c, storage: f.storage })).status).toBe(403);
    expect(f.log).toEqual([]); expect(c.rpcCalls).toEqual([]);
    expect((await handlePurge(post({ origin: 'https://app.test' }), { caller: c, storage: f.storage })).status).toBe(200);
  });
  it('the origin is compared with the Host header the browser sent, not with the server\'s own bind name in the URL (found in the browser run)', async () => {
    const f = fakeStorage(mine(1)); const c = caller();
    const viaLocalhost = (origin: string, host: string) => new Request('http://localhost:3000/api/account/purge-storage', { method: 'POST', headers: { origin, host } });
    expect((await handlePurge(viaLocalhost('http://127.0.0.1:3000', '127.0.0.1:3000'), { caller: c, storage: f.storage })).status).toBe(200);
    expect((await handlePurge(viaLocalhost('http://evil.example', '127.0.0.1:3000'), { caller: c, storage: f.storage })).status).toBe(403);
  });
  it.each(['GET', 'PUT', 'DELETE'])('%s is 405', async (m) => { const f = fakeStorage(mine(1)); expect((await handlePurge(post({}, m), { caller: caller(), storage: f.storage })).status).toBe(405); expect(f.log).toEqual([]); });
  it('a session user id that is not a UUID is refused rather than used as a folder name', async () => {
    const f = fakeStorage(mine(1));
    for (const id of ['', '../x', '*', `${ME}/..`]) expect((await handlePurge(post(), { caller: caller({ user: { id } }), storage: f.storage })).status).toBe(500);
    expect(f.log).toEqual([]);
  });
});

describe('failures are reported and never claimed as success', () => {
  it('a listing error is 500 purge_incomplete with a fixed text', async () => {
    const r = await handlePurge(post(), { caller: caller(), storage: fakeStorage(mine(1), { listError: true }).storage });
    expect([r.status, await code(r)]).toEqual([500, 'purge_incomplete']); expect(await r.text()).not.toMatch(/down|11111111/);
  });
  it('a removal error is 500', async () => { expect((await handlePurge(post(), { caller: caller(), storage: fakeStorage(mine(1), { removeError: true }).storage })).status).toBe(500); });
  it('a removal that reports success but leaves the object is caught by the check that the folder is empty', async () => {
    const f = fakeStorage(mine(2), { removeDoesNothing: true });
    expect((await handlePurge(post(), { caller: caller(), storage: f.storage })).status).toBe(500);
    await expect(purgeBucket(f.storage, 'item-images', ME)).rejects.toThrow('still not empty');
  });
  it('a failure in one bucket stops the run with an error (the earlier buckets stay purged)', async () => {
    const f = fakeStorage([...mine(1), `receipts/${ME}/r.pdf`]);
    const broken: StorageLike = { from: (b) => (b === 'receipts' ? { ...f.storage.from(b), list: async () => ({ data: null, error: new Error('x') }) } : f.storage.from(b)) };
    expect((await handlePurge(post(), { caller: caller(), storage: broken })).status).toBe(500);
  });
  it('folders nested deeper than the limit are an error, not silently skipped', async () => {
    const f = fakeStorage([`exports/${ME}/a/b/c/d/e/f.zip`]);
    await expect(listAll(f.storage, 'exports', ME)).rejects.toThrow('too deep');
  });
  it('the buckets are exactly the three of LLD 4.6', () => { expect([...BUCKETS]).toEqual(['item-images', 'receipts', 'exports']); });
});

// WO-0074 item 5: the whole origin (scheme, host and port) is compared, not the host alone.
describe('the Origin check compares scheme, host and port', () => {
  const req = (headers: Record<string, string>, url = 'https://app.test/api/account/purge-storage') => new Request(url, { method: 'POST', headers });
  it('a matching origin passes: the URL scheme with the Host header, default ports omitted on either side', () => {
    expect(originAllowed(req({ origin: 'https://app.test', host: 'app.test' }))).toBe(true);
    expect(originAllowed(req({ origin: 'https://app.test', host: 'app.test:443' }))).toBe(true);
    expect(originAllowed(req({ origin: 'http://app.test:8080', host: 'app.test:8080' }, 'http://app.test:8080/x'))).toBe(true);
    expect(originAllowed(req({ origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' }, 'http://localhost:3000/x'))).toBe(true);
    expect(originAllowed(req({ origin: 'http://[::1]:3000', host: '[::1]:3000' }, 'http://localhost:3000/x'))).toBe(true);
  });
  it('http against https is refused, whichever side says which', () => {
    expect(originAllowed(req({ origin: 'http://app.test', host: 'app.test' }))).toBe(false);                                       // URL says https
    expect(originAllowed(req({ origin: 'https://app.test', host: 'app.test' }, 'http://app.test/x'))).toBe(false);                 // URL says http
    expect(originAllowed(req({ origin: 'http://app.test', host: 'app.test', 'x-forwarded-proto': 'https' }, 'http://app.test/x'))).toBe(false);
    expect(originAllowed(req({ origin: 'https://app.test', host: 'app.test', 'x-forwarded-proto': 'http' }))).toBe(false);
  });
  it('a different port is refused, including a default port against a non-default one', () => {
    expect(originAllowed(req({ origin: 'https://app.test:8443', host: 'app.test' }))).toBe(false);
    expect(originAllowed(req({ origin: 'https://app.test', host: 'app.test:8443' }))).toBe(false);
    expect(originAllowed(req({ origin: 'http://127.0.0.1:3001', host: '127.0.0.1:3000' }, 'http://localhost:3000/x'))).toBe(false);
    expect(originAllowed(req({ origin: 'https://app.test:80', host: 'app.test:443' }))).toBe(false);
  });
  it('a different host is refused, also one that only shares a prefix or suffix with the real one', () => {
    for (const o of ['https://evil.example', 'https://app.test.evil.example', 'https://xapp.test', 'https://app.tes', 'https://sub.app.test']) expect(originAllowed(req({ origin: o, host: 'app.test' }))).toBe(false);
  });
  it('the forwarded protocol decides the scheme behind a proxy that terminates TLS: the first value counts, an unknown value is ignored', () => {
    const behind = (origin: string, forwarded: string) => req({ origin, host: 'app.test', 'x-forwarded-proto': forwarded }, 'http://app.test/x');
    expect(originAllowed(behind('https://app.test', 'https'))).toBe(true);
    expect(originAllowed(behind('https://app.test', 'https, http'))).toBe(true);
    expect(originAllowed(behind('http://app.test', 'https, http'))).toBe(false);
    expect(originAllowed(behind('http://app.test', 'gopher'))).toBe(true);      // not http or https: the URL's own scheme (http) is used
    expect(originAllowed(behind('https://app.test', 'gopher'))).toBe(false);
  });
  it('a configured public origin sets the scheme (and wins over the forwarded protocol); an unusable one is ignored', () => {
    const r = (origin: string, extra: Record<string, string> = {}) => req({ origin, host: 'app.test', ...extra }, 'http://app.test/x');
    expect(originAllowed(r('https://app.test'), 'https://app.test')).toBe(true);
    expect(originAllowed(r('http://app.test'), 'https://app.test')).toBe(false);
    expect(originAllowed(r('http://app.test', { 'x-forwarded-proto': 'http' }), 'https://app.test')).toBe(false);
    expect(originAllowed(r('https://app.test', { 'x-forwarded-proto': 'http' }), 'https://app.test')).toBe(true);
    expect(originAllowed(r('http://app.test'), 'not a url')).toBe(true);
    expect(originAllowed(r('http://app.test'), 'ftp://app.test')).toBe(true);
  });
  it('the Host header, not the URL, supplies host and port; with no Host header the URL does', () => {
    expect(originAllowed(req({ origin: 'https://other.test' }, 'https://other.test/x'))).toBe(true);      // no Host header: the URL's host
    expect(originAllowed(req({ origin: 'https://other.test' }, 'https://app.test/x'))).toBe(false);
    expect(originAllowed(req({ origin: 'https://app.test', host: 'other.test' }, 'https://app.test/x'))).toBe(false);   // the Host header wins over the URL
  });
  it('a null, empty, malformed or non-web Origin is refused', () => {
    for (const o of ['null', '', ' ', 'https://', 'app.test', '//app.test', 'file:///x', 'ftp://app.test', 'javascript:alert(1)', 'https://app.test/', 'https://app.test/path', 'https://user@app.test', 'https://app.test?x=1', 'HTTPS://APP.TEST'])
      expect(originAllowed(req({ origin: o, host: 'app.test' }))).toBe(false);
  });
  it('a Host header that is not a plain host and port is refused', () => {
    for (const h of ['', 'app.test/x', 'user@app.test', 'app.test:99999999', 'app test', 'app.test, evil.example', '-app.test'])
      expect(originAllowed(req({ origin: 'https://app.test', host: h }))).toBe(false);
  });
  it('a missing Origin is allowed only with Sec-Fetch-Site same-origin or none', () => {
    expect(originAllowed(req({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(originAllowed(req({ 'sec-fetch-site': 'none' }))).toBe(true);
    for (const v of ['cross-site', 'same-site', '', 'SAME-ORIGIN', 'same-origin, cross-site', 'null']) expect(originAllowed(req({ 'sec-fetch-site': v }))).toBe(false);
    expect(originAllowed(req({}))).toBe(false);
  });
  it('the handler answers 403 and touches neither the session nor storage for each refused case', async () => {
    const cases: Record<string, string>[] = [{ origin: 'http://app.test', host: 'app.test' }, { origin: 'https://app.test:8443', host: 'app.test' }, { origin: 'null' }, {}, { 'sec-fetch-site': 'cross-site' }];
    for (const headers of cases) {
      const f = fakeStorage(mine(1)); const c = caller();
      const r = await handlePurge(new Request('https://app.test/api/account/purge-storage', { method: 'POST', headers }), { caller: c, storage: f.storage });
      expect([r.status, await code(r)]).toEqual([403, 'forbidden']); expect(f.log).toEqual([]); expect(c.rpcCalls).toEqual([]);
    }
  });
  it('the handler passes the configured public origin on', async () => {
    const f = fakeStorage(mine(1));
    const mk = () => new Request('http://app.test/api/account/purge-storage', { method: 'POST', headers: { origin: 'https://app.test', host: 'app.test' } });
    expect((await handlePurge(mk(), { caller: caller(), storage: f.storage })).status).toBe(403);
    expect((await handlePurge(mk(), { caller: caller(), storage: f.storage, publicOrigin: 'https://app.test' })).status).toBe(200);
  });
});
