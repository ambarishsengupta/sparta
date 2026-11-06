import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decideRoute } from '../../lib/supabase/gate';
import { loadGateState } from '../../lib/supabase/gate-state';
import { acceptDocuments, readVersions } from '../../lib/supabase/consent-actions';
import { cleanup, discover, lockStack, makeReady, newClient, provisionUser, sql } from '../../test-support/stack';
import { exportMyData, leaveThePilot } from './account-actions';

// WO-0062 against the REAL local stack: (F1) the database refuses a delete whose token does not prove a recent sign-in (a password sign-in older than the window, or
// the sign-up confirmation link whose method is email/signup), a fresh sign-in passes, and a refreshed token does not become fresh; (F2) the Auth audit log holds nothing about the person afterwards; (F3) people held at the Terms page and at the pilot notice can
// export and leave. Keys come from `supabase status` at run time. To avoid waiting five minutes, the test sets the window (ops.settings) to 3 seconds and puts it back.
const stack = discover();
if (!stack) console.warn('SKIPPED reauth.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const WINDOW = 3; // seconds
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const claims = (token: string) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { sub: string; amr?: { method: string; timestamp: number }[]; user_metadata?: Record<string, unknown> };
const tokenOf = async (c: SupabaseClient) => (await c.auth.getSession()).data.session!.access_token;

describe.skipIf(!stack)('re-authentication, the Auth audit log, and the held pages against the real stack', () => {
  const run = randomUUID().slice(0, 8);
  const email = { conf: `it-${run}-wconf@example.test`, pwd: `it-${run}-wpwd@example.test`, docs: `it-${run}-wdocs@example.test`, ntc: `it-${run}-wntc@example.test`, ok: `it-${run}-wok@example.test` };
  const pw = randomBytes(12).toString('base64url');
  const mailIds: string[] = [];
  const q = (text: string, vars: Record<string, string> = {}) => sql(text, vars);
  const exists = (id: string) => q(`select count(*) from auth.users where id = :'u'`, { u: id }) === '1';
  const deletions = () => Number(q(`select coalesce(sum(n), 0) from ops.daily_counts where metric = 'deletions' and day = current_date`));
  const auditAbout = (id: string, mail: string) => Number(q(`select count(*) from auth.audit_log_entries where payload::text ilike '%' || :'u' || '%' or payload::text ilike '%' || :'e' || '%'`, { u: id, e: mail }));
  const setting = () => q(`select value from ops.settings where key = 'reauth_window_seconds'`);
  const setWindow = (v: string) => q(`update ops.settings set value = :'v' where key = 'reauth_window_seconds'`, { v });

  let unlock: (() => void) | undefined;
  let originalWindow = '';
  let conf: SupabaseClient; let pwd: SupabaseClient; let docs: SupabaseClient; let ntc: SupabaseClient; let ok: SupabaseClient;
  let ids = { conf: '', pwd: '', docs: '', ntc: '', ok: '' };

  beforeAll(async () => {
    unlock = await lockStack();
    originalWindow = setting();
    [conf, pwd, docs, ntc, ok] = [await provisionUser(stack!, email.conf, pw, mailIds), await provisionUser(stack!, email.pwd, pw, mailIds), await provisionUser(stack!, email.docs, pw, mailIds),
      await provisionUser(stack!, email.ntc, pw, mailIds), await provisionUser(stack!, email.ok, pw, mailIds)];
    const got = (await Promise.all([conf, pwd, docs, ntc, ok].map((c) => c.auth.getUser()))).map((r) => r.data.user!.id) as [string, string, string, string, string];
    ids = { conf: got[0], pwd: got[1], docs: got[2], ntc: got[3], ok: got[4] };
    await makeReady(conf, 'IN'); await makeReady(pwd, 'IN'); await makeReady(ok, 'IN');
    const v = await readVersions(ntc);
    expect(await acceptDocuments(ntc, v!, true)).toEqual({ ok: true });
  });
  afterAll(async () => {
    try {
      if (originalWindow) setWindow(originalWindow);
      for (const e of Object.values(email)) {
        const found = (await (await fetch(`${stack!.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${e}`)}`)).json()) as { messages: { ID: string }[] };
        for (const m of found.messages) if (!mailIds.includes(m.ID)) mailIds.push(m.ID);
      }
      await cleanup(stack!, Object.values(email), mailIds);
    } finally { unlock?.(); }
  });

  it('the setup is what the tests assume: the window is seeded at 300, three people are ready, one is held at the documents, one at the notice', async () => {
    expect(originalWindow).toBe('300');
    expect(await loadGateState(conf)).toBe('ready');
    expect(await loadGateState(docs)).toBe('needs_documents');
    expect(await loadGateState(ntc)).toBe('needs_pilot_notice');
  });

  it('what a real access token carries: amr is a list of {method, timestamp}; a password sign-in has method password and a whole-second timestamp; the sign-up confirmation link has method email/signup', async () => {
    const a = claims(await tokenOf(conf));
    expect(Array.isArray(a.amr)).toBe(true);
    expect(a.amr).toEqual([{ method: 'email/signup', timestamp: expect.any(Number) }]);
    expect(Math.abs(a.amr![0]!.timestamp - Date.now() / 1000)).toBeLessThan(300);
    const pwdSignIn = newClient(stack!);
    expect((await pwdSignIn.auth.signInWithPassword({ email: email.pwd, password: pw })).error).toBeNull();
    const b = claims(await tokenOf(pwdSignIn));
    expect(b.amr).toEqual([{ method: 'password', timestamp: expect.any(Number) }]);
    expect(Number.isInteger(b.amr![0]!.timestamp)).toBe(true);
    expect(Math.abs(b.amr![0]!.timestamp - Date.now() / 1000)).toBeLessThan(10);
    // the claim sits at the top level of the signed token; a person cannot change it through their own metadata
    expect(b.user_metadata?.amr).toBeUndefined();
  });

  it('F1: a token from the sign-up confirmation link is never enough, even a minute old: the function wants a password (or other primary) sign-in', async () => {
    const r = await conf.schema('app').rpc('delete_my_account');
    expect(r.error?.message).toBe('reauthentication_required');
    expect(r.status).toBe(403);
    expect(exists(ids.conf)).toBe(true);
  });

  it('F1: tokens older than the window are refused by the database and nothing is deleted; a refreshed token is no fresher; a fresh sign-in passes', async () => {
    const stale = newClient(stack!);
    expect((await stale.auth.signInWithPassword({ email: email.pwd, password: pw })).error).toBeNull();
    const confToken = await tokenOf(conf);
    try {
      setWindow(String(WINDOW));
      await sleep((WINDOW + 1.5) * 1000);
      const audit = { conf: auditAbout(ids.conf, email.conf), pwd: auditAbout(ids.pwd, email.pwd) };
      const days = deletions();
      // the password sign-in token is now older than the window and the confirmation token never counted: the function, called directly, refuses both
      for (const [label, c, id] of [['confirmation session', conf, ids.conf], ['password sign-in older than the window', stale, ids.pwd]] as const) {
        const r = await c.schema('app').rpc('delete_my_account');
        expect(r.error?.message, label).toBe('reauthentication_required');
        expect(r.error?.code, label).toBe('42501');
        expect(r.status, label).toBe(403);
        expect(r.data, label).toBeNull();
        expect(exists(id), label).toBe(true);
      }
      expect({ conf: auditAbout(ids.conf, email.conf), pwd: auditAbout(ids.pwd, email.pwd), days: deletions() }).toEqual({ ...audit, days });
      // refreshing the session gives a new token with the same sign-in time: still refused
      const stamp = claims(await tokenOf(stale)).amr![0]!.timestamp;
      const refreshed = await stale.auth.refreshSession();
      expect(refreshed.error).toBeNull();
      const after = claims(refreshed.data.session!.access_token);
      expect(after.amr![0]!.timestamp).toBe(stamp);
      expect(refreshed.data.session!.access_token).not.toBe(confToken);
      expect((await stale.schema('app').rpc('delete_my_account')).error?.message).toBe('reauthentication_required');
      expect(exists(ids.pwd)).toBe(true);
      // the app's own flow goes through: it signs in again with the password and the new token is fresh
      const wrong = await leaveThePilot(stale, `${pw}-wrong`);
      expect(wrong).toMatchObject({ ok: false, reason: 'credentials' });
      expect(exists(ids.pwd)).toBe(true);
      expect(await leaveThePilot(stale, pw)).toEqual({ ok: true, result: 'deleted' });
      expect(exists(ids.pwd)).toBe(false);
      expect(deletions()).toBe(days + 1);
      // and so does the confirmation-session person once they have typed the password again
      expect(await leaveThePilot(conf, pw)).toEqual({ ok: true, result: 'deleted' });
      expect(exists(ids.conf)).toBe(false);
      expect(deletions()).toBe(days + 2);
    } finally { setWindow(originalWindow); }
    expect(setting()).toBe('300');
  });

  it('F1: with the real window of 300 seconds a token minted by a fresh sign-in is accepted by the function directly, and the person is gone', async () => {
    const c = newClient(stack!);
    expect((await c.auth.signInWithPassword({ email: email.ok, password: pw })).error).toBeNull();
    const r = await c.schema('app').rpc('delete_my_account');
    expect(r.error).toBeNull();
    expect(r.data).toBe('deleted');
    expect(exists(ids.ok)).toBe(false);
  });

  it('F2: after leaving, the Auth audit log holds nothing that names the person by id or address', async () => {
    // the first F1 test deleted both people and they had signed in several times; check what the audit log holds now
    for (const [id, mail] of [[ids.conf, email.conf], [ids.pwd, email.pwd], [ids.ok, email.ok]] as const) expect(auditAbout(id, mail), mail).toBe(0);
    // and the log works: it records a new person's sign-in, which names them (so the zero above is not an empty table)
    const probe = newClient(stack!);
    expect((await probe.auth.signInWithPassword({ email: email.docs, password: pw })).error).toBeNull();
    expect(auditAbout(ids.docs, email.docs)).toBeGreaterThan(0);
  });

  it('F3: a person held at the Terms and Privacy Policy page can export, and open Leave the pilot, and leave', async () => {
    expect(await loadGateState(docs)).toBe('needs_documents');
    expect(decideRoute('needs_documents', '/leave')).toEqual({ action: 'allow' });
    const out = await exportMyData(docs);
    expect(out.ok).toBe(true);
    const doc = JSON.parse((out as { text: string }).text) as { account: { id: string; email: string }; profiles: unknown[] };
    expect(doc.account).toMatchObject({ id: ids.docs, email: email.docs });
    expect(doc.profiles).toHaveLength(1);
    const days = deletions();
    expect(await leaveThePilot(docs, pw)).toEqual({ ok: true, result: 'deleted' });
    expect(exists(ids.docs)).toBe(false);
    expect(auditAbout(ids.docs, email.docs)).toBe(0);
    expect(deletions()).toBe(days + 1);
  });

  it('F3: a person held at the pilot notice (documents accepted, notice not) can export and leave too', async () => {
    expect(await loadGateState(ntc)).toBe('needs_pilot_notice');
    expect(decideRoute('needs_pilot_notice', '/leave')).toEqual({ action: 'allow' });
    const out = await exportMyData(ntc);
    expect(out.ok).toBe(true);
    const doc = JSON.parse((out as { text: string }).text) as { account: { id: string }; document_acceptances: unknown[]; consent_records: unknown[] };
    expect(doc.account.id).toBe(ids.ntc);
    expect(doc.document_acceptances).toHaveLength(2);
    expect(doc.consent_records).toHaveLength(0);
    expect(await leaveThePilot(ntc, pw)).toEqual({ ok: true, result: 'deleted' });
    expect(exists(ids.ntc)).toBe(false);
    expect(await loadGateState(ntc)).toBe('unauthenticated');
  });
});
