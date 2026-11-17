import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { signUpWithEmail } from '../lib/supabase/auth-actions';
import { acceptDocuments, acceptPilotNotice, completeOnboarding, readVersions } from '../lib/supabase/consent-actions';

/** Helpers for the integration suites that run against the REAL local stack. Test support only: nothing in the app imports this file.
 * The URL and publishable key are read from `supabase status` at run time and never written to a file. */
export type Stack = { url: string; key: string; mailpit: string; secret: string };

export function discover(): Stack | null {
  try {
    const out = execFileSync('supabase', ['status', '-o', 'json'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }).toString();
    const s = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
    execFileSync('docker', ['exec', 'supabase_db_sparta', 'psql', '-U', 'postgres', '-tAc', 'select 1'], { stdio: 'ignore', timeout: 20_000 });
    return s.API_URL && s.PUBLISHABLE_KEY && s.MAILPIT_URL ? { url: s.API_URL, key: s.PUBLISHABLE_KEY, mailpit: s.MAILPIT_URL, secret: s.SECRET_KEY ?? '' } : null;
  } catch { return null; }
}

/** Runs SQL in the local database container with psql variables (:'name'), so test values are never spliced into the text. */
export function sql(text: string, vars: Record<string, string> = {}): string {
  const args = Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]);
  return execFileSync('docker', ['exec', '-i', 'supabase_db_sparta', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', ...args, '-f', '-'], { input: text }).toString().trim();
}

export const newClient = (s: Stack): SupabaseClient => createClient(s.url, s.key, { auth: { persistSession: false, autoRefreshToken: false, flowType: 'pkce' } });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const LOCK = join(tmpdir(), 'sparta-int-suites.lock');
export const LOCK_REFRESH_MS = 10_000;
export const LOCK_STALE_MS = 60_000;
export const LOCK_GIVE_UP_MS = 100_000;
/** Everything `lockStack` takes from the outside, so a test can run it with a fake clock and a fake timer (WO-0074). */
export interface LockEnv {
  dir: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Like setInterval; the returned handle may have `unref`. */
  every: (fn: () => void, ms: number) => { unref?: () => unknown };
  stop: (handle: { unref?: () => unknown }) => void;
}
const realEnv: LockEnv = { dir: LOCK, now: Date.now, sleep, every: (fn, ms) => setInterval(fn, ms), stop: (h) => clearInterval(h as ReturnType<typeof setInterval>) };

/** The integration suites share one database, and one of them (consent.int.test.ts) changes the document versions for a moment, which would
 * stop another suite's user from writing. Each suite therefore holds this lock (a directory, created atomically) from its first hook to its
 * last, so they run one after the other even though vitest starts the files together. A lock whose directory has not been touched for 60 seconds
 * (its holder died) is taken over; a live holder touches it every 10 seconds (an unref'd timer, cleared on release), so a long suite is never
 * taken over while another waits up to 100 s. Returns the release function. */
export async function lockStack(env: Partial<LockEnv> = {}): Promise<() => void> {
  const e: LockEnv = { ...realEnv, ...env };
  const giveUp = e.now() + LOCK_GIVE_UP_MS; // below the 120 s hook timeouts, so the message below is the one that is seen (six suites queue here since WO-0071; one took 35 s to reach the front)
  for (;;) {
    let held = false;
    try { mkdirSync(e.dir); held = true; } catch {
      try { if (e.now() - statSync(e.dir).mtimeMs > LOCK_STALE_MS) rmSync(e.dir, { recursive: true, force: true }); } catch { /* released by its owner meanwhile */ }
      if (e.now() > giveUp) throw new Error('the integration-suite lock was not released within 100 seconds');
    }
    if (held) {
      const timer = e.every(() => { try { const t = e.now() / 1000; utimesSync(e.dir, t, t); } catch { /* the lock is gone (released or taken over): nothing to keep alive */ } }, LOCK_REFRESH_MS);
      timer.unref?.();
      return () => { e.stop(timer); rmSync(e.dir, { recursive: true, force: true }); };
    }
    await e.sleep(250);
  }
}

async function confirmationLink(s: Stack, email: string): Promise<{ id: string; link: string }> {
  for (let i = 0; i < 30; i++) {
    const found = (await (await fetch(`${s.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages: { ID: string }[] };
    const id = found.messages[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${s.mailpit}/api/v1/message/${id}`)).json()) as { Text: string };
      const link = /https?:\/\/[^\s)"<>]*\/auth\/v1\/verify[^\s)"<>]*/.exec(msg.Text)?.[0];
      if (link) return { id, link };
    }
    await sleep(500);
  }
  throw new Error('no confirmation email arrived in Mailpit');
}

/** Invites the address, signs it up through the real sign-up call, confirms it through the Mailpit message and returns a client signed in as that user. */
export async function provisionUser(s: Stack, email: string, password: string, mailIds: string[]): Promise<SupabaseClient> {
  sql(`insert into ops.invitations (email) values (:'email')`, { email });
  const client = newClient(s);
  const up = await signUpWithEmail(client, email, password, 'http://127.0.0.1:3000/auth/callback');
  if (!up.ok) throw new Error(`sign-up failed: ${up.message}`);
  const { id, link } = await confirmationLink(s, email);
  mailIds.push(id);
  const location = (await fetch(link, { redirect: 'manual' })).headers.get('location') ?? '';
  const exchanged = await client.auth.exchangeCodeForSession(new URL(location).searchParams.get('code')!);
  if (exchanged.error) throw new Error('the confirmation code was not accepted');
  return client;
}

/** Removes the test users, their invitations and their Mailpit messages. */
export async function cleanup(s: Stack, emails: string[], mailIds: string[]): Promise<void> {
  for (const id of mailIds) await fetch(`${s.mailpit}/api/v1/messages`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IDs: [id] }) });
  for (const email of emails) sql(`delete from auth.users where email = :'e'; delete from ops.invitations where email = :'e'`, { e: email });
}

/** Takes a provisioned user through the Terms and Privacy Policy, the pilot notice and onboarding, as the screens do. A country that is not supported ends at not-available. */
export async function makeReady(client: SupabaseClient, country: string): Promise<void> {
  const v = await readVersions(client);
  if (!v) throw new Error('the versions could not be read');
  for (const step of [await acceptDocuments(client, v, true), await acceptPilotNotice(client, v.notice), await completeOnboarding(client, { country, hemisphere: 'north', currency: 'USD', occasions: [] })])
    if (!step.ok) throw new Error(`onboarding step failed: ${step.message}`);
}
