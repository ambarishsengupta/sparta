import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LOCK = join(tmpdir(), 'sparta-int-suites.lock');
/** The integration suites share one database, and one of them (consent.int.test.ts) changes the document versions for a moment, which would
 * stop another suite's user from writing. Each suite therefore holds this lock (a directory, created atomically) from its first hook to its
 * last, so they run one after the other even though vitest starts the files together. A lock older than 60 seconds (a suite takes about 5) is taken over. Returns the release function. */
export async function lockStack(): Promise<() => void> {
  const giveUp = Date.now() + 100_000; // below the 120 s hook timeouts, so the message below is the one that is seen (six suites queue here since WO-0071; one took 35 s to reach the front)
  for (;;) {
    try { mkdirSync(LOCK); return () => rmSync(LOCK, { recursive: true, force: true }); } catch {
      try { if (Date.now() - statSync(LOCK).mtimeMs > 60_000) rmSync(LOCK, { recursive: true, force: true }); } catch { /* released by its owner meanwhile */ }
      if (Date.now() > giveUp) throw new Error('the integration-suite lock was not released within 100 seconds');
      await sleep(250);
    }
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
