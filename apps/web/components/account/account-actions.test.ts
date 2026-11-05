import { describe, expect, it } from 'vitest';
import { exportFilename, exportMyData, isExportDocument, leaveThePilot, readProfile, saveProfile, sessionCookieNames } from './account-actions';

type Answer = { data?: unknown; error?: { code?: string; message?: string; name?: string; status?: number } | null; status?: number };
interface Script { user?: { data: { user: { id: string; email?: string } | null }; error: { name?: string; status?: number } | null }; signIn?: Answer; rpc?: Answer | (() => never); signOut?: 'throws'; table?: Answer | 'throws'; throwOnGetUser?: boolean }

/** A client whose every call is written to `calls`, in order, with its arguments. */
function fake(s: Script = {}) {
  const calls: string[] = [];
  const args: Record<string, unknown[]> = {};
  const note = (name: string, ...a: unknown[]) => { calls.push(name); args[name] = a; };
  const client = {
    auth: {
      getUser: async () => { note('getUser'); if (s.throwOnGetUser) throw new TypeError('fetch failed'); return s.user ?? { data: { user: { id: 'u-1', email: 'asha@example.test' } }, error: null }; },
      signInWithPassword: async (c: unknown) => { note('signIn', c); return { data: {}, error: null, ...s.signIn }; },
      signOut: async (o: unknown) => { note('signOut', o); if (s.signOut === 'throws') throw new TypeError('fetch failed'); return { error: null }; },
    },
    schema: (name: string) => ({
      rpc: async (fn: string, a?: unknown) => { note(`rpc:${name}.${fn}`, a); if (typeof s.rpc === 'function') s.rpc(); return { data: 'deleted', error: null, status: 200, ...(s.rpc as Answer | undefined) }; },
      from: (table: string) => {
        if (s.table === 'throws') throw new TypeError('fetch failed');
        const chain: Record<string, unknown> = {};
        const done = { data: [{ id: 'u-1' }], error: null, status: 200, ...(s.table as Answer | undefined) };
        for (const m of ['select', 'update', 'eq']) chain[m] = (...a: unknown[]) => { note(`${table}.${m}`, ...a); return chain; };
        chain.maybeSingle = async () => done;
        chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(done).then(ok);
        return chain;
      },
    }),
  };
  return { client: client as never, calls, args };
}

const DOC = { format_version: 1, generated_at: '2026-11-06T10:00:00Z', account: { id: 'u-1', email: 'asha@example.test', created_at: 'x' }, profiles: [{ id: 'u-1' }], items: [] };

describe('export (FR-62)', () => {
  it('asks the database function for the caller\'s document and nothing else, with no argument', async () => {
    const f = fake({ rpc: { data: DOC } });
    const out = await exportMyData(f.client, new Date('2026-11-06T23:59:00Z'));
    expect(f.calls).toEqual(['rpc:app.export_my_data']);
    expect(f.args['rpc:app.export_my_data']).toEqual([undefined]);
    expect(out).toEqual({ ok: true, text: JSON.stringify(DOC, null, 2), filename: 'sparta-export-2026-11-06.json' });
  });
  it('the file name holds the date and nothing about the person', () => {
    expect(exportFilename(new Date('2026-01-02T00:00:00Z'))).toBe('sparta-export-2026-01-02.json');
    expect(exportFilename(new Date('2026-12-31T23:59:59Z'))).not.toMatch(/@|u-1|asha/);
  });
  it.each([
    [{ error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 }, /session has ended/],
    [{ error: { code: '42501', message: 'forbidden' }, status: 403 }, /not allowed to export/],
    [{ error: { message: 'boom' }, status: 0 }, /Could not reach the server/],
    [{ error: { message: 'boom' }, status: 500 }, /could not be made/],
  ] as [Answer, RegExp][])('a failed call %j gives a fixed sentence and no file', async (answer, sentence) => {
    const out = await exportMyData(fake({ rpc: answer }).client);
    expect(out).toEqual({ ok: false, message: expect.stringMatching(sentence) });
    expect(JSON.stringify(out)).not.toMatch(/boom|JWT|forbidden|PGRST/);
  });
  it('a request that fails to leave the browser is a network error; a thrown error of any other kind is unexpected', async () => {
    expect(await exportMyData(fake({ rpc: () => { throw new TypeError('fetch failed'); } }).client)).toEqual({ ok: false, message: expect.stringMatching(/Could not reach/) });
    expect(await exportMyData(fake({ rpc: () => { throw new Error('x'); } }).client)).toEqual({ ok: false, message: expect.stringMatching(/could not be made/) });
  });
  it.each([[null], [[]], ['text'], [{}], [{ ...DOC, format_version: 2 }], [{ ...DOC, account: null }], [{ ...DOC, account: {} }], [{ ...DOC, profiles: undefined }], [{ ...DOC, generated_at: 5 }]])('an answer that is not an export document (%j) is not saved as one', async (data) => {
    expect(isExportDocument(data)).toBe(false);
    expect(await exportMyData(fake({ rpc: { data } }).client)).toEqual({ ok: false, message: expect.stringMatching(/could not be made/) });
  });
});

