import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decideRoute, needsNoSession } from './lib/supabase/gate';

// WO-0071: the worker route is reached with a bearer token, not a cookie (excluded from cookie gating); the purge route is allowed while held at a gate step.
const updateSession = vi.fn();
vi.mock('./lib/supabase/proxy-session', () => ({ updateSession: (...a: unknown[]) => updateSession(...a) }));
const { proxy, config } = await import('./proxy');
const at = (path: string, method = 'POST') => new NextRequest(`http://127.0.0.1:3000${path}`, { method });
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase'); updateSession.mockReset(); });
afterEach(() => vi.unstubAllEnvs());

describe('/api/worker/signed-urls and the proxy', () => {
  it('is decided before the session updater, for every method, even when the account service is down', async () => {
    updateSession.mockRejectedValue(new Error('down'));
    for (const m of ['POST', 'GET', 'PUT', 'DELETE']) { const res = await proxy(at('/api/worker/signed-urls', m)); expect(res.status).toBe(200); expect(res.headers.get('x-middleware-next')).toBe('1'); }
    expect(updateSession).not.toHaveBeenCalled();
  });
  it('only that exact path is excluded: neighbours, other casings, encodings and suffixes still need a session', () => {
    expect(needsNoSession('POST', '/api/worker/signed-urls')).toBe(true);
    for (const p of ['/api/worker', '/api/worker/', '/api/worker/signed-urls/x', '/api/worker/signed-urlsx', '/api/Worker/signed-urls', '/api/worker/signed-urls/../signed-urls2', '/api/worker/%73igned-urls/..', '/api/worker//signed-urls', '/api/worker/signed-urls/../../account/export', '/api/account/purge-storage', '/api/internal/housekeeping'])
      expect(needsNoSession('POST', p), p).toBe(false);
  });
  it('the matcher does not skip the route (the proxy runs and lets it through by the rule above)', () => {
    expect(new RegExp(`^${config.matcher[0]}$`).test('/api/worker/signed-urls')).toBe(true);
  });
  it('a signed-in-looking cookie does not change anything and the route is not added to any other list', () => {
    expect(decideRoute('unauthenticated', '/api/worker/signed-urls')).toMatchObject({ action: 'redirect' });   // the gate itself still knows nothing of it: only the proxy shortcut lets it through
  });
});

describe('/api/account/purge-storage and the gate', () => {
  it.each(['needs_documents', 'needs_pilot_notice', 'needs_onboarding', 'not_available', 'ready'] as const)('is allowed while the person is at %s (Leave must work at every step)', (state) => {
    expect(decideRoute(state, '/api/account/purge-storage')).toEqual({ action: 'allow' });
  });
  it('needs a session: an unauthenticated caller is sent to sign-in, and an unconfirmed email is held at the check-your-email step', () => {
    expect(decideRoute('unauthenticated', '/api/account/purge-storage')).toMatchObject({ action: 'redirect' });
    expect(decideRoute('needs_email_confirmation', '/api/account/purge-storage')).toMatchObject({ action: 'redirect', to: '/check-your-email' });
  });
  it('a look-alike path is not allowed while held', () => {
    for (const p of ['/api/account/purge-storagex', '/api/account/purge', '/api/account/purge-storage/../export2']) expect(decideRoute('needs_documents', p), p).toMatchObject({ action: 'redirect' });
  });
});
