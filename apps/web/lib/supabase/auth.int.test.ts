import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INVITE_ONLY_MESSAGE, signInWithEmail, signOut, signUpWithEmail } from './auth-actions';
import { lockStack } from '../../test-support/stack';
import { decideRoute } from './gate';
import { loadGateState } from './gate-state';

// Integration suite against the REAL local stack (CC3). The URL and publishable key are read from `supabase status` at run
// time and never written to a file. The setup uses `docker exec ... psql` on the local database container only, to create
// its own invitation rows and to clean up. The suite skips, with a message, when the stack is not running.
type Stack = { url: string; key: string; mailpit: string };
function discover(): Stack | null {
  try {
    const out = execFileSync('supabase', ['status', '-o', 'json'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }).toString();
    const s = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
    execFileSync('docker', ['exec', 'supabase_db_sparta', 'psql', '-U', 'postgres', '-tAc', 'select 1'], { stdio: 'ignore', timeout: 20_000 });
    return s.API_URL && s.PUBLISHABLE_KEY && s.MAILPIT_URL ? { url: s.API_URL, key: s.PUBLISHABLE_KEY, mailpit: s.MAILPIT_URL } : null;
  } catch { return null; }
}
const stack = discover();
if (!stack) console.warn('SKIPPED auth.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');

