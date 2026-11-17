import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateState } from './lib/supabase/gate';

// WO-0088: the admin routes and page through the proxy (same set-up as proxy-account.test.ts: the session updater is stubbed; no server, no network).
const updateSession = vi.fn();
vi.mock('./lib/supabase/proxy-session', () => ({ updateSession: (...a: unknown[]) => updateSession(...a) }));
const { proxy, config } = await import('./proxy');
const at = (path: string, method = 'GET') => new NextRequest(`http://127.0.0.1:3000${path}`, { method });
const answers = (state: GateState) => updateSession.mockImplementation(async () => ({ response: NextResponse.next(), state }));
const where = (res: Response) => { const l = res.headers.get('location'); return l ? new URL(l).pathname + new URL(l).search : null; };
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase'); updateSession.mockReset(); });
afterEach(() => vi.unstubAllEnvs());

const API = ['/api/admin/sources', '/api/admin/sources/3/takedown', '/api/admin/catalog/review'];
describe('proxy(): the admin routes answer for themselves in every state, after the session has been refreshed', () => {
  const STATES: GateState[] = ['unauthenticated', 'needs_email_confirmation', 'needs_documents', 'needs_pilot_notice', 'needs_onboarding', 'not_available', 'admin', 'ready'];
  it.each(STATES.flatMap((s) => API.map((p): [GateState, string] => [s, p])))('%s on %s is let through (no redirect to a sign-in page)', async (state, path) => {
    answers(state);
    const res = await proxy(at(path, 'POST'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('location')).toBeNull();
    expect(updateSession).toHaveBeenCalledTimes(1);
  });
  it('when the account service is down they fail closed with the fixed text, like every other route', async () => {
    updateSession.mockImplementation(async () => { throw new Error('connect ECONNREFUSED secret-detail'); });
    const res = await proxy(at('/api/admin/sources'));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/ECONNREFUSED|secret-detail/);
  });
  it('near misses are still gated', async () => {
    answers('unauthenticated');
    for (const p of ['/api/adminx', '/api/admin-x/sources', '/admin', '/admin/other']) expect(where(await proxy(at(p))), p).toMatch(/^\/sign-in/);
  });
});

describe('proxy(): the admin page', () => {
  it.each([['admin', '/admin/catalog', null], ['admin', '/', '/admin/catalog'], ['admin', '/catalogue', '/admin/catalog'], ['ready', '/admin/catalog', '/'], ['not_available', '/admin/catalog', '/not-available'],
    ['needs_onboarding', '/admin/catalog', '/onboarding'], ['unauthenticated', '/admin/catalog', '/sign-in?next=%2Fadmin%2Fcatalog'], ['needs_email_confirmation', '/admin/catalog', '/check-your-email']] as const)(
    '%s on %s goes to %s', async (state, path, target) => {
      answers(state);
      const res = await proxy(at(path));
      if (target === null) expect(res.headers.get('x-middleware-next')).toBe('1'); else expect(where(res)).toBe(target);
    });
  it('the matcher sends the admin page and routes through the proxy', () => {
    const matched = (path: string) => new RegExp(`^${config.matcher[0]!}$`).test(path);
    for (const p of ['/admin/catalog', ...API]) expect(matched(p), p).toBe(true);
  });
});
