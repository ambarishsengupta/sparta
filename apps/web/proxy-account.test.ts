import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateState } from './lib/supabase/gate';

// R2c: the proxy and the account routes (same set-up as proxy.test.ts: the session updater is stubbed; no server, no network).
const updateSession = vi.fn();
vi.mock('./lib/supabase/proxy-session', () => ({ updateSession: (...a: unknown[]) => updateSession(...a) }));
const { proxy, config } = await import('./proxy');

const at = (path: string, init?: { method?: string }) => new NextRequest(`http://127.0.0.1:3000${path}`, init);
const answers = (state: GateState) => updateSession.mockImplementation(async () => ({ response: NextResponse.next(), state }));
const down = () => updateSession.mockImplementation(async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:54321 secret-detail'); });
const where = (res: Response) => { const l = res.headers.get('location'); return l ? new URL(l).pathname + new URL(l).search : null; };

beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase'); updateSession.mockReset(); });
afterEach(() => vi.unstubAllEnvs());

describe('proxy(): the goodbye, about and notice pages need no account service', () => {
  it.each(['/goodbye', '/about', '/notice'])('GET %s works during an outage and the updater is not called', async (path) => {
    down();
    const res = await proxy(at(path));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(updateSession).not.toHaveBeenCalled();
  });
  it.each(['/leave', '/settings'])('GET %s during an outage is refused (fail closed) with the fixed text', async (path) => {
    down();
    const res = await proxy(at(path));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/ECONNREFUSED|secret-detail/);
  });
});

describe('proxy(): who reaches Settings and Leave the pilot', () => {
  it.each([
    ['ready', '/settings', null], ['ready', '/leave', null],
    ['not_available', '/leave', null], ['needs_pilot_notice', '/leave', null], ['needs_documents', '/leave', null], ['needs_onboarding', '/leave', null],
    ['not_available', '/settings', '/not-available'], ['needs_pilot_notice', '/settings', '/pilot-notice'], ['needs_email_confirmation', '/leave', '/check-your-email'],
    ['unauthenticated', '/settings', '/sign-in?next=%2Fsettings'], ['unauthenticated', '/leave', '/sign-in?next=%2Fleave'],
  ] as const)('%s on %s goes to %s', async (state, path, target) => {
    answers(state);
    const res = await proxy(at(path));
    if (target === null) { expect(res.headers.get('x-middleware-next')).toBe('1'); expect(res.headers.get('location')).toBeNull(); } else { expect(res.status).toBe(307); expect(where(res)).toBe(target); }
    expect(updateSession).toHaveBeenCalledTimes(1);
  });
  it('the leave page is reached with GET; the proxy treats every method alike for a held person (the deletion itself is a call to the database from the page)', async () => {
    answers('not_available');
    expect((await proxy(at('/leave', { method: 'POST' }))).headers.get('x-middleware-next')).toBe('1');
  });
});

describe('the matcher sends the new routes through the proxy', () => {
  const matched = (path: string) => new RegExp(`^${config.matcher[0]!}$`).test(path);
  it.each(['/settings', '/leave', '/goodbye', '/about', '/notice'])('%s', (path) => { expect(matched(path)).toBe(true); });
});