/** Runs SQL in the local database with psql variables (:'name'), so test values are never spliced into the text. */
function sql(text: string, vars: Record<string, string> = {}): string {
  const args = Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]);
  return execFileSync('docker', ['exec', '-i', 'supabase_db_sparta', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', ...args, '-f', '-'], { input: text }).toString().trim();
}
const newClient = (): SupabaseClient => createClient(stack!.url, stack!.key, { auth: { persistSession: false, autoRefreshToken: false, flowType: 'pkce' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function confirmationLink(email: string): Promise<{ id: string; link: string }> {
  for (let i = 0; i < 30; i++) {
    const found = (await (await fetch(`${stack!.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages: { ID: string }[] };
    const id = found.messages[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${stack!.mailpit}/api/v1/message/${id}`)).json()) as { Text: string };
      const link = /https?:\/\/[^\s)"<>]*\/auth\/v1\/verify[^\s)"<>]*/.exec(msg.Text)?.[0];
      if (link) return { id, link };
    }
    await sleep(500);
  }
  throw new Error('no confirmation email arrived in Mailpit');
}

vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });
describe.skipIf(!stack)('sign-up, confirmation, sign-in, gate state and sign-out against the real stack', () => {
  const run = randomUUID().slice(0, 8);
  const invited = `it-${run}-in@example.test`;
  const uninvited = `it-${run}-out@example.test`;
  const pw = randomBytes(12).toString('base64url');
  let client: SupabaseClient; // created in beforeAll: the body of a skipped suite is still collected, and there is no stack to read then
  const mailIds: string[] = [];
  const rpc = (name: string, args?: object) => client.schema('app').rpc(name, args);
  const setting = async (key: string) => (await rpc('public_setting', { p_key: key })).data as string;

  let unlock: (() => void) | undefined;
  beforeAll(async () => {
    unlock = await lockStack();
    client = newClient();
    sql(`insert into ops.invitations (email) values (:'email')`, { email: invited });
  });
  afterAll(async () => {
    try { await tidy(); } finally { unlock?.(); }
  });
  const tidy = async () => {
    const more = (await (await fetch(`${stack!.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${invited}`)}`)).json()) as { messages: { ID: string }[] };
    for (const m of more.messages) if (!mailIds.includes(m.ID)) mailIds.push(m.ID); // the messages that a repeated sign-up may have sent
    for (const id of mailIds) await fetch(`${stack!.mailpit}/api/v1/messages`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IDs: [id] }) });
    sql(`delete from auth.users where email in (:'a', :'b'); delete from ops.invitations where email in (:'a', :'b')`, { a: invited, b: uninvited });
  };

  it('refuses an address that is not on the invitation list with the FR-8 message, and creates no account', async () => {
    const out = await signUpWithEmail(newClient(), uninvited, pw, 'http://127.0.0.1:3000/auth/callback');
    expect(out).toEqual({ ok: false, message: 'Sparta is invitation-only during the pilot.' });
    expect(out).toEqual({ ok: false, message: INVITE_ONLY_MESSAGE });
    expect(sql(`select count(*) from auth.users where email = :'email'`, { email: uninvited })).toBe('0');
  });
  it('refuses a password shorter than 10 characters on the server too, naming the minimum', async () => {
    const out = await signUpWithEmail(newClient(), invited, 'x'.repeat(9), 'http://127.0.0.1:3000/auth/callback');
    expect(out.ok).toBe(false);
    expect(out.ok ? '' : out.message).toMatch(/at least 10 characters/);
  });
  it('lets the invited address sign up, but not sign in before the email is confirmed', async () => {
    expect(await signUpWithEmail(client, invited, pw, 'http://127.0.0.1:3000/auth/callback')).toEqual({ ok: true });
    const early = await signInWithEmail(newClient(), invited, pw);
    expect(early.ok).toBe(false);
    expect(early.ok ? '' : early.message).toMatch(/not confirmed yet/);
    expect(await loadGateState(newClient())).toBe('unauthenticated');
  });
  it('confirms through the Mailpit message: the link redirects to the callback with a code that gives a session', async () => {
    const { id, link } = await confirmationLink(invited);
    mailIds.push(id);
    const res = await fetch(link, { redirect: 'manual' });
    const location = res.headers.get('location') ?? '';
    expect(res.status).toBe(303);
    expect(location).toMatch(/^http:\/\/127\.0\.0\.1:3000\/auth\/callback\?code=/);
    const exchanged = await client.auth.exchangeCodeForSession(new URL(location).searchParams.get('code')!);
    expect(exchanged.error).toBeNull();
    expect(exchanged.data.session?.user.email).toBe(invited);
    expect((await signOut(client)).ok).toBe(true);
  });
  it('rejects a wrong password in plain words, then signs in with the right one', async () => {
    const wrong = await signInWithEmail(newClient(), invited, `${pw}-wrong`);
    expect(wrong).toEqual({ ok: false, message: 'That email and password do not match. Check them and try again.' });
    expect(await signInWithEmail(client, invited, pw)).toEqual({ ok: true });
    expect((await client.auth.getSession()).data.session?.user.email).toBe(invited);
  });
  it('a sign-up for an address that already has an account gets the same neutral answer as a new one, and creates nothing (m5)', async () => {
    const before = sql(`select count(*) from auth.users where email = :'email'`, { email: invited });
    expect(before).toBe('1');
    expect(await signUpWithEmail(newClient(), invited, pw, 'http://127.0.0.1:3000/auth/callback')).toEqual({ ok: true });
    expect(await signUpWithEmail(newClient(), invited, `${pw}-other`, 'http://127.0.0.1:3000/auth/callback')).toEqual({ ok: true });
    expect(sql(`select count(*) from auth.users where email = :'email'`, { email: invited })).toBe(before);
    expect((await signInWithEmail(newClient(), invited, `${pw}-other`)).ok).toBe(false); // the second password was not set on the account
  });
  it('before acceptance the user sees no wardrobe rows and the app routes to accept-terms', async () => {
    const items = await client.schema('app').from('items').select('id');
    expect(items.data ?? []).toEqual([]);
    expect((await rpc('has_consent')).data).toBe(false);
    const state = await loadGateState(client);
    expect(state).toBe('needs_documents');
    expect(decideRoute(state, '/')).toEqual({ action: 'redirect', to: '/accept-terms' });
    expect(decideRoute(state, '/accept-terms')).toEqual({ action: 'allow' });
  });
  it('moves through the gates one at a time: documents, pilot notice, onboarding, ready', async () => {
    const [terms, privacy, notice] = await Promise.all([setting('current_terms_version'), setting('current_privacy_version'), setting('current_notice_version')]);
    expect((await rpc('accept_documents', { p_terms_version: terms, p_privacy_version: privacy, p_age_confirmed: false })).error?.message).toContain('age_not_confirmed');
    expect(await loadGateState(client)).toBe('needs_documents');
    expect((await rpc('accept_documents', { p_terms_version: terms, p_privacy_version: privacy, p_age_confirmed: true })).error).toBeNull();
    expect(await loadGateState(client)).toBe('needs_pilot_notice');
    const consent = await client.schema('app').from('consent_records').insert({ user_id: (await client.auth.getUser()).data.user!.id, notice_version: notice });
    expect(consent.error).toBeNull();
    expect(await loadGateState(client)).toBe('needs_onboarding');
    expect((await rpc('complete_onboarding', { p_country: 'IN', p_hemisphere: 'north', p_currency: 'INR' })).data).toBe('ok');
    const state = await loadGateState(client);
    expect(state).toBe('ready');
    expect(decideRoute(state, '/outfits')).toEqual({ action: 'allow' });
    expect(decideRoute(state, '/accept-terms')).toEqual({ action: 'redirect', to: '/' });
    expect((await client.schema('app').from('items').select('id')).error).toBeNull();
  });
  it('an unsupported country gives the not-available state, and a supported one restores access', async () => {
    expect((await rpc('complete_onboarding', { p_country: 'US', p_hemisphere: 'north', p_currency: 'USD' })).data).toBe('unsupported_country');
    const state = await loadGateState(client);
    expect(state).toBe('not_available');
    expect(decideRoute(state, '/outfits')).toEqual({ action: 'redirect', to: '/not-available' });
    expect(decideRoute(state, '/api/account/export')).toEqual({ action: 'allow' });
    expect((await client.schema('app').from('items').select('id')).data ?? []).toEqual([]);
    expect((await rpc('complete_onboarding', { p_country: 'IN', p_hemisphere: 'north', p_currency: 'INR' })).data).toBe('ok');
    expect(await loadGateState(client)).toBe('ready');
  });
  it('sign-out clears the session: no user, state unauthenticated, no rows', async () => {
    expect(await signOut(client)).toEqual({ ok: true });
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(await loadGateState(client)).toBe('unauthenticated');
    expect(decideRoute('unauthenticated', '/').action).toBe('redirect');
    expect((await client.schema('app').from('profiles').select('id')).data ?? []).toEqual([]);
  });
});
