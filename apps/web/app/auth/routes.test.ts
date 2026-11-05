import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDIRECT_PAYLOADS } from '../../test-support/redirect-payloads';

// The two route handlers of app/auth, called as functions with a fake session client and a fake cookie store (no network, no server).
const store = { all: [] as { name: string }[], deleted: [] as string[] };
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => store.all, delete: (name: string) => store.deleted.push(name) }) }));
const client = { auth: { exchangeCodeForSession: vi.fn(), signOut: vi.fn() } };
vi.mock('../../lib/supabase/server', async (original) => ({ ...(await original<object>()), createServerSupabase: async () => client }));

const { GET } = await import('./callback/route');
const { POST } = await import('./sign-out/route');
const callback = (query: string) => GET(new NextRequest(`http://127.0.0.1:3000/auth/callback?${query}`));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase');
  store.all = [{ name: 'sb-x-auth-token' }, { name: 'sb-x-auth-token-code-verifier' }, { name: 'theme' }];
  store.deleted = [];
  client.auth.exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
  client.auth.signOut.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /auth/callback: the Location header after a good code (B1 sink 1)', () => {
  it.each(REDIRECT_PAYLOADS)('sends the payload %j to the home page, as a relative Location', async (payload) => {
    const res = await callback(`code=abc&next=${encodeURIComponent(payload)}`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/');
  });
  it('keeps legitimate paths, query string included', async () => {
    expect((await callback('code=abc&next=%2Foutfits')).headers.get('location')).toBe('/outfits');
    expect((await callback(`code=abc&next=${encodeURIComponent('/outfits?anchor=item-1')}`)).headers.get('location')).toBe('/outfits?anchor=item-1');
    expect((await callback('code=abc')).headers.get('location')).toBe('/');
  });
  it('a missing, refused or failing code goes to the sign-in page with the link notice, whatever next says', async () => {
    expect((await callback('next=%2Foutfits')).headers.get('location')).toBe('/sign-in?error=link');
    client.auth.exchangeCodeForSession.mockResolvedValue({ error: { message: 'x' } });
    expect((await callback('code=bad&next=%2F%2Fevil.com')).headers.get('location')).toBe('/sign-in?error=link');
  });
  it('exchanges the code once and removes only the one-time code-verifier cookie', async () => {
    await callback('code=abc');
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(store.deleted).toEqual(['sb-x-auth-token-code-verifier']);
  });
  it('answers 404 unless the Supabase backend is on', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'local');
    expect((await callback('code=abc')).status).toBe(404);
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe('POST /auth/sign-out (m8: the signOut action is the one used)', () => {
  it('signs out this device only (scope local) and goes to the sign-in page', async () => {
    const res = await POST();
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect([res.status, res.headers.get('location')]).toEqual([303, '/sign-in']);
  });
  it('clears this device\'s session cookies even when the account service cannot be reached, and nothing else', async () => {
    client.auth.signOut.mockRejectedValue(new TypeError('fetch failed'));
    const res = await POST();
    expect(store.deleted).toEqual(['sb-x-auth-token', 'sb-x-auth-token-code-verifier']);
    expect([res.status, res.headers.get('location')]).toEqual([303, '/sign-in']);
  });
  it('answers 404 unless the Supabase backend is on', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'local');
    expect((await POST()).status).toBe(404);
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });
});
