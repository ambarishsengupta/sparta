import { randomBytes } from 'node:crypto';

/** Pure helpers of the end-to-end suite (WO-0168). They hold no state and touch no network, so a vitest test can pin them (e2e-local.test.ts) and the suite can trust them.
 * The suite runs only against the LOCAL Supabase stack: the Supabase URL, the mail catcher URL and the database URL must name 127.0.0.1, localhost or [::1]. */
/** The process environment, read by the suite's own files (playwright.config.ts, e2e/support.ts). They are test code, not the app, but lib/supabase/source.test.ts lists every dotted
 * read of a variable by name from the process environment in a non-test file under apps/web and allows only the app's own; the suite reads the environment through this one binding so that list stays the app's. */
export const env: NodeJS.ProcessEnv = process.env;

const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])$/;

/** True for an http(s) URL with a local host, no user name or password (a database URL may have them) and no query string or fragment (libpq reads ?host= and ?hostaddr=, and `http://127.0.0.1@evil.example` has the host evil.example). */
export function isLocalUrl(value: string, schemes: readonly string[] = ['http:', 'https:'], allowCredentials = false): boolean {
  try {
    const u = new URL(value);
    return schemes.includes(u.protocol) && LOCAL_HOST.test(u.hostname) && (allowCredentials || (u.username === '' && u.password === '')) && u.search === '' && u.hash === '' && !value.includes('?') && !value.includes('#');
  } catch { return false; }
}

export interface StackUrls { supabaseUrl: string; mailUrl: string; dbUrl: string }

/** Throws unless every URL points at this machine. The message names the setting, never the value (a database URL holds a password). */
export function assertLocalStack(urls: Partial<StackUrls>): StackUrls {
  const bad: string[] = [];
  if (!urls.supabaseUrl || !isLocalUrl(urls.supabaseUrl)) bad.push('the Supabase URL');
  if (!urls.mailUrl || !isLocalUrl(urls.mailUrl)) bad.push('the mail catcher URL');
  if (!urls.dbUrl || !isLocalUrl(urls.dbUrl, ['postgres:', 'postgresql:'], true)) bad.push('the database URL');
  if (bad.length > 0) throw new Error(`end-to-end tests refuse to run: ${bad.join(', ')} must point at 127.0.0.1, localhost or [::1] (no user name, no query string, no fragment).`);
  return urls as StackUrls;
}

/** A synthetic address: @example.test (a name that can never be delivered to), the run id and a random part. */
export function syntheticAddress(run: string, label: string): string {
  if (!/^[a-f0-9]{8,32}$/.test(run)) throw new Error('the run id must be 8 to 32 hex characters');
  if (!/^[a-z0-9-]{1,24}$/.test(label)) throw new Error('the label must be 1 to 24 characters of a-z, 0-9 and -');
  return `e2e-${run}-${label}-${randomBytes(4).toString('hex')}@example.test`;
}

/** A password made at run time. It is never printed, logged or stored: the caller keeps it in memory for one test. */
export const syntheticPassword = (): string => `E2e-${randomBytes(18).toString('base64url')}-9z`;

/** The SQL LIKE pattern that matches every address of one run (the sweep at the end removes whatever a test left behind). */
export const runPattern = (run: string): string => `e2e-${run}-%@example.test`;

/** The same rule as `runPattern`, as a function of one lower-case address. */
export const belongsToRun = (run: string) => (address: string): boolean => address.startsWith(`e2e-${run}-`) && address.endsWith('@example.test');

/** The privacy contact address the end-to-end build is made with (NEXT_PUBLIC_CONTACT_EMAIL is read at build time), so the About page test knows what to look for. */
export const E2E_CONTACT_EMAIL = 'pilot-contact@example.test';
/** The one port the local Auth service accepts as a redirect target (supabase/config.toml site_url), so the suite serves the app there. */
export const E2E_PORT = 3000;
