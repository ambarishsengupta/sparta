// WO-0166 (R8b): the email-delivery check against the LOCAL mail catcher (Mailpit, run by `supabase start`). Run through email-check.sh, which refuses non-local targets,
// reads the URLs and the publishable key from `supabase status` and cleans up on every exit. It uses only @example.test addresses, only the publishable key (never the secret key) and
// only the local mail catcher: nothing is sent off this machine. Environment (set by the .sh): EMAIL_CHECK_API_URL, EMAIL_CHECK_MAILPIT_URL, EMAIL_CHECK_PUBLISHABLE_KEY, EMAIL_CHECK_DB_URL,
// EMAIL_CHECK_RUN_ID (the unique part of the addresses), EMAIL_CHECK_WAIT_SECONDS (1 to 30, default 30: how long each wait for a mail lasts).
// Modes: no argument = run the check; --snapshot = print the counts the .sh compares before and after; --audit-note = print how many Auth audit-log rows name the run's addresses; --cleanup = remove everything the run id created (idempotent).
// Exit 0 = all three checks passed; 1 = a check failed, a wait timed out or the clean-up failed; 2 = refused (non-local target or missing setting).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const EXPECT = {
  sender: 'admin@email.com',                  // the local mail catcher's default sender (supabase/config.toml [local_smtp] admin_email is not set)
  verifySubject: 'Confirm your email address', // the signup template the local Auth service sends (supabase/config.toml has no custom template)
  resetSubject: 'Reset your password',
  refusal: 'Sparta is invitation-only during the pilot.', // FR-8: ops.check_invitation's 403 message
};
const NOT_COVERED = 'NOT COVERED: export email (not built; LLD 6 export-ready email needs the provider, QC 11b)';

class Fail extends Error {}
const env = (name: string): string => {
  const v = process.env[name];
  if (!v) { console.error(`email-check: refusing to run: ${name} is not set (run it through supabase/scripts/email-check.sh).`); process.exit(2); }
  return v;
};
const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])$/;
function hostIsLocal(value: string): boolean {
  try { return LOCAL_HOST.test(new URL(value).hostname); } catch { return false; }
}
/** A configured URL (not a mail link): local host and no query string or fragment (libpq reads ?host= and ?hostaddr=). */
function requireLocal(name: string, value: string): string {
  if (!hostIsLocal(value) || value.includes('?') || value.includes('#')) { console.error(`email-check: refusing to run: ${name} must point at 127.0.0.1, localhost or [::1] (no query string, no fragment).`); process.exit(2); }
  return value.replace(/\/+$/, '');
}

const mode = process.argv[2] ?? 'run';
const API = requireLocal('API URL', env('EMAIL_CHECK_API_URL'));
const MAIL = requireLocal('mail catcher URL', env('EMAIL_CHECK_MAILPIT_URL'));
const DB_URL = requireLocal('database URL', env('EMAIL_CHECK_DB_URL'));
const KEY = env('EMAIL_CHECK_PUBLISHABLE_KEY');
const RUN = env('EMAIL_CHECK_RUN_ID');
if (!/^[a-f0-9]{8,32}$/.test(RUN)) { console.error('email-check: refusing to run: EMAIL_CHECK_RUN_ID must be 8 to 32 hex characters.'); process.exit(2); }
const waitRaw = process.env.EMAIL_CHECK_WAIT_SECONDS ?? '30';
if (!/^\d{1,2}$/.test(waitRaw) || Number(waitRaw) < 1 || Number(waitRaw) > 30) { console.error('email-check: refusing to run: EMAIL_CHECK_WAIT_SECONDS must be a whole number from 1 to 30.'); process.exit(2); }
const WAIT_MS = Number(waitRaw) * 1000;   // every wait has this 30-second ceiling
const STEP_MS = 30_000;                    // every single HTTP call has the same ceiling
const POLL_MS = Number(process.env.EMAIL_CHECK_POLL_MS ?? '500') || 500;

const INVITED = `emailcheck-${RUN}-invited@example.test`;
const UNINVITED = `emailcheck-${RUN}-uninvited@example.test`;
const ADDRESSES = [INVITED, UNINVITED];

