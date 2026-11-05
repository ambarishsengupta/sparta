import { readdirSync } from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeNextPath } from './lib/auth-form';
import { PRIOR_URL, UNLOCK_URL } from './lib/engine-config';
import type { GateState } from './lib/supabase/gate';

// The proxy() wrapper called as a function, with the session updater stubbed (WO-0053 M2, m3, m4). No server, no network.
const updateSession = vi.fn();
vi.mock('./lib/supabase/proxy-session', () => ({ updateSession: (...a: unknown[]) => updateSession(...a) }));
const { proxy, config } = await import('./proxy');

const OUTAGE = 'Sparta cannot check your account right now. Please try again in a moment.';
const at = (path: string, init?: { method?: string }) => new NextRequest(`http://127.0.0.1:3000${path}`, init);
const answers = (state: GateState) => updateSession.mockImplementation(async () => ({ response: NextResponse.next(), state }));
const down = () => updateSession.mockImplementation(async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:54321 secret-detail'); });

beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase'); updateSession.mockReset(); });
afterEach(() => vi.unstubAllEnvs());

describe('proxy(): the session updater fails, so the request is refused (fail closed, M2)', () => {
  it.each(['/', '/outfits', '/items/new', '/accept-terms', '/sign-in', '/auth/callback', '/api/account/export'])('GET %s answers 503 with the fixed text and no detail', async (path) => {
    down();
    const res = await proxy(at(path));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(OUTAGE);
  });
  it('an updater that rejects with a network error is refused the same way', async () => {
    updateSession.mockRejectedValue(new TypeError('fetch failed'));
    expect((await proxy(at('/outfits'))).status).toBe(503);
  });
  it('a request that fails the check is never passed on, and the failure is not turned into an allow', async () => {
    down();
    const res = await proxy(at('/outfits'));
    expect(res.headers.get('x-middleware-next')).toBeNull();
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('proxy(): public pages and signing out are decided before the session updater is called (m3)', () => {
  it.each(['/privacy', '/terms', '/privacy/', '/terms?x=1'])('GET %s works during an outage and the updater is not called', async (path) => {
    down();
    const res = await proxy(at(path));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(updateSession).not.toHaveBeenCalled();
  });
  it('POST /auth/sign-out works during an outage', async () => {
    down();
    const res = await proxy(at('/auth/sign-out', { method: 'POST' }));
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(updateSession).not.toHaveBeenCalled();
  });
  it.each([['GET', '/auth/sign-out'], ['GET', '/privacy/../outfits'], ['GET', '/privacy%2f..%2foutfits'], ['POST', '/outfits'], ['POST', '/privacy-x'], ['GET', '/auth/callback'], ['GET', '/']])(
    '%s %s is not one of them: it still fails closed', async (method, path) => {
      down();
      expect((await proxy(at(path, { method }))).status).toBe(503);
      expect(updateSession).toHaveBeenCalled();
    });
});

describe('proxy(): what it decides when the session is fine', () => {
  it('does nothing with the local backend, and never calls the updater', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'local');
    down();
    const res = await proxy(at('/outfits'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(updateSession).not.toHaveBeenCalled();
  });
  it('passes a ready person on, and sends an unauthenticated one to sign-in', async () => {
    answers('ready');
    expect((await proxy(at('/outfits'))).headers.get('x-middleware-next')).toBe('1');
    answers('unauthenticated');
    const res = await proxy(at('/outfits'));
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get('location')!);
    expect(to.pathname + to.search).toBe('/sign-in?next=%2Foutfits');
  });
  it('keeps the query string in next, encoded as one parameter, and the sign-in page gets the same path back (m4)', async () => {
    answers('unauthenticated');
    const res = await proxy(at('/outfits?anchor=item-1&x=%2F%2Fevil.com'));
    const to = new URL(res.headers.get('location')!);
    expect(to.pathname).toBe('/sign-in');
    expect([...to.searchParams.keys()]).toEqual(['next']);
    expect(to.searchParams.get('next')).toBe('/outfits?anchor=item-1&x=%2F%2Fevil.com');
    expect(safeNextPath(to.searchParams.get('next'))).toBe('/outfits?anchor=item-1&x=%2F%2Fevil.com');
    expect(to.search).toBe('?next=%2Foutfits%3Fanchor%3Ditem-1%26x%3D%252F%252Fevil.com');
  });
  it('copies the refreshed session cookies onto a redirect', async () => {
    updateSession.mockImplementation(async () => { const response = NextResponse.next(); response.cookies.set('sb-x-auth-token', 'v'); return { response, state: 'needs_documents' }; });
    const res = await proxy(at('/outfits'));
    expect(res.headers.get('location')).toContain('/accept-terms');
    expect(res.cookies.get('sb-x-auth-token')?.value).toBe('v');
  });
});

describe('the matcher: which requests reach proxy() (M2)', () => {
  const matcher = config.matcher[0]!;
  // Next compiles the source into an anchored expression; the source is a path-to-regexp pattern whose only group is a plain regular expression.
  const matched = (path: string) => new RegExp(`^${matcher}$`).test(path);
  it('has exactly one source, which starts at the root', () => { expect(config.matcher).toHaveLength(1); expect(matcher.startsWith('/(')).toBe(true); });
  it.each(['/', '/outfits', '/outfits/', '/items/new', '/items/abc-123', '/accept-terms', '/pilot-notice', '/onboarding', '/not-available', '/sign-in', '/auth/callback', '/auth/sign-out',
    '/privacy', '/terms', '/api/account/export', '/_next', '/_next/data/x.json', '/_next/staticx', '/_next/imagex', '/icon.svgx', '/icon.svg/x', '/xmanifest.webmanifest', '/manifest.webmanifest.map',
    '/pairing-prior-v1.json.bak', '/a/icon.svg', '/%69con.svg'])('%s reaches the proxy', (path) => { expect(matched(path)).toBe(true); });
  const publicFiles = readdirSync(new URL('./public', import.meta.url)).map((f) => `/${f}`);
  it.each(['/_next/static/chunks/main.js', '/_next/static/', '/_next/image', '/_next/image/x', ...publicFiles, PRIOR_URL, UNLOCK_URL])('%s is served without a check', (path) => { expect(matched(path)).toBe(false); });
  it('the files excluded by name are exactly the files of public/ plus the two learned files that are copied there locally', () => {
    const named = [...matcher.matchAll(/([\w-]+)\\\.(svg|webmanifest|json)/g)].map((m) => `/${m[1]}.${m[2]}`).sort();
    expect(named).toEqual([...new Set([...publicFiles.filter((f) => !/pairing-prior|unlock-candidates/.test(f)), PRIOR_URL, UNLOCK_URL])].sort());
  });
});
