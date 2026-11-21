import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertLocalStack, belongsToRun, env, isLocalUrl, runPattern, syntheticAddress, syntheticPassword } from '../test-support/e2e-local';

/** Everything the end-to-end tests need from the LOCAL stack (WO-0168): the run's settings, the database, the mail catcher and synthetic users.
 * The settings are put in the environment by playwright.config.ts; every use checks them again (assertLocalStack), so a worker cannot be pointed elsewhere. */
export interface E2eStack { api: string; key: string; mail: string; db: string; run: string }

export function stack(): E2eStack {
  const urls = assertLocalStack({ supabaseUrl: env.SPARTA_E2E_API_URL, mailUrl: env.SPARTA_E2E_MAIL_URL, dbUrl: env.SPARTA_E2E_DB_URL });
  const key = env.SPARTA_E2E_KEY;
  const run = env.SPARTA_E2E_RUN;
  if (!key || !run) throw new Error('end-to-end tests refuse to run: start them through playwright.config.ts (npx playwright test -c apps/web/playwright.config.ts).');
  return { api: urls.supabaseUrl.replace(/\/+$/, ''), key, mail: urls.mailUrl.replace(/\/+$/, ''), db: urls.dbUrl, run };
}

// ---- database: as postgres, inside the local stack's database container (there is no psql on every machine); test values go in as psql variables, never into the text ----
const projectId = (): string => /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(join(import.meta.dirname, '../../../supabase/config.toml'), 'utf8'))?.[1] ?? 'sparta';
export function sql(text: string, vars: Record<string, string> = {}): string {
  stack(); // refuses unless the stack is local
  const args = Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]);
  return execFileSync('docker', ['exec', '-i', `supabase_db_${projectId()}`, 'psql', '-U', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-tA', ...args, '-f', '-'],
    { input: text, timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
}

/** Removes every user, invitation and sign-up count that belongs to addresses matching the LIKE pattern. Safe to run twice. */
export function removeUsers(like: string): void {
  sql(`begin;
create temp table gone on commit drop as select id, created_at::date as d from auth.users where email like :'p';
delete from auth.users where id in (select id from gone);
update ops.daily_counts t set n = greatest(t.n - g.c, 0) from (select d, count(*) as c from gone group by d) g where t.day = g.d and t.metric = 'signups';
delete from ops.daily_counts t where t.metric = 'signups' and t.n = 0 and t.day in (select d from gone);
delete from ops.invitations where email like :'p';
commit;`, { p: like });
}

export const countUsers = (like: string): number => Number(sql(`select count(*) from auth.users where email like :'p'`, { p: like }));
export const countInvitations = (like: string): number => Number(sql(`select count(*) from ops.invitations where email like :'p'`, { p: like }));

// ---- mail catcher, every call with a 30-second ceiling ----
const call = (url: string, init: RequestInit = {}): Promise<Response> => fetch(url, { redirect: 'manual', ...init, signal: AbortSignal.timeout(30_000) });
interface Mail { ID: string; To: { Address: string }[] }

async function mailsMatching(query: string, keep: (address: string) => boolean): Promise<Mail[]> {
  const r = await call(`${stack().mail}/api/v1/search?query=${encodeURIComponent(query)}`);
  if (r.status !== 200) throw new Error(`the mail catcher search answered ${r.status}`);
  const body = (await r.json()) as { messages?: Mail[] };
  return (body.messages ?? []).filter((m) => m.To.some((t) => keep(t.Address.toLowerCase())));
}

/** The first Auth verify link in the newest mail to `address`; waits at most `waitMs`. The link is followed by a browser or a fetch, so it must point at the local stack. */
export async function verifyLink(address: string, waitMs = 20_000): Promise<string> {
  const until = Date.now() + waitMs;
  for (;;) {
    const [mail] = await mailsMatching(`to:"${address}"`, (a) => a === address);
    if (mail) {
      const r = await call(`${stack().mail}/api/v1/message/${encodeURIComponent(mail.ID)}`);
      const j = (await r.json()) as { Text?: string; HTML?: string };
      const m = /https?:\/\/[^\s"'<>)]+\/auth\/v1\/verify\?[^\s"'<>)]+/.exec(`${j.Text ?? ''}\n${j.HTML ?? ''}`);
      if (m) {
        const link = m[0].replace(/&amp;/g, '&');
        if (!isLocalUrl(link.replace(/\?.*$/, ''))) throw new Error('refusing to follow a verification link that does not point at the local stack');
        return link;
      }
    }
    if (Date.now() >= until) throw new Error(`no verification email for the synthetic address arrived within ${waitMs / 1000} s`);
    await new Promise((res) => setTimeout(res, 300));
  }
}

/** Deletes the caught messages sent to addresses that match `keep` (found by the run id, which every synthetic address holds). */
export async function removeMails(keep: (address: string) => boolean): Promise<void> {
  const ids = (await mailsMatching(`e2e-${stack().run}`, keep)).map((m) => m.ID);
  if (ids.length > 0) await call(`${stack().mail}/api/v1/messages`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IDs: ids }) });
}

export interface SyntheticUser { email: string; password: string }

/** Synthetic users of one test. Created here, removed in `remove()`, which the fixture calls whether the test passed or failed. Passwords live in memory only. */
export class Cast {
  private readonly emails: string[] = [];

  /** A new address and a generated password. Nothing exists yet (no invitation, no account). */
  create(label: string): SyntheticUser {
    const email = syntheticAddress(stack().run, label);
    this.emails.push(email);
    return { email, password: syntheticPassword() };
  }

  invite(email: string): void { sql(`insert into ops.invitations (email, note) values (:'e', 'end-to-end synthetic')`, { e: email }); }

  /** Invites the address, signs it up through the Auth API and confirms it with the link from the local mail catcher, so the browser can sign in at once. */
  async provision(label: string): Promise<SyntheticUser> {
    const user = this.create(label);
    this.invite(user.email);
    const { api, key } = stack();
    const r = await call(`${api}/auth/v1/signup`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: user.password }) });
    if (r.status !== 200) throw new Error(`the Auth API refused the invited synthetic address (status ${r.status})`);
    const confirmed = await call(await verifyLink(user.email));
    if (confirmed.status < 300 || confirmed.status >= 400) throw new Error(`following the verification link answered ${confirmed.status}`);
    return user;
  }

  /** Removes this test's users, invitations and caught mail. Throws if anything is left, so a leak fails the run. */
  async remove(): Promise<void> {
    const mine = new Set(this.emails);
    const problems: string[] = [];
    for (const email of this.emails) {
      try { removeUsers(email); } catch (e) { problems.push(`removing ${email}: ${(e as Error).message.split('\n')[0] ?? ''}`); }
    }
    try { await removeMails((a) => mine.has(a)); } catch (e) { problems.push(`removing mail: ${(e as Error).message}`); }
    for (const email of this.emails) if (countUsers(email) + countInvitations(email) !== 0) problems.push(`${email} is still there`);
    this.emails.length = 0;
    if (problems.length > 0) throw new Error(problems.join('; '));
  }
}

/** Whatever any test of this run left behind (a crashed worker, an interrupted run): the end-of-run sweep. */
export async function sweepRun(): Promise<void> {
  const like = runPattern(stack().run);
  removeUsers(like);
  await removeMails(belongsToRun(stack().run));
  if (countUsers(like) + countInvitations(like) !== 0) throw new Error('synthetic users of this run are still in the local database after the sweep');
}