// ---- database (as postgres, through psql or `docker exec` into the local stack's database container) ----
const PG_VARS = ['PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGSERVICE', 'PGSERVICEFILE', 'PGSYSCONFDIR', 'PGDATABASE', 'PGUSER', 'PGPASSFILE', 'PGPASSWORD', 'PGSSLMODE', 'PGOPTIONS', 'PGAPPNAME', 'PGTARGETSESSIONATTRS', 'PGCONNECT_TIMEOUT'];
function sql(text: string, vars: Record<string, string> = {}): string {
  const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const k of PG_VARS) delete cleanEnv[k];
  const opts = '-c statement_timeout=25000 -c lock_timeout=10000';
  const psqlArgs = ['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-At', ...Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]), '-f', '-'];
  const haveClient = spawnSync('psql', ['--version'], { encoding: 'utf8', timeout: 10_000 }).error === undefined;
  const r = haveClient
    ? spawnSync('psql', [DB_URL, ...psqlArgs], { input: text, encoding: 'utf8', timeout: STEP_MS, env: { ...cleanEnv, PGOPTIONS: opts } })
    : spawnSync('docker', ['exec', '-i', '-e', `PGOPTIONS=${opts}`, `supabase_db_${projectId()}`, 'psql', '-U', 'postgres', ...psqlArgs], { input: text, encoding: 'utf8', timeout: STEP_MS, env: cleanEnv });
  if (r.status !== 0) throw new Fail(`database step failed: ${(r.stderr || r.error?.message || 'no output').trim().split('\n').slice(-2).join(' ').slice(0, 300)}`);
  return r.stdout.trim();
}
function projectId(): string {
  try { return /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync('supabase/config.toml', 'utf8'))?.[1] ?? 'sparta'; } catch { return 'sparta'; }
}

const SNAPSHOT_SQL = `-- q:snapshot
select 'invitations=' || (select count(*) from ops.invitations)
  || ' users=' || (select count(*) from auth.users)
  || ' signups_day=' || current_date
  || ' signups_n=' || coalesce((select d.n::text from ops.daily_counts d where d.day = current_date and d.metric = 'signups'), '-');`;

// removes the users, the invitations and (so the counts are equal again) the sign-up count they raised; safe to run twice
const CLEANUP_SQL = `-- q:cleanup
begin;
create temp table gone on commit drop as select id, created_at::date as d from auth.users where email in (:'a1', :'a2');
delete from auth.users where id in (select id from gone);
update ops.daily_counts t set n = greatest(t.n - g.c, 0) from (select d, count(*) as c from gone group by d) g where t.day = g.d and t.metric = 'signups';
delete from ops.daily_counts t where t.metric = 'signups' and t.n = 0 and t.day in (select d from gone);
delete from ops.invitations where email in (:'a1', :'a2');
commit;`;

