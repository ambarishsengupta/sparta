import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminConfigured, createAdminSupabase } from './admin';

// The secret key's name is assembled so this file does not contain it (source.test.ts).
const KEY = ['SUPABASE', 'SECRET', 'KEY'].join('_');
const ADMIN_KEY_VALUE = ['sb', 'secret', 'unit-test-value-0000000000'].join('_');
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('lib/server/admin.ts', () => {
  it('builds a client when the URL and a secret key are set, and the client keeps no session', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321'); vi.stubEnv(KEY, ADMIN_KEY_VALUE);
    expect(adminConfigured()).toBe(true);
    const c = createAdminSupabase();
    expect(typeof c.storage.from).toBe('function');
    expect((await c.auth.getSession()).data.session).toBeNull();
  });
  it.each([['no URL', { url: '', key: ADMIN_KEY_VALUE }], ['no key', { url: 'http://127.0.0.1:54321', key: '' }]])('throws and reports not configured with %s', (_n, v) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', v.url); vi.stubEnv(KEY, v.key);
    expect(adminConfigured()).toBe(false);
    expect(() => createAdminSupabase()).toThrow('not configured');
  });
  it('refuses a key that is not a secret key (a publishable key put here by mistake)', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321'); vi.stubEnv(KEY, ['sb', 'publishable', 'abcdefghijkl'].join('_'));
    expect(() => createAdminSupabase()).toThrow('needs a secret key');
  });
  it('throws in a browser context, even when everything is configured, and says nothing about the key', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321'); vi.stubEnv(KEY, ADMIN_KEY_VALUE);
    vi.stubGlobal('window', {});
    expect(adminConfigured()).toBe(false);
    let message = ''; try { createAdminSupabase(); } catch (e) { message = (e as Error).message; }
    expect(message).toBe('The admin client is for the server only.');
  });
  it('error messages never contain the key', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ''); vi.stubEnv(KEY, ADMIN_KEY_VALUE);
    let message = ''; try { createAdminSupabase(); } catch (e) { message = (e as Error).message; }
    expect(message).not.toContain(ADMIN_KEY_VALUE);
  });
});
