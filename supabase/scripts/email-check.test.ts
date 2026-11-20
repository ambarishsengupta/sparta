// WO-0166 (R8b): the email-delivery check refuses non-local targets, fails loudly when a mail is missing, late or wrong, and always cleans up (re-check finding A).
// PURE: every run below uses stub `supabase` and `psql` commands first on PATH (they log what they were asked and print canned answers) or a non-local URL that is refused before any command is
// called. The "mail catcher" and "Auth service" are a small HTTP server started inside this test on 127.0.0.1 with a random port; it holds a few canned messages in memory. No container is started,
// no real database or mail catcher is contacted, no mail is sent, no row is written. The live run is only the completion-condition command of WO-0166 (`bash supabase/scripts/email-check.sh`).
// Collected through workflow/gates/db_tests.test.ts (vitest.config.ts does not include supabase/).
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = process.env.SEED_SCRIPT ?? 'supabase/scripts/email-check.sh';   // the override is for the mutation proof only
const script = readFileSync(SCRIPT, 'utf8');
const checker = readFileSync('supabase/scripts/email-check.ts', 'utf8');
const BAD = ['postgresql://postgres:x@db.example.test:5432/postgres', 'postgresql://postgres:x@127.0.0.1:54322/postgres?host=db.example.test', 'postgresql://postgres@evil.test@127.0.0.1/postgres',
  'postgresql://postgres:x@127.0.0.1.evil.test:5432/postgres', 'postgresql://postgres:x@10.0.0.5/postgres', 'postgresql://postgres:x@localhost.evil.test/postgres', 'https://127.0.0.1/postgres',
  'host=db.evil.test dbname=postgres application_name=\npostgresql://u@127.0.0.1/postgres', 'postgresql://postgres:x@127.0.0.1:54322/postgres\n', 'postgresql://postgres:x@127.0.0.1:54322/postgres\r', 'postgresql://postgres:x@127.0.0.1:54322/postgres\nhost=db.evil.test'];
const FR8 = 'Sparta is invitation-only during the pilot.';
const SNAP = 'invitations=0 users=0 signups_day=2026-01-01 signups_n=-';

// ---- the stand-in for the mail catcher and the Auth service ----
interface Mail { ID: string; Subject: string; From: { Address: string }; To: { Address: string }[]; Text: string }
type Mode = 'happy' | 'no-verification-mail' | 'no-reset-mail' | 'wrong-subject' | 'wrong-sender' | 'uninvited-accepted' | 'uninvited-mailed' | 'foreign-link';
let server: Server;
let port = 0;
let mode: Mode = 'happy';
let mails: Mail[] = [];
let deleted: string[] = [];
let hits: string[] = [];
let n = 0;