// ---- HTTP, always with a 30-second ceiling ----
async function call(url: string, init: RequestInit = {}): Promise<Response> {
  try { return await fetch(url, { redirect: 'manual', ...init, signal: AbortSignal.timeout(STEP_MS) }); }
  catch (e) { throw new Fail(`${init.method ?? 'GET'} ${url.replace(/\?.*$/, '')} failed or timed out after ${STEP_MS / 1000} s: ${(e as Error).message}`); }
}
const authHeaders = (token?: string): Record<string, string> => ({ apikey: KEY, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) });
const post = (path: string, body: unknown): Promise<Response> => call(`${API}${path}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });

interface Mail { ID: string; Subject: string; From: { Address: string }; To: { Address: string }[] }
async function mailsTo(addr: string): Promise<Mail[]> {
  const r = await call(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${addr}"`)}`);
  if (r.status !== 200) throw new Fail(`mail catcher search answered ${r.status}`);
  const j = (await r.json()) as { messages?: Mail[] };
  return (j.messages ?? []).filter((m) => m.To.some((t) => t.Address.toLowerCase() === addr));
}
const seen = new Set<string>();   // every message id this run has looked at, so the reset wait never takes the verification mail

/** Waits (at most WAIT_MS) for a new mail to `addr`; a mail from the wrong sender or with the wrong subject fails at once. */
async function waitForMail(addr: string, what: string, subject: string): Promise<Mail> {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const fresh = (await mailsTo(addr)).find((m) => !seen.has(m.ID));
    if (fresh) {
      seen.add(fresh.ID);
      if (fresh.From.Address !== EXPECT.sender || fresh.Subject !== subject) {
        throw new Fail(`the ${what} email is not the expected one: sender ${JSON.stringify(fresh.From.Address)} (expected ${JSON.stringify(EXPECT.sender)}), subject ${JSON.stringify(fresh.Subject)} (expected ${JSON.stringify(subject)})`);
      }
      return fresh;
    }
    if (Date.now() >= until) throw new Fail(`no ${what} email for the synthetic address arrived in the mail catcher within ${WAIT_MS / 1000} s`);
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
}

/** The link of a mail: the first Auth verify link in its text, which must point at the local stack (it is followed, so it is checked first). */
async function linkOf(mail: Mail, what: string): Promise<string> {
  const r = await call(`${MAIL}/api/v1/message/${encodeURIComponent(mail.ID)}`);
  if (r.status !== 200) throw new Fail(`reading the ${what} email answered ${r.status}`);
  const j = (await r.json()) as { Text?: string; HTML?: string };
  const m = /https?:\/\/[^\s"'<>)]+\/auth\/v1\/verify\?[^\s"'<>)]+/.exec(`${j.Text ?? ''}\n${j.HTML ?? ''}`);
  if (!m) throw new Fail(`the ${what} email holds no verification link`);
  const link = m[0].replace(/&amp;/g, '&');
  if (!hostIsLocal(link)) throw new Fail(`refusing to follow the ${what} email's link: it does not point at the local stack`);   // a mail link may carry a query string; only its host is checked
  return link;
}

