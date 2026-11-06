import { describe, expect, it, vi } from 'vitest';
import { leaveThePilot, purgeMyStorage, PURGE_FAILED, PURGE_NO_CONNECTION, PURGE_PATH, REENTER } from './account-actions';

const json = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('purgeMyStorage (the browser side of the file removal)', () => {
  it('posts to the fixed same-origin path with the session cookie, nothing else', async () => {
    const send = vi.fn(async () => json(200, { ok: true, removed: {} }));
    expect(await purgeMyStorage(send)).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('/api/account/purge-storage', { method: 'POST', credentials: 'same-origin' });
    expect(PURGE_PATH).toBe('/api/account/purge-storage');
  });
  it('success needs HTTP 200 AND ok: true in the body', async () => {
    for (const r of [json(200, {}), json(200, { ok: 'true' }), json(200, 'not json'), json(500, { ok: true })]) expect((await purgeMyStorage(async () => r)).ok).toBe(false);
  });
  it('a stale sign-in asks for the password again', async () => {
    expect(await purgeMyStorage(async () => json(403, { error: { code: 'reauthentication_required' } }))).toEqual({ ok: false, reason: 'credentials', message: REENTER });
  });
  it('no session says so; any other failure uses the fixed text and does not echo the server', async () => {
    expect(await purgeMyStorage(async () => json(401, { error: { code: 'not_signed_in' } }))).toMatchObject({ ok: false, reason: 'session' });
    expect(await purgeMyStorage(async () => json(500, { error: { code: 'purge_incomplete', message: 'secret-detail' } }))).toEqual({ ok: false, reason: 'failed', message: PURGE_FAILED });
    expect(await purgeMyStorage(async () => new Response('<html>sign in</html>', { status: 200 }))).toEqual({ ok: false, reason: 'failed', message: PURGE_FAILED });
  });
  it('a network error is a clear message and never throws', async () => {
    expect(await purgeMyStorage(async () => { throw new TypeError('fetch failed'); })).toEqual({ ok: false, reason: 'failed', message: PURGE_NO_CONNECTION });
  });
});

/** The same fake as account-actions.test.ts needs, in short: records the order of the calls. */
function fake(order: string[], rpcData: unknown = 'deleted') {
  const client = {
    auth: { getUser: async () => { order.push('getUser'); return { data: { user: { email: 'a@example.test' } }, error: null }; }, signInWithPassword: async () => { order.push('signIn'); return { error: null }; }, signOut: async () => { order.push('signOut'); return { error: null }; } },
    schema: () => ({ rpc: async (fn: string) => { order.push(`rpc:${fn}`); return { data: rpcData, error: null, status: 200 }; } }),
  };
  return client as unknown as Parameters<typeof leaveThePilot>[0];
}
describe('Leave the pilot with the file removal', () => {
  it('order: fresh sign-in, then the files, then delete_my_account, then the local sign-out', async () => {
    const order: string[] = [];
    const out = await leaveThePilot(fake(order), 'pw', async () => { order.push('purge'); return { ok: true }; });
    expect(out).toEqual({ ok: true, result: 'deleted' });
    expect(order).toEqual(['getUser', 'signIn', 'purge', 'rpc:delete_my_account', 'signOut']);
  });
  it('a failed removal stops everything: the account is not deleted, the person sees the message and can retry', async () => {
    const order: string[] = [];
    const out = await leaveThePilot(fake(order), 'pw', async () => ({ ok: false, reason: 'failed', message: PURGE_FAILED }));
    expect(out).toEqual({ ok: false, reason: 'failed', message: PURGE_FAILED });
    expect(order).not.toContain('rpc:delete_my_account'); expect(order).not.toContain('signOut');
    expect(out.ok === false && out.message).toContain('your account was not deleted');
  });
  it('the removal is not attempted when the password is wrong or empty', async () => {
    const purge = vi.fn(async () => ({ ok: true as const }));
    expect((await leaveThePilot(fake([]), '', purge)).ok).toBe(false);
    const client = { auth: { getUser: async () => ({ data: { user: { email: 'a@example.test' } }, error: null }), signInWithPassword: async () => ({ error: { code: 'invalid_credentials', status: 400 } }) }, schema: () => { throw new Error('no'); } } as unknown as Parameters<typeof leaveThePilot>[0];
    expect((await leaveThePilot(client, 'bad', purge)).ok).toBe(false);
    expect(purge).not.toHaveBeenCalled();
  });
  it('without a step the behaviour is the one of R2c (the Leave screen always passes one: source.test.ts)', async () => {
    const order: string[] = []; expect((await leaveThePilot(fake(order), 'pw')).ok).toBe(true); expect(order).not.toContain('purge');
  });
});