function push(to: string, subject: string, type: string, from = 'admin@email.com'): void {
  n += 1;
  const host = mode === 'foreign-link' ? `[::ffff:127.0.0.1]:${port}` : `127.0.0.1:${port}`;   // the foreign host is not on the local list, yet it would reach this very server if the link were followed
  mails.push({ ID: `m${n}`, Subject: subject, From: { Address: from }, To: [{ Address: to }], Text: `Follow this link: http://${host}/auth/v1/verify?token=t${n}&type=${type}&redirect_to=http://127.0.0.1:3000` });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      hits.push(`${req.method} ${url.pathname}`);
      const send = (status: number, json: unknown, headers: Record<string, string> = {}): void => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(json)); };
      const email = body ? ((JSON.parse(body) as { email?: string }).email ?? '') : '';
      if (url.pathname === '/api/v1/info') return send(200, { Version: 'v1.0.0-stub' });
      if (url.pathname === '/api/v1/search') {
        const addr = /to:"([^"]+)"/.exec(url.searchParams.get('query') ?? '')?.[1] ?? '';
        return send(200, { messages: mails.filter((m) => m.To.some((t) => t.Address === addr)) });
      }
      if (url.pathname.startsWith('/api/v1/message/')) return send(200, mails.find((m) => m.ID === url.pathname.split('/').pop()) ?? {});
      if (url.pathname === '/api/v1/messages' && req.method === 'DELETE') { const ids = (JSON.parse(body) as { IDs: string[] }).IDs; deleted.push(...ids); mails = mails.filter((m) => !ids.includes(m.ID)); return send(200, 'ok'); }
      if (url.pathname === '/auth/v1/signup') {
        if (email.includes('-uninvited@')) {
          if (mode === 'uninvited-accepted') return send(200, {});
          if (mode === 'uninvited-mailed') push(email, 'Confirm your email address', 'signup');
          return send(403, { code: 403, msg: FR8, message: FR8 });
        }
        if (mode !== 'no-verification-mail') push(email, mode === 'wrong-subject' ? 'Welcome aboard' : 'Confirm your email address', 'signup', mode === 'wrong-sender' ? 'someone@example.test' : 'admin@email.com');
        return send(200, {});
      }
      if (url.pathname === '/auth/v1/recover') { if (mode !== 'no-reset-mail') push(email, 'Reset your password', 'recovery'); return send(200, {}); }
      if (url.pathname === '/auth/v1/verify') return send(303, {}, { location: 'http://127.0.0.1:3000/#access_token=stub-token&token_type=bearer' });
      if (url.pathname === '/auth/v1/user') return send(200, {});
      if (url.pathname === '/auth/v1/token') return send(200, { access_token: 'stub-token' });
      return send(404, {});
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  port = (server.address() as AddressInfo).port;
});
const dirs: string[] = [];
afterAll(async () => { await new Promise((ok) => server.close(ok)); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

interface Opts { args?: string[]; mail?: string; api?: string; noMail?: boolean; after?: string; confirmed?: string; env?: Record<string, string>; mode?: Mode }
interface Result { code: number | null; out: string; err: string; supabase: string[]; sql: string[]; envLog: string }

/** Runs the script with stub `supabase` and `psql` in front on PATH; the status the stub prints points at the in-process server unless `mail` or `api` say otherwise. Async: the server answers while it runs. */
async function stubRun(o: Opts = {}): Promise<Result> {
  mode = o.mode ?? 'happy'; mails = []; deleted = []; hits = []; n = 0;
  const dir = mkdtempSync(join(tmpdir(), 'emailcheck-'));
  dirs.push(dir);
  const sbLog = join(dir, 'supabase.log');
  const sqlLog = join(dir, 'sql.log');
  const local = `http://127.0.0.1:${port}`;
  const mailJson = o.noMail ? '' : `"MAILPIT_URL":"${o.mail ?? local}",`;
  writeFileSync(join(dir, 'supabase'), `#!/bin/sh\necho "$*" >> "${sbLog}"\necho 'Stopped services: [none]' >&2\necho '{"API_URL":"${o.api ?? local}",${mailJson}"PUBLISHABLE_KEY":"stub-publishable","SECRET_KEY":"stub-secret-never-use","DB_URL":"postgresql://postgres:postgres@127.0.0.1:54322/postgres"}'\n`);
  writeFileSync(join(dir, 'psql'), `#!/bin/sh
[ "$1" = "--version" ] && { echo "psql (stub)"; exit 0; }
in=$(cat)
tag=$(printf '%s\\n' "$in" | sed -n 's/^-- q:\\(.*\\)$/\\1/p' | head -n 1)
echo "$tag" >> "${sqlLog}"
echo "PGHOST=\${PGHOST-unset} PGSERVICE=\${PGSERVICE-unset}" >> "${sqlLog}.env"
case "$tag" in
  snapshot) if [ "$(grep -c '^snapshot' "${sqlLog}")" -ge 2 ] && [ -n "$EC_AFTER" ]; then echo "$EC_AFTER"; else echo "${SNAP}"; fi;;
  confirmed) echo "$EC_CONFIRMED";;
  uninvited) echo 0;;
  audit) echo 7;;
esac
exit 0
`);
  chmodSync(join(dir, 'supabase'), 0o755);
  chmodSync(join(dir, 'psql'), 0o755);
  const read = (f: string): string[] => { try { return readFileSync(f, 'utf8').trim().split('\n'); } catch { return []; } };
  return new Promise((ok) => {
    const p = spawn('bash', [SCRIPT, ...(o.args ?? [])], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, EC_AFTER: o.after ?? '', EC_CONFIRMED: o.confirmed ?? 't', EMAIL_CHECK_WAIT_SECONDS: '2', PGHOST: 'db.evil.test', PGSERVICE: 'evil', ...o.env },
    });
    let out = ''; let err = '';
    p.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    p.stderr.on('data', (c: Buffer) => { err += c.toString(); });
    p.on('close', (code) => ok({ code, out, err, supabase: read(sbLog), sql: read(sqlLog), envLog: read(`${sqlLog}.env`).join('\n') }));
  });
}