/** Follows a verify link one hop (no redirect is followed further, so nothing outside the stack is reached) and returns the access token in the redirect target. */
async function follow(link: string, what: string): Promise<string> {
  const r = await call(link);
  const loc = r.headers.get('location') ?? '';
  if (r.status < 300 || r.status >= 400 || !loc) throw new Fail(`the ${what} link answered ${r.status} with no redirect`);
  const target = new URL(loc, link);
  const params = new URLSearchParams(target.hash.replace(/^#/, '') || target.search);
  const err = params.get('error_description') ?? params.get('error');
  const token = params.get('access_token');
  if (err || !token) throw new Fail(`the ${what} link did not sign the user in: ${err ?? 'no access token in the redirect'}`);
  return token;
}

const generatedPassword = (): string => `Ec-${randomBytes(18).toString('base64url')}-9z`;   // generated at run time, never printed, never stored

async function run(): Promise<void> {
  const info = await call(`${MAIL}/api/v1/info`);
  const version = info.status === 200 ? ((await info.json()) as { Version?: string }).Version ?? 'unknown' : 'unknown';
  console.log(`email-check (LOCAL stack, synthetic @example.test addresses, nothing leaves this machine) mail catcher: Mailpit ${version}, HTTP API v1 (/api/v1)`);

  sql(`-- q:setup\ninsert into ops.invitations (email, note) values (:'a1', 'email-check synthetic');`, { a1: INVITED });
  const password = generatedPassword();

  // 1. sign-up verification
  let r = await post('/auth/v1/signup', { email: INVITED, password });
  if (r.status !== 200) throw new Fail(`sign-up of the invited address answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const verifyMail = await waitForMail(INVITED, 'verification', EXPECT.verifySubject);
  await follow(await linkOf(verifyMail, 'verification'), 'verification');
  const confirmed = sql(`-- q:confirmed\nselect (email_confirmed_at is not null)::text from auth.users where email = :'a1';`, { a1: INVITED });
  if (confirmed !== 'true' && confirmed !== 't') throw new Fail('the verification link was followed but the account is not confirmed');
  console.log(`PASS verification: sign-up mail from ${EXPECT.sender} ("${EXPECT.verifySubject}") found in the mail catcher, its link followed, account confirmed`);

  // 2. password reset
  r = await post('/auth/v1/recover', { email: INVITED });
  if (r.status !== 200) throw new Fail(`password reset request answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const resetMail = await waitForMail(INVITED, 'password reset', EXPECT.resetSubject);
  const token = await follow(await linkOf(resetMail, 'password reset'), 'password reset');
  const fresh = generatedPassword();
  r = await call(`${API}/auth/v1/user`, { method: 'PUT', headers: authHeaders(token), body: JSON.stringify({ password: fresh }) });
  if (r.status !== 200) throw new Fail(`setting the new password answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  r = await post('/auth/v1/token?grant_type=password', { email: INVITED, password: fresh });
  if (r.status !== 200 || !((await r.json()) as { access_token?: string }).access_token) throw new Fail(`signing in with the new password answered ${r.status}`);
  console.log(`PASS reset: reset mail from ${EXPECT.sender} ("${EXPECT.resetSubject}") found, its link followed, a new generated password set, sign-in with it succeeded`);

  // 3. an uninvited address is refused with the FR-8 message and gets no email
  r = await post('/auth/v1/signup', { email: UNINVITED, password: generatedPassword() });
  const body = await r.text();
  if (r.status < 400 || !body.includes(EXPECT.refusal)) throw new Fail(`the uninvited address was not refused with the FR-8 message (status ${r.status}): ${body.slice(0, 200)}`);
  await new Promise((res) => setTimeout(res, Math.min(3000, WAIT_MS)));   // a bounded pause: a mail that would be sent has arrived by now (the invited ones took well under a second)
  const stray = await mailsTo(UNINVITED);
  for (const m of stray) seen.add(m.ID);
  const row = sql(`-- q:uninvited\nselect count(*) from auth.users where email = :'a2';`, { a2: UNINVITED });
  if (stray.length > 0 || row !== '0') throw new Fail(`the uninvited address left something behind: ${stray.length} mail(s), ${row} user row(s)`);
  console.log(`PASS uninvited: sign-up of an address not on the invitation list refused with the FR-8 message (status ${r.status}), no email caught, no user created`);
  console.log(NOT_COVERED);
}

/** Removes the users, the invitations and every caught message to the run's addresses. Returns the problems it met (empty when clean). */
async function cleanup(): Promise<string[]> {
  const problems: string[] = [];
  try { sql(CLEANUP_SQL, { a1: INVITED, a2: UNINVITED }); } catch (e) { problems.push((e as Error).message); }
  try {
    const ids = new Set<string>();
    for (const a of ADDRESSES) for (const m of await mailsTo(a)) ids.add(m.ID);
    for (const id of seen) ids.add(id);
    if (ids.size > 0) {
      const r = await call(`${MAIL}/api/v1/messages`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IDs: [...ids] }) });
      if (r.status !== 200) problems.push(`deleting the caught messages answered ${r.status}`);
    }
  } catch (e) { problems.push((e as Error).message); }
  return problems;
}

async function main(): Promise<number> {
  if (mode === '--snapshot') { console.log(sql(SNAPSHOT_SQL)); return 0; }
  if (mode === '--audit-note') {
    // Auth's audit log (auth.audit_log_entries) keeps rows that name the addresses; they are NOT deleted on purpose (it is Auth's own record); the run only says how many remain
    const n = sql(`-- q:audit\nselect count(*) from auth.audit_log_entries where payload::text like '%' || :'a1' || '%' or payload::text like '%' || :'a2' || '%';`, { a1: INVITED, a2: UNINVITED });
    console.log(`NOTE: Auth's audit log keeps ${n} rows for the synthetic addresses (not deleted on purpose)`);
    return 0;
  }
  if (mode === '--cleanup') {
    const p = await cleanup();
    p.forEach((m) => console.error(`email-check: clean-up problem: ${m}`));
    return p.length ? 1 : 0;
  }
  let code = 0;
  try { await run(); }
  catch (e) {
    console.error(`email-check: FAIL: ${e instanceof Fail ? e.message : (e as Error).stack ?? String(e)}`);
    code = 1;
  } finally {
    const p = await cleanup();
    p.forEach((m) => console.error(`email-check: clean-up problem: ${m}`));
    if (p.length) code = 1;
  }
  return code;
}
process.exitCode = await main();
