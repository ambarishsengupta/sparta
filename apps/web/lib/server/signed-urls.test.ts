import { describe, expect, it } from 'vitest';
import type { BucketApi, StorageLike } from './api';
import { handleSignedUrls, inputPaths, outputPaths, parseJobId, type JobRow, type SignedUrlDeps } from './signed-urls';

const BEARER = 'k'.repeat(40);
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const file = (u = OWNER, n = 'photo.webp') => `${u}/${n}`;

function world(job: Partial<JobRow> | null, over: Partial<SignedUrlDeps> = {}) {
  const calls: { op: string; bucket: string; path: string; arg?: unknown }[] = [];
  const bucket = (b: string): BucketApi => ({
    createSignedUrl: async (path, expiresIn) => { calls.push({ op: 'get', bucket: b, path, arg: expiresIn }); return { data: { signedUrl: `http://storage.test/get/${b}/${path}?t=1` }, error: null }; },
    createSignedUploadUrl: async (path, options) => { calls.push({ op: 'put', bucket: b, path, arg: options }); return { data: { signedUrl: `http://storage.test/put/${b}/${path}?token=1` }, error: null }; },
    list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }),
  });
  const storage: StorageLike = { from: bucket };
  const row: JobRow | null = job === null ? null : { id: 7, user_id: OWNER, type: 'photo', status: 'running', input: { path: file() }, ...job };
  const lookups: number[] = [];
  const deps: SignedUrlDeps = { bearer: BEARER, allow: () => true, allowFailure: () => true, storage, lookupJob: async (id) => { lookups.push(id); return row; }, ...over };
  return { deps, calls, lookups };
}
const post = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${BEARER}` }, method = 'POST') =>
  new Request('http://web.test/api/worker/signed-urls', { method, headers, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
const code = async (r: Response) => ((await r.clone().json()) as { error?: { code: string } }).error?.code;

describe('authorisation of /api/worker/signed-urls', () => {
  it('a missing token is 401 and nothing is looked up or signed', async () => {
    const w = world({}); const r = await handleSignedUrls(post({ job_id: 7 }, {}), w.deps);
    expect([r.status, await code(r)]).toEqual([401, 'unauthorised']); expect(w.lookups).toEqual([]); expect(w.calls).toEqual([]);
  });
  it.each([`Bearer ${'x'.repeat(40)}`, `Bearer ${BEARER.slice(0, -1)}x`, 'Bearer short', `Bearer ${BEARER}0`, `Basic ${BEARER}`, BEARER, 'Bearer '])('the wrong or malformed header %j is 401', async (h) => {
    const w = world({}); const r = await handleSignedUrls(post({ job_id: 7 }, { authorization: h }), w.deps);
    expect(r.status).toBe(401); expect(w.lookups).toEqual([]);
  });
  it('a server whose token is not set, or shorter than 32 characters, answers 503 even to a request that presents that token', async () => {
    for (const bearer of [undefined, '', 'short', 'z'.repeat(31)]) {
      const w = world({}, { bearer }); const r = await handleSignedUrls(post({ job_id: 7 }, { authorization: `Bearer ${bearer ?? ''}` }), w.deps);
      expect([r.status, await code(r)]).toEqual([503, 'unavailable']); expect(w.lookups).toEqual([]);
    }
  });
  it.each(['GET', 'PUT', 'DELETE', 'PATCH'])('%s is 405', async (method) => {
    const w = world({}); const r = await handleSignedUrls(post({}, { authorization: `Bearer ${BEARER}` }, method), w.deps);
    expect([r.status, await code(r)]).toEqual([405, 'method_not_allowed']); expect(w.lookups).toEqual([]);
  });
  // WO-0074: the old test here ("429 before the token is compared") pinned the defect (unauthenticated traffic spent the worker's budget); the order is now
  // token first. The two tests below replace it; the budgets themselves are tested with an injected clock in signed-urls-throttle.test.ts.
  it('once the worker\'s own budget is spent a correct token is 429 and nothing is looked up', async () => {
    const w = world({}, { allow: () => false }); const r = await handleSignedUrls(post({ job_id: 7 }), w.deps);
    expect([r.status, await code(r)]).toEqual([429, 'rate_limited']); expect(w.lookups).toEqual([]);
  });
  it('a wrong token is 401 while the failure budget lasts and 429 after it; the worker\'s budget is neither asked nor spent by a failure', async () => {
    let asked = 0; const budgetCalls: string[] = [];
    const w = world({}, { allow: () => { budgetCalls.push('allow'); return true; }, allowFailure: () => { asked += 1; return asked <= 2; } });
    const wrong = () => handleSignedUrls(post({ job_id: 7 }, { authorization: `Bearer ${'x'.repeat(40)}` }), w.deps);
    expect([(await wrong()).status, (await wrong()).status, (await wrong()).status]).toEqual([401, 401, 429]);
    expect(budgetCalls).toEqual([]); expect(w.lookups).toEqual([]);
  });
  it('error bodies are the fixed shape with no input echoed', async () => {
    const w = world({}); const r = await handleSignedUrls(post({ job_id: 7 }, { authorization: 'Bearer secret-guess-0123456789abcdef012345' }), w.deps);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ error: { code: 'unauthorised', message: 'Not authorised.' } });
    expect(text).not.toContain('secret-guess'); expect(r.headers.get('cache-control')).toBe('no-store');
  });
});

describe('the request body', () => {
  it.each([['not json', 'not json'], ['empty', ''], ['array', '[7]'], ['null', 'null'], ['no job_id', '{}'], ['extra key', '{"job_id":7,"path":"x"}'], ['zero', '{"job_id":0}'], ['negative', '{"job_id":-1}'],
    ['fraction', '{"job_id":1.5}'], ['exponent text', '{"job_id":"1e3"}'], ['spaces text', '{"job_id":" 7"}'], ['unsafe integer', '{"job_id":9007199254740993}'], ['boolean', '{"job_id":true}'], ['object', '{"job_id":{"$gt":0}}'],
    ['array id', '{"job_id":[7]}'], ['too long', `{"job_id":"${'1'.repeat(16)}"}`], ['very large body', `{"job_id":7,"x":"${'a'.repeat(400)}"}`]])('%s is 400', async (_n, body) => {
    const w = world({}); const r = await handleSignedUrls(post(body), w.deps);
    expect([r.status, await code(r)]).toEqual([400, 'bad_request']); expect(w.lookups).toEqual([]);
  });
  it('parseJobId takes a positive safe integer or a digit string, nothing else', () => {
    expect(parseJobId({ job_id: 7 })).toBe(7); expect(parseJobId({ job_id: '7' })).toBe(7); expect(parseJobId({ job_id: '007' })).toBe(7);
    for (const b of [null, [], {}, { job_id: 0 }, { job_id: 'a' }, { job_id: 7, x: 1 }, 'x']) expect(parseJobId(b)).toBeNull();
  });
});

describe('the job', () => {
  it('an unknown job is 404', async () => { const w = world(null); const r = await handleSignedUrls(post({ job_id: 7 }), w.deps); expect([r.status, await code(r)]).toEqual([404, 'job_not_found']); expect(w.calls).toEqual([]); });
  it('a row with a different id than asked is 404', async () => { const w = world({ id: 8 }); expect((await handleSignedUrls(post({ job_id: 7 }), w.deps)).status).toBe(404); });
  it.each(['queued', 'done', 'failed', 'weird'])('a %s job is 409 and nothing is signed', async (status) => {
    const w = world({ status }); const r = await handleSignedUrls(post({ job_id: 7 }), w.deps);
    expect([r.status, await code(r)]).toEqual([409, 'job_not_running']); expect(w.calls).toEqual([]);
  });
  it('a lookup that throws is a fixed 500 without detail', async () => {
    const w = world({}, { lookupJob: async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:5432 password=abc'); } });
    const r = await handleSignedUrls(post({ job_id: 7 }), w.deps); const text = await r.text();
    expect(r.status).toBe(500); expect(text).not.toMatch(/ECONNREFUSED|password/);
  });
  it('a running photo job gets a 60-second GET URL for its input and upload URLs for the three server-derived outputs, and nothing else', async () => {
    const w = world({}); const r = await handleSignedUrls(post({ job_id: 7 }), w.deps); const body = await r.json() as { downloads: { path: string }[]; uploads: { kind: string; path: string }[]; download_expires_in: number };
    expect(r.status).toBe(200);
    expect(body.download_expires_in).toBe(60);
    expect(body.downloads.map((d) => d.path)).toEqual([file()]);
    expect(body.uploads).toEqual([
      { kind: 'cutout', path: `${OWNER}/7-cutout.webp`, url: expect.any(String) }, { kind: 'thumb', path: `${OWNER}/7-thumb.webp`, url: expect.any(String) }, { kind: 'original_thumb', path: `${OWNER}/7-orig-thumb.webp`, url: expect.any(String) },
    ]);
    expect(w.calls).toEqual([
      { op: 'get', bucket: 'item-images', path: file(), arg: 60 },
      { op: 'put', bucket: 'item-images', path: `${OWNER}/7-cutout.webp`, arg: { upsert: true } },
      { op: 'put', bucket: 'item-images', path: `${OWNER}/7-thumb.webp`, arg: { upsert: true } },
      { op: 'put', bucket: 'item-images', path: `${OWNER}/7-orig-thumb.webp`, arg: { upsert: true } },
    ]);
  });
  it('several input paths are all signed once each, in the same owner folder', async () => {
    const w = world({ input: { paths: [file(OWNER, 'a.png'), file(OWNER, 'b.png'), file(OWNER, 'a.png')], currency: 'USD' } });
    const r = await handleSignedUrls(post({ job_id: '7' }), w.deps); expect(r.status).toBe(200);
    expect(w.calls.filter((c) => c.op === 'get').map((c) => c.path)).toEqual([file(OWNER, 'a.png'), file(OWNER, 'b.png')]);
  });
  it('a receipt job reads from the receipts bucket and gets no upload URL', async () => {
    const w = world({ type: 'receipt', input: { path: file(OWNER, 'r.pdf') } }); const r = await handleSignedUrls(post({ job_id: 7 }), w.deps);
    expect((await r.json() as { uploads: unknown[] }).uploads).toEqual([]); expect(w.calls).toEqual([{ op: 'get', bucket: 'receipts', path: file(OWNER, 'r.pdf'), arg: 60 }]);
  });
  it('a job of an unknown type is refused', async () => { const w = world({ type: 'export' }); expect((await handleSignedUrls(post({ job_id: 7 }), w.deps)).status).toBe(422); expect(w.calls).toEqual([]); });
  it('a storage error is a fixed 502 and no URL from a half-built answer is returned', async () => {
    const w = world({}, { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'Object not found' } }), createSignedUploadUrl: async () => ({ data: null, error: null }), list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }) } });
    const r = await handleSignedUrls(post({ job_id: 7 }), w.deps); const text = await r.text();
    expect(r.status).toBe(502); expect(text).not.toContain('Object not found');
  });
});

describe('path injection through the job input is never signed (defence in depth: the database check can be bypassed by the owner role)', () => {
  const BAD: [string, unknown][] = [
    ['another user\'s folder', { path: file(OTHER) }], ['a parent folder', { path: `${OWNER}/../${OTHER}/x.png` }], ['a dot-dot name', { path: `${OWNER}/..` }], ['an encoded dot-dot', { path: `${OWNER}/%2e%2e/x.png` }],
    ['a nested folder', { path: `${OWNER}/a/b.png` }], ['a leading slash', { path: `/${OWNER}/x.png` }], ['a backslash', { path: `${OWNER}\\x.png` }], ['no folder', { path: 'x.png' }], ['the folder only', { path: `${OWNER}/` }],
    ['a hidden file', { path: `${OWNER}/.env` }], ['a name of 129 characters', { path: `${OWNER}/${'a'.repeat(129)}` }], ['a null byte', { path: `${OWNER}/x\u0000.png` }], ['a newline', { path: `${OWNER}/x\n.png` }],
    ['a space', { path: `${OWNER}/x y.png` }], ['a path that is a number', { path: 5 }], ['a path that is an object', { path: { a: 1 } }], ['paths that is a string', { paths: file() }],
    ['an empty paths list', { paths: [] }], ['five paths', { paths: [1, 2, 3, 4, 5].map((i) => file(OWNER, `${i}.png`)) }], ['one good and one foreign path', { paths: [file(), file(OTHER)] }], ['a good path and a bad one in paths', { path: file(), paths: [`${OWNER}/../x`] }],
    ['no path at all', { currency: 'USD' }], ['an array as input', [file()]], ['a string as input', file()], ['null as input', null], ['a wildcard', { path: `${OWNER}/*` }], ['a query string', { path: `${OWNER}/x.png?token=1` }],
  ];
  it.each(BAD)('%s is 422 and nothing is signed', async (_n, input) => {
    const w = world({ input }); const r = await handleSignedUrls(post({ job_id: 7 }), w.deps);
    expect([r.status, await code(r)]).toEqual([422, 'invalid_job_input']); expect(w.calls).toEqual([]);
  });
  it('a job whose owner id is not a UUID is refused (it cannot be used to build a pattern)', async () => {
    for (const user_id of ['.*', `${OWNER}|${OTHER}`, '', 'not-a-uuid']) { const w = world({ user_id, input: { path: `${user_id}/x.png` } }); expect((await handleSignedUrls(post({ job_id: 7 }), w.deps)).status).toBe(422); expect(w.calls).toEqual([]); }
  });
  it('whatever the body says, every signed path is in the owner folder: outputs come from the owner id and job id only', () => {
    expect(outputPaths('photo', OWNER, 42).map((o) => o.path)).toEqual([`${OWNER}/42-cutout.webp`, `${OWNER}/42-thumb.webp`, `${OWNER}/42-orig-thumb.webp`]);
    expect(outputPaths('receipt', OWNER, 42)).toEqual([]); expect(outputPaths('nonsense', OWNER, 42)).toEqual([]);
  });
  it('inputPaths accepts exactly what app.job_input_ok accepts for the cases above', () => {
    expect(inputPaths(OWNER, { path: file() })).toEqual([file()]);
    expect(inputPaths(OWNER, { paths: [file(OWNER, 'a'), file(OWNER, 'b')] })).toEqual([file(OWNER, 'a'), file(OWNER, 'b')]);
    for (const [, input] of BAD) expect(inputPaths(OWNER, input)).toBeNull();
  });
});
