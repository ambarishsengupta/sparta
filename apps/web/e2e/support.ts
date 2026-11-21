import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertLocalStack, belongsToRun, isLocalUrl, runPattern, syntheticAddress, syntheticPassword } from '../test-support/e2e-local';

/** Everything the end-to-end tests need from the LOCAL stack (WO-0168): the run's settings, the database, the mail catcher and synthetic users.
 * The settings are put in the environment by playwright.config.ts; every use checks them again (assertLocalStack), so a worker cannot be pointed elsewhere. */
export interface E2eStack { api: string; key: string; mail: string; db: string; run: string }

export function stack(): E2eStack {
  const urls = assertLocalStack({ supabaseUrl: process.env.SPARTA_E2E_API_URL, mailUrl: process.env.SPARTA_E2E_MAIL_URL, dbUrl: process.env.SPARTA_E2E_DB_URL });
  const key = process.env.SPARTA_E2E_KEY;
  const run = process.env.SPARTA_E2E_RUN;
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

/** The app tables that hold rows of one user (every one with a user_id, plus the profile). The data-rights tests count them before and after a deletion. All of them cascade from auth.users. */
const USER_TABLES = ['collections', 'consent_records', 'document_acceptances', 'item_collections', 'item_features', 'item_tags', 'items', 'jobs', 'outfit_items', 'outfit_logs', 'outfit_plans',
  'outfits', 'purchase_receipts', 'purchases', 'receipts', 'suggestion_feedback', 'tags', 'wishlist_entries'] as const;
/** The user id of an address, or '' when there is no such account. */
export const userIdOf = (email: string): string => sql(`select id from auth.users where email = :'e'`, { e: email });
/** Rows of the user's id in every app table (the profile included) and storage objects in the user's folder of every bucket. */
export const rowsOfUser = (id: string): { app: number; storage: number } => ({
  app: Number(sql(`select ${USER_TABLES.map((t) => `(select count(*) from app.${t} where user_id = :'u'::uuid)`).join(' + ')} + (select count(*) from app.profiles where id = :'u'::uuid)`, { u: id })),
  storage: Number(sql(`select count(*) from storage.objects where name like :'u' || '/%'`, { u: id })),
});
/** Names of the items the address owns, oldest first. */
export const itemNamesOf = (email: string): string[] =>
  sql(`select i.name from app.items i join auth.users u on u.id = i.user_id where u.email = :'e' order by i.created_at, i.name`, { e: email }).split('\n').filter((l) => l !== '');
export const countInvitationsOf = (email: string): number => Number(sql(`select count(*) from ops.invitations where email = :'e'`, { e: email }));

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
  private readonly undo: (() => void)[] = [];
  /** The sign-up and deletion day counters (ops.daily_counts) as they were before this test made its first user. Deleting an account through the app adds to them, and a user the app has
   * already deleted can no longer be taken off them by removeUsers, so remove() puts them back exactly. They hold no user id. */
  private counters: string | null = null;

  /** Something a test set up that is not a user (the demo catalogue, for example): `undo` runs in remove(), after a failed test too. */
  onRemove(undo: () => void): void { this.undo.push(undo); }

  /** A new address and a generated password. Nothing exists yet (no invitation, no account). */
  create(label: string): SyntheticUser {
    this.counters ??= sql(`select coalesce(json_agg(json_build_object('day', day, 'metric', metric, 'n', n)), '[]'::json) from ops.daily_counts`);
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

  /** Puts one small file in the user's own folder of the item-images bucket, the way the app's own storage rules allow (the signed-in user, their own folder), so a deletion test can prove the file goes too.
   * The worker is not needed for this. The user's token is used here and never kept or shown. Returns the object's name. */
  async storeFile(user: SyntheticUser): Promise<string> {
    const { api, key } = stack();
    const login = await call(`${api}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify(user) });
    if (login.status !== 200) throw new Error(`signing in the synthetic user through the Auth API answered ${login.status}`);
    const { access_token: token, user: who } = (await login.json()) as { access_token: string; user: { id: string } };
    const name = `${who.id}/e2e-stored-file.png`;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const up = await call(`${api}/storage/v1/object/item-images/${name}`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: png });
    if (up.status !== 200) throw new Error(`storing a file in the synthetic user's folder answered ${up.status}`);
    return name;
  }

  /** Removes this test's users, invitations and caught mail. Throws if anything is left, so a leak fails the run. */
  async remove(): Promise<void> {
    const mine = new Set(this.emails);
    const problems: string[] = [];
    for (const undo of this.undo.splice(0).reverse()) {
      try { undo(); } catch (e) { problems.push(`undoing a setup step: ${(e as Error).message.split('\n')[0] ?? ''}`); }
    }
    const ids = new Map<string, string>(); // the user ids first: a user's rows and files are counted again after the deletion
    for (const email of this.emails) { try { ids.set(email, userIdOf(email)); } catch { /* counted as a problem below if the user is still there */ } }
    for (const id of ids.values()) { // files the deletion under test did not remove (a failed test)
      try { await removeStoredFiles(id); } catch (e) { problems.push(`removing stored files: ${(e as Error).message.split('\n')[0] ?? ''}`); }
    }
    for (const email of this.emails) {
      try { removeUsers(email); } catch (e) { problems.push(`removing ${email}: ${(e as Error).message.split('\n')[0] ?? ''}`); }
    }
    try { await removeMails((a) => mine.has(a)); } catch (e) { problems.push(`removing mail: ${(e as Error).message}`); }
    for (const email of this.emails) if (countUsers(email) + countInvitations(email) !== 0) problems.push(`${email} is still there`);
    for (const id of ids.values()) {
      if (id === '') continue;
      const left = rowsOfUser(id);
      if (left.app + left.storage !== 0) problems.push(`a synthetic user's rows or files are still there (app ${left.app}, storage ${left.storage})`);
    }
    if (this.counters !== null) {
      try {
        sql(`begin;
create temp table was on commit drop as select (r->>'day')::date as day, r->>'metric' as metric, (r->>'n')::int as n from jsonb_array_elements(:'j'::jsonb) r;
update ops.daily_counts t set n = w.n from was w where t.day = w.day and t.metric = w.metric and t.n <> w.n;
insert into ops.daily_counts (day, metric, n) select day, metric, n from was on conflict do nothing;
delete from ops.daily_counts t where not exists (select 1 from was w where w.day = t.day and w.metric = t.metric);
commit;`, { j: this.counters });
      } catch (e) { problems.push(`restoring the day counters: ${(e as Error).message.split('\n')[0] ?? ''}`); }
      this.counters = null;
    }
    this.emails.length = 0;
    if (problems.length > 0) throw new Error(problems.join('; '));
  }
}

/** The local stack's server-only key, read from `supabase status` when a teardown needs it (never printed, kept in memory only). Null when it cannot be read. */
function localServerKey(): string | null {
  try {
    const out = execFileSync('supabase', ['status', '-o', 'json'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }).toString();
    const s = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as Record<string, string | undefined>;
    return s.SECRET_KEY ?? null;
  } catch { return null; }
}

/** Removes the objects in one user's folder after a test that failed before the app's own Leave flow removed them: through the Storage API (bytes and rows), and, if that is not possible,
 * the rows only (the database refuses a plain delete of storage rows, so that statement sets the documented switch for itself). Only ever runs against the local stack (sql() refuses otherwise). */
async function removeStoredFiles(id: string): Promise<void> {
  if (id === '' || rowsOfUser(id).storage === 0) return;
  const key = localServerKey();
  if (key) {
    for (const name of sql(`select name from storage.objects where name like :'u' || '/%'`, { u: id }).split('\n').filter((n) => n !== '')) {
      await call(`${stack().api}/storage/v1/object/item-images/${name}`, { method: 'DELETE', headers: { apikey: key, authorization: `Bearer ${key}` } });
    }
  }
  if (rowsOfUser(id).storage > 0) sql(`begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where name like :'u' || '/%'; commit;`, { u: id });
}

/** Loads the synthetic demo catalogue (supabase/scripts/seed-demo-catalog.sh, local database only) when the local stack has none, and returns the step that takes it out again.
 * A catalogue that was already there is left alone, and so is its removal. The script refuses any database that is not on this machine. */
export function ensureDemoCatalogue(): () => void {
  stack(); // refuses unless the stack is local
  const script = join(import.meta.dirname, '../../../supabase/scripts/seed-demo-catalog.sh');
  const present = (): number => Number(sql(`select count(*) from catalog.sources where name = 'demo' and site_url = 'http://127.0.0.1/'`));
  if (present() > 0) return () => undefined;
  execFileSync('bash', [script], { timeout: 90_000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (Number(sql(`select count(*) from catalog.catalog_items i join catalog.sources s on s.id = i.source_id where s.name = 'demo'`)) !== 40) throw new Error('the demo catalogue did not load 40 items');
  return () => { execFileSync('bash', [script, '--remove'], { timeout: 90_000, stdio: ['ignore', 'pipe', 'pipe'] }); };
}

/** Whatever any test of this run left behind (a crashed worker, an interrupted run): the end-of-run sweep. */
export async function sweepRun(): Promise<void> {
  const like = runPattern(stack().run);
  removeUsers(like);
  await removeMails(belongsToRun(stack().run));
  if (countUsers(like) + countInvitations(like) !== 0) throw new Error('synthetic users of this run are still in the local database after the sweep');
}