describe('leave the pilot (FR-63, FR-66)', () => {
  it('asks for the password again first, then deletes with no argument, then ends the session: in that order, once each', async () => {
    const f = fake();
    const typed = 'correct horse';
    expect(await leaveThePilot(f.client, typed)).toEqual({ ok: true, result: 'deleted' });
    expect(f.calls).toEqual(['getUser', 'signIn', 'rpc:app.delete_my_account', 'signOut']);
    expect(f.args.signIn).toEqual([{ email: 'asha@example.test', password: typed }]);
    expect(f.args['rpc:app.delete_my_account']).toEqual([undefined]);
    expect(f.args.signOut).toEqual([{ scope: 'local' }]);
  });
  it('an empty password calls nothing at all', async () => {
    const f = fake();
    expect(await leaveThePilot(f.client, '')).toEqual({ ok: false, reason: 'credentials', message: 'Enter your password to confirm.' });
    expect(f.calls).toEqual([]);
  });
  it('a wrong password deletes nothing and does not end the session: the delete function is never called', async () => {
    const f = fake({ signIn: { error: { code: 'invalid_credentials', status: 400 } } });
    const out = await leaveThePilot(f.client, 'wrong');
    expect(out).toEqual({ ok: false, reason: 'credentials', message: expect.stringContaining('nothing was deleted') });
    expect(f.calls).toEqual(['getUser', 'signIn']);
  });
  it.each([
    [{ code: 'over_request_rate_limit', status: 429 }, /Too many attempts, so nothing was deleted/],
    [{ code: 'unexpected_failure', status: 500 }, /before anything was deleted/],
  ])('a sign-in refused for another reason (%j) deletes nothing', async (error, sentence) => {
    const f = fake({ signIn: { error } });
    expect(await leaveThePilot(f.client, 'pw')).toEqual({ ok: false, reason: 'failed', message: expect.stringMatching(sentence) });
    expect(f.calls).toEqual(['getUser', 'signIn']);
  });
  it('without a session, or with a session that has no email, nothing is asked and nothing is deleted', async () => {
    for (const user of [{ data: { user: null }, error: { name: 'AuthSessionMissingError', status: 400 } }, { data: { user: { id: 'u' } }, error: null }, { data: { user: null }, error: null }]) {
      const f = fake({ user });
      expect(await leaveThePilot(f.client, 'pw')).toEqual({ ok: false, reason: 'session', message: expect.stringContaining('nothing was deleted') });
      expect(f.calls).toEqual(['getUser']);
    }
  });
  it('a service that cannot be reached before the delete says nothing was deleted, and does not blame the session', async () => {
    for (const f of [fake({ user: { data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 0 } } }), fake({ throwOnGetUser: true })]) {
      expect(await leaveThePilot(f.client, 'pw')).toEqual({ ok: false, reason: 'failed', message: expect.stringContaining('nothing was deleted') });
      expect(f.calls.includes('rpc:app.delete_my_account')).toBe(false);
    }
  });
  it('a second call after the account is gone is a success too ("already_deleted")', async () => {
    expect(await leaveThePilot(fake({ rpc: { data: 'already_deleted' } }).client, 'pw')).toEqual({ ok: true, result: 'already_deleted' });
  });
  it('the function refusing the caller (a vendor or admin) is reported as refused, with no claim of a deletion either way', async () => {
    const f = fake({ rpc: { data: null, error: { code: '42501', message: 'forbidden' }, status: 403 } });
    const out = await leaveThePilot(f.client, 'pw');
    expect(out).toEqual({ ok: false, reason: 'failed', message: expect.stringContaining('not allowed to leave') });
    expect(f.calls).not.toContain('signOut');
  });
  it('an error or an odd answer during the delete says the result is unknown, never that nothing was deleted', async () => {
    for (const rpc of [{ data: null, error: { code: 'XX000', message: 'x' }, status: 500 }, { data: 'maybe' }, { data: null }, { data: true }] as Answer[]) {
      const out = await leaveThePilot(fake({ rpc }).client, 'pw');
      expect(out).toEqual({ ok: false, reason: 'unsure', message: expect.stringContaining('could not confirm') });
      expect(JSON.stringify(out)).not.toMatch(/nothing was deleted/i);
    }
    expect(await leaveThePilot(fake({ rpc: () => { throw new TypeError('fetch failed'); } }).client, 'pw')).toEqual({ ok: false, reason: 'unsure', message: expect.stringContaining('could not confirm') });
  });
  it('a failure to end the local session after a delete does not turn a success into a failure', async () => {
    const f = fake({ signOut: 'throws' });
    expect(await leaveThePilot(f.client, 'pw')).toEqual({ ok: true, result: 'deleted' });
  });
  it('no message ever contains the password, the email or server text', async () => {
    const f = fake({ signIn: { error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials asha@example.test hunter2' } } });
    expect(JSON.stringify(await leaveThePilot(f.client, 'hunter2'))).not.toMatch(/hunter2|asha@|Invalid login/);
  });
});

describe('sessionCookieNames: which cookies are swept after leaving', () => {
  it('lists every sb- cookie, including the numbered pieces and the code verifier, and nothing else', () => {
    expect(sessionCookieNames('theme=dark; sb-127-auth-token.0=aaa; sb-127-auth-token.1=bbb; sb-127-auth-token-code-verifier=c; other=1')).toEqual(['sb-127-auth-token.0', 'sb-127-auth-token.1', 'sb-127-auth-token-code-verifier']);
    expect(sessionCookieNames('')).toEqual([]);
    expect(sessionCookieNames('xsb-a=1; a-sb-b=2')).toEqual([]);
  });
});

describe('settings: reading and saving the caller\'s own profile', () => {
  const row = { display_name: null, country: 'IN', hemisphere: 'north', currency: 'INR', occasions: ['Work'] };
  it('reads display name, country, hemisphere, currency and occasions, and nothing else is selected', async () => {
    const f = fake({ table: { data: row } });
    expect(await readProfile(f.client)).toEqual({ displayName: '', country: 'IN', hemisphere: 'north', currency: 'INR', occasions: ['Work'] });
    expect(f.args['profiles.select']).toEqual(['display_name, country, hemisphere, currency, occasions']);
  });
  it('is null when the row cannot be read, is missing, or the call throws', async () => {
    expect(await readProfile(fake({ table: { data: null, error: { message: 'x' } } }).client)).toBeNull();
    expect(await readProfile(fake({ table: { data: null } }).client)).toBeNull();
    expect(await readProfile(fake({ table: 'throws' }).client)).toBeNull();
  });
  it('saves with the signed-in person\'s own id, and needs exactly one row to have changed', async () => {
    const f = fake();
    expect(await saveProfile(f.client, { display_name: 'A', hemisphere: 'south', currency: 'USD', occasions: [] })).toEqual({ ok: true });
    expect(f.args['profiles.eq']).toEqual(['id', 'u-1']);
    expect(f.args['profiles.update']).toEqual([{ display_name: 'A', hemisphere: 'south', currency: 'USD', occasions: [] }]);
    for (const data of [[], null, [{ id: 'a' }, { id: 'b' }]]) expect((await saveProfile(fake({ table: { data } }).client, { display_name: null, hemisphere: 'north', currency: 'INR', occasions: [] })).ok).toBe(false);
  });
  it('says so when there is no session, when the server refuses, and when the network is down', async () => {
    const patch = { display_name: null, hemisphere: 'north' as const, currency: 'INR', occasions: [] };
    expect(await saveProfile(fake({ user: { data: { user: null }, error: { status: 401 } } }).client, patch)).toEqual({ ok: false, message: expect.stringContaining('session has ended') });
    expect(await saveProfile(fake({ table: { data: null, error: { code: '42501' }, status: 403 } }).client, patch)).toEqual({ ok: false, message: expect.stringContaining('not saved') });
    expect(await saveProfile(fake({ table: { data: null, error: { message: 'x' }, status: 0 } }).client, patch)).toEqual({ ok: false, message: expect.stringContaining('Could not reach') });
    expect(await saveProfile(fake({ table: 'throws' }).client, patch)).toEqual({ ok: false, message: expect.stringContaining('Could not reach') });
  });
});