describe('supabase/scripts/email-check.sh (stub commands and an in-process stand-in server, nothing real contacted)', () => {
  it.each(BAD)('refuses the database URL %j (exit 2, before any command is called)', async (url) => {
    const r = await stubRun({ args: [url] });
    expect([r.code, r.err.includes('refusing to run'), r.supabase, r.sql]).toEqual([2, true, [], []]);
  }, 30_000);

  it('refuses a mail catcher or API URL from `supabase status` that is not local, or a status without one, before the check starts (no psql, no HTTP call)', async () => {
    for (const o of [{ mail: 'http://mail.example.test:54324' }, { mail: 'http://127.0.0.1.evil.test:54324' }, { mail: 'https://127.0.0.1:54324' }, { api: 'http://api.example.test:54321' }, { noMail: true }]) {
      const r = await stubRun(o);
      expect([r.code, r.err.includes('refusing to run'), r.sql, hits]).toEqual([2, true, [], []]);
    }
  }, 60_000);

  it('on success: three PASS lines, the NOT COVERED line, the API version, a snapshot before and after, the clean-up, and exit 0', async () => {
    const r = await stubRun();
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/PASS verification:/);
    expect(r.out).toMatch(/PASS reset:/);
    expect(r.out).toMatch(/PASS uninvited:.*FR-8/);
    expect(r.out).toContain('NOT COVERED: export email (not built; LLD 6 export-ready email needs the provider, QC 11b)');
    expect(r.out).toContain('HTTP API v1 (/api/v1)');
    expect(r.out).toContain("NOTE: Auth's audit log keeps 7 rows for the synthetic addresses (not deleted on purpose)");
    expect(r.out.indexOf('EQUAL')).toBeLessThan(r.out.indexOf('NOTE:'));   // the note is information after the equality check, never part of it
    expect(r.out).toContain('invitations, users and the sign-up counter are EQUAL');
    expect(r.sql).toEqual(['snapshot', 'setup', 'confirmed', 'uninvited', 'cleanup', 'cleanup', 'snapshot', 'audit']);   // the in-program finally and the shell trap both clean up; the second finds nothing
    expect(deleted.sort()).toEqual(['m1', 'm2']);   // the two mails to the invited address, and only those
    expect(hits.every((h) => /^(?:GET|POST|PUT|DELETE) \/(?:api|auth)\/v1\//.test(h))).toBe(true);
  }, 60_000);

  it('libpq environment variables never reach psql, and the secret key from the status is never used', async () => {
    const r = await stubRun();
    expect(r.code).toBe(0);
    expect(r.envLog.split('\n').every((l) => l === 'PGHOST=unset PGSERVICE=unset')).toBe(true);
    expect(r.out + r.err).not.toContain('stub-secret');
  }, 60_000);

  it('FAILS (exit 1) when the verification email never arrives within the wait, says so, and still cleans up', async () => {
    const r = await stubRun({ mode: 'no-verification-mail' });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/no verification email .* within 2 s/);
    expect(r.out).not.toMatch(/PASS/);
    expect(r.sql.slice(-4)).toEqual(['cleanup', 'cleanup', 'snapshot', 'audit']);
  }, 60_000);

  it('FAILS when the reset email never arrives (the verification still passed), and still cleans up', async () => {
    const r = await stubRun({ mode: 'no-reset-mail' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/PASS verification/);
    expect(r.out).not.toMatch(/PASS reset/);
    expect(r.err).toMatch(/no password reset email .* within 2 s/);
    expect(r.sql.slice(-4)).toEqual(['cleanup', 'cleanup', 'snapshot', 'audit']);
  }, 60_000);

  it.each<[Mode, RegExp]>([
    ['wrong-subject', /subject "Welcome aboard" \(expected "Confirm your email address"\)/],
    ['wrong-sender', /sender "someone@example.test" \(expected "admin@email.com"\)/],
  ])('FAILS when the email has the wrong sender or subject (%s)', async (m, msg) => {
    const r = await stubRun({ mode: m });
    expect([r.code, msg.test(r.err), /PASS/.test(r.out)]).toEqual([1, true, false]);
  }, 60_000);


  it('refuses to follow a mail link that does not point at the local stack: exit 1, "refusing to follow", no request to that link, no PASS verification, clean-up done', async () => {
    const r = await stubRun({ mode: 'foreign-link' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('refusing to follow the verification email');
    expect(hits).not.toContain('GET /auth/v1/verify');
    expect(r.out).not.toContain('PASS verification');
    expect(r.sql.slice(-4)).toEqual(['cleanup', 'cleanup', 'snapshot', 'audit']);
  }, 60_000);

  it('FAILS when the link was followed but the database says the account is not confirmed (no PASS verification)', async () => {
    const r = await stubRun({ confirmed: 'f' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('the account is not confirmed');
    expect(r.out).not.toContain('PASS verification');
  }, 60_000);

  it('FAILS when an uninvited address is not refused, or is refused but still gets an email', async () => {
    const accepted = await stubRun({ mode: 'uninvited-accepted' });
    expect([accepted.code, accepted.err.includes('not refused with the FR-8 message'), /PASS uninvited/.test(accepted.out)]).toEqual([1, true, false]);
    const mailed = await stubRun({ mode: 'uninvited-mailed' });
    expect([mailed.code, mailed.err.includes('left something behind'), /PASS uninvited/.test(mailed.out)]).toEqual([1, true, false]);
  }, 90_000);

  it('FAILS when the database is not as it was found (the after snapshot differs), and says so', async () => {
    const r = await stubRun({ after: SNAP.replace('users=0', 'users=1') });
    expect([r.code, r.err.includes('NOT left as found')]).toEqual([1, true]);
  }, 60_000);

  it.each(['0', '31', 'x', '-5', '1e1'])('refuses a wait of %j seconds (the wait is 1 to 30), before any invitation is written', async (v) => {
    const r = await stubRun({ env: { EMAIL_CHECK_WAIT_SECONDS: v } });
    expect(r.code).not.toBe(0);
    expect(r.sql).not.toContain('setup');
    expect(r.out).not.toContain('PASS');
  }, 60_000);
});

describe('email-check.ts on its own: configured URLs (stub psql, no server)', () => {
  const base = { EMAIL_CHECK_API_URL: 'http://127.0.0.1:1', EMAIL_CHECK_MAILPIT_URL: 'http://127.0.0.1:1', EMAIL_CHECK_PUBLISHABLE_KEY: 'stub-publishable', EMAIL_CHECK_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', EMAIL_CHECK_RUN_ID: 'abcdef012345' };
  const dir = mkdtempSync(join(tmpdir(), 'emailcheck-ts-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'psql'), `#!/bin/sh\necho called >> "${dir}/psql.log"\necho ok\n`);
  chmodSync(join(dir, 'psql'), 0o755);
  const runTs = (extra: Record<string, string>) => spawnSync('node_modules/.bin/tsx', ['supabase/scripts/email-check.ts', '--snapshot'], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...base, ...extra } });

  it.each([
    ['EMAIL_CHECK_DB_URL', 'postgresql://postgres:x@127.0.0.1:54322/postgres?host=db.example.test'],
    ['EMAIL_CHECK_DB_URL', 'postgresql://postgres:x@127.0.0.1:54322/postgres?hostaddr=10.0.0.5'],
    ['EMAIL_CHECK_DB_URL', 'postgresql://postgres:x@127.0.0.1:54322/postgres#frag'],
    ['EMAIL_CHECK_API_URL', 'http://127.0.0.1:54321?x=1'],
    ['EMAIL_CHECK_MAILPIT_URL', 'http://127.0.0.1:54324/#x'],
    ['EMAIL_CHECK_MAILPIT_URL', 'http://mail.example.test:54324'],
  ])('refuses %s=%j (exit 2) before touching the database', (name, value) => {
    const r = runTs({ [name]: value });
    expect([r.status, r.stderr.includes('refusing to run')]).toEqual([2, true]);
    expect(existsSync(join(dir, 'psql.log'))).toBe(false);
  }, 30_000);

  it('accepts the same URLs without a query string (so the refusals above are about the query string)', () => {
    const r = runTs({});
    expect([r.status, r.stdout.trim()]).toEqual([0, 'ok']);
  }, 30_000);
});

describe('the check script and its program, read as text', () => {
  it('names only the local stack: no linked project, no push, no hosted host, never the secret key, and a trap on exit', () => {
    const code = (s: string): string => s.split('\n').filter((l) => !l.trim().startsWith('#') && !l.trim().startsWith('//')).join('\n');   // the headers say what the files never do
    expect(code(script)).not.toMatch(/--linked|db push|--db-url|supabase\.co|SECRET_KEY|sb_secret|service_role/i);
    expect(code(checker)).not.toMatch(/--linked|supabase\.co|SECRET_KEY|sb_secret|service_role/i);
    expect(script).toMatch(/trap cleanup EXIT/);
    expect(script).toMatch(/trap 'status=1; exit 1' INT TERM/);
    expect(script).toContain('[[ "$1" == *$\'\\n\'* || "$1" == *$\'\\r\'* ]]');
    expect(script).toContain('refusing to run');
    expect(script).not.toMatch(/echo[^\n]*\$\{?(key|db_url)\b/);   // the key and the database URL are never printed
  });

  it('uses example.test addresses only, a 30-second ceiling on every call and wait, and a finally that cleans up', () => {
    expect([...checker.matchAll(/@[a-z]+\.[a-z]+/g)].every((m) => ['@example.test', '@email.com'].includes(m[0]))).toBe(true);
    expect(checker).toContain('AbortSignal.timeout(STEP_MS)');
    expect(checker).toContain('const STEP_MS = 30_000');
    expect(checker).toMatch(/Number\(waitRaw\) > 30/);
    expect(checker).toMatch(/finally \{\s*const p = await cleanup\(\)/);
    expect(checker).toContain('NOT COVERED: export email (not built; LLD 6 export-ready email needs the provider, QC 11b)');
  });

  it('has no hard-coded host: a URL in the program can only be built from one it was given', () => {
    const code = checker.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/https?:\/\/(?!\$\{)/);
  });
});
