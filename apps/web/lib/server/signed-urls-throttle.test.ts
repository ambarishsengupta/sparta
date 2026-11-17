import { describe, expect, it, vi } from 'vitest';
import type { StorageLike } from './api';
import { bearerToken, tokenMatches } from './limits';
import { handleSignedUrls, WORKER_BUDGET, workerLimiters, type JobRow, type SignedUrlDeps } from './signed-urls';

// WO-0074 item 1: the per-process limiter must not let unauthenticated traffic lock out the real worker. Everything here runs in process with an
// injected clock and the real limiter code; no network, no timers. The hashing spy records which crypto calls the token comparison makes.
const spy = vi.hoisted(() => ({ trace: [] as string[] }));
vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>();
  return {
    ...real,
    createHash: (algorithm: string) => { spy.trace.push(`hash:${algorithm}`); return real.createHash(algorithm); },
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => { spy.trace.push(`equal:${a.byteLength}:${b.byteLength}`); return real.timingSafeEqual(a, b); },
  };
});

const GOOD = 'k'.repeat(40);
const OWNER = '11111111-1111-4111-8111-111111111111';
const job: JobRow = { id: 7, user_id: OWNER, type: 'receipt', status: 'running', input: { path: `${OWNER}/r.pdf` } };
const storage: StorageLike = { from: () => ({
  createSignedUrl: async () => ({ data: { signedUrl: 'http://storage.test/x' }, error: null }), createSignedUploadUrl: async () => ({ data: { signedUrl: 'http://storage.test/y' }, error: null }),
  list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }),
}) };
function setup() {
  const clock = { now: 1_000_000 };
  const limiters = workerLimiters(() => clock.now);
  const lookups: number[] = [];
  const deps: SignedUrlDeps = { bearer: GOOD, ...limiters, storage, lookupJob: async (id) => { lookups.push(id); return job; } };
  const call = async (auth?: string) => (await handleSignedUrls(new Request('http://web.test/api/worker/signed-urls', { method: 'POST', headers: auth === undefined ? {} : { authorization: auth }, body: '{"job_id":7}' }), deps)).status;
  return { clock, call, lookups };
}
const wrong = (i: number) => `Bearer guess-${i}-${'x'.repeat(40)}`;

describe('the budgets (injected clock, real limiter code)', () => {
  it('the numbers are the work order\'s: 120 correct calls and 30 failures per minute', () => { expect(WORKER_BUDGET).toEqual({ calls: 120, failures: 30, windowMs: 60_000 }); });
  it('500 unauthenticated requests, then an authenticated one succeeds', async () => {
    const t = setup();
    const statuses = new Set<number>();
    for (let i = 0; i < 500; i++) statuses.add(await t.call(i % 2 === 0 ? undefined : wrong(i)));
    expect([...statuses].sort()).toEqual([401, 429]);
    expect(await t.call(`Bearer ${GOOD}`)).toBe(200);
    expect(t.lookups).toEqual([7]);
  });
  it('failures are throttled: the first 30 in a minute are 401, the rest 429, and the next minute starts again', async () => {
    const t = setup();
    const first: number[] = []; for (let i = 0; i < 35; i++) first.push(await t.call(wrong(i)));
    expect(first.slice(0, 30)).toEqual(Array(30).fill(401)); expect(first.slice(30)).toEqual(Array(5).fill(429));
    t.clock.now += 59_999; expect(await t.call(wrong(99))).toBe(429);
    t.clock.now += 1; expect(await t.call(wrong(100))).toBe(401);
  });
  it('a correct token is never answered 429 because of failures, however many and however late in the window', async () => {
    const t = setup();
    for (let i = 0; i < 200; i++) expect(await t.call(wrong(i))).toBe(i < 30 ? 401 : 429);
    for (let i = 0; i < 100; i++) expect(await t.call(`Bearer ${GOOD}`)).toBe(200);
  });
  it('the correct-token budget works: 120 calls succeed, the 121st is 429, the next minute succeeds', async () => {
    const t = setup();
    for (let i = 0; i < 120; i++) expect(await t.call(`Bearer ${GOOD}`)).toBe(200);
    expect(await t.call(`Bearer ${GOOD}`)).toBe(429); expect(t.lookups.length).toBe(120);
    t.clock.now += 60_000; expect(await t.call(`Bearer ${GOOD}`)).toBe(200);
  });
  it('the two budgets are separate: spent successes do not turn a failure into 429, and failures do not spend successes', async () => {
    const t = setup();
    for (let i = 0; i < 120; i++) await t.call(`Bearer ${GOOD}`);
    expect(await t.call(wrong(1))).toBe(401);
    const u = setup();
    for (let i = 0; i < 100; i++) await u.call(wrong(i));
    for (let i = 0; i < 120; i++) expect(await u.call(`Bearer ${GOOD}`)).toBe(200);
    expect(await u.call(`Bearer ${GOOD}`)).toBe(429);
  });
  it('requests on a misconfigured server (token unset or short) are 503 and spend neither budget', async () => {
    let failures = 0; let calls = 0;
    const deps: SignedUrlDeps = { bearer: 'short', allow: () => { calls += 1; return true; }, allowFailure: () => { failures += 1; return true; }, storage, lookupJob: async () => job };
    const r = await handleSignedUrls(new Request('http://web.test/x', { method: 'POST', headers: { authorization: 'Bearer short' }, body: '{}' }), deps);
    expect(r.status).toBe(503); expect([calls, failures]).toEqual([0, 0]);
  });
});

describe('the token comparison does the same work for every presented value (compare hashes, never lengths)', () => {
  const sequence = (presented: string | null) => { spy.trace.length = 0; tokenMatches(presented, GOOD); return [...spy.trace]; };
  it('missing, empty, short, same-length wrong, long and correct tokens all hash both values and compare two 32-byte digests, in the same order', () => {
    const expected = ['hash:sha256', 'hash:sha256', 'equal:32:32'];
    for (const p of [null, '', 'a', 'x'.repeat(31), 'x'.repeat(40), 'k'.repeat(39) + 'z', 'x'.repeat(5000), GOOD]) expect(sequence(p)).toEqual(expected);
  });
  it('the same through the handler: a header with no scheme, a short token, a wrong-length token and a wrong-value token leave the same trace', async () => {
    const t = setup();
    const traceOf = async (auth?: string) => { spy.trace.length = 0; await t.call(auth); return spy.trace.filter((x) => x.startsWith('hash') || x.startsWith('equal')); };
    const reference = await traceOf(`Bearer ${GOOD}`);
    expect(reference).toEqual(['hash:sha256', 'hash:sha256', 'equal:32:32']);
    for (const h of [undefined, 'Bearer ', 'Bearer short', `Bearer ${'y'.repeat(40)}`, `Bearer ${'y'.repeat(900)}`, `Bearer ${GOOD}0`, `Basic ${GOOD}`]) expect(await traceOf(h)).toEqual(reference);
  });
  it('the results are unchanged: only the identical token of at least 32 characters matches', () => {
    expect(tokenMatches(GOOD, GOOD)).toBe(true);
    expect(tokenMatches('x'.repeat(31), 'x'.repeat(31))).toBe(false);
    expect(tokenMatches('', '')).toBe(false);
    expect(tokenMatches(null, null)).toBe(false);
    expect(bearerToken(`Bearer ${GOOD}`)).toBe(GOOD);
  });
});
