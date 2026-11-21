// WO-0165 (R8b): the load check refuses non-local databases, always removes what it created, applies its limits and compares before and after (NFR-7; re-check finding A).
// PURE: every run below uses stub `psql` / `docker` commands first on PATH (they log the phase they were asked for and print canned answers) or a non-local URL that is refused before any
// command is called. No container is started, no real database is contacted, no row is written. The live run is only the completion-condition command of WO-0165
// (`bash supabase/scripts/load-check.sh`). Collected through workflow/gates/db_tests.test.ts (vitest.config.ts does not include supabase/).
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = process.env.SEED_SCRIPT ?? 'supabase/scripts/load-check.sh';   // the override is for the mutation proof only
const script = readFileSync(SCRIPT, 'utf8');
const sql = readFileSync('supabase/scripts/load-check.sql', 'utf8');
const BAD = ['postgresql://postgres:x@db.example.test:5432/postgres', 'postgresql://postgres:x@127.0.0.1:54322/postgres?host=db.example.test', 'postgresql://postgres@evil.test@127.0.0.1/postgres',
  'postgresql://postgres:x@127.0.0.1.evil.test:5432/postgres', 'postgresql://postgres:x@10.0.0.5/postgres', 'postgresql://postgres:x@localhost.evil.test/postgres', 'https://127.0.0.1/postgres',
  'host=db.evil.test dbname=postgres application_name=\npostgresql://u@127.0.0.1/postgres', 'postgresql://postgres:x@127.0.0.1:54322/postgres\n', 'postgresql://postgres:x@127.0.0.1:54322/postgres\r', 'postgresql://postgres:x@127.0.0.1:54322/postgres\nhost=db.evil.test'];

const SNAP = 'items=0 profiles=0 users=0 consents=0 acceptances=0 wishlist=0 purchases=0 runs=0 cube_rows=0 cube_md5=d41d8cd98f00b204e9800998ecf8427e leftover=0 signups_day=2026-01-01 signups_n=35 seq_last=1 seq_called=f';
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** Runs the script with a stub psql (and docker) in front on PATH. `fail` makes the named phase exit 3; `env` goes to the stub and the script. */
function stubRun(opts: { busy?: string; fail?: string; ms?: string; after?: string; leftover?: boolean; args?: string[]; env?: Record<string, string> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'loadcheck-'));
  dirs.push(dir);
  const log = join(dir, 'calls.log');
  const body = `#!/bin/sh
phase=""; vars=""
for a in "$@"; do case "$a" in phase=*) phase="\${a#phase=}";; sig_*=*|seq_*=*) vars="$vars $a";; esac; done
cat >/dev/null
echo "$phase$vars" >> "${log}"
echo "PGHOSTADDR=\${PGHOSTADDR-unset} PGSERVICE=\${PGSERVICE-unset} PGHOST=\${PGHOST-unset} PGOPTIONS=\${PGOPTIONS-unset}" >> "${log}.env"
[ "$phase" = "$LC_FAIL" ] && { echo "stub failure in $phase" >&2; exit 3; }
case "$phase" in
  snapshot) n=$(grep -c '^snapshot' "${log}"); if [ "$n" -ge 2 ] && [ -n "$LC_AFTER" ]; then echo "$LC_AFTER"; else echo "$LC_SNAP"; fi;;
  sessions) if [ -n "$LC_BUSY" ] && [ "$(grep -c '^sessions' "${log}")" -le "$LC_BUSY" ]; then echo 1; else echo 0; fi;;
  load) echo "LOAD|12.34|500|50000|5000|15000";;
  measure) printf 'RLS|100\\nSIZE|%s\\nQ|wardrobe_first_page|1.5|%s|50|yes|items_user_status_created\\nQ|wardrobe_filtered|2.5|2.0|7|yes|items_user_category_colour\\nQ|item_count|3.5|3.0|1|yes|items_user_status_created\\n' 31457280 "$LC_MS";;
  aggregate) echo 'AGG|900.5|ok|500|50000|42|-';;
esac
exit 0
`;
  for (const cmd of ['psql', 'docker']) { writeFileSync(join(dir, cmd), body); chmodSync(join(dir, cmd), 0o755); }
  const r = spawnSync('bash', [SCRIPT, ...(opts.args ?? [])], {
    encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, LC_FAIL: opts.fail ?? '', LC_BUSY: opts.busy ?? '', LOAD_CHECK_POLL: '0', LC_MS: opts.ms ?? '2.0', LC_AFTER: opts.after ?? '',
      LC_SNAP: opts.leftover ? SNAP.replace('leftover=0', 'leftover=500') : SNAP, ...opts.env },
  });
  let calls: string[] = [];
  try { calls = readFileSync(log, 'utf8').trim().split('\n'); } catch { /* no command was called */ }
  let envLog = '';
  try { envLog = readFileSync(`${log}.env`, 'utf8'); } catch { /* no command was called */ }
  return { envLog, code: r.status, out: r.stdout, err: r.stderr, calls: calls.map((c) => c.split(' ')[0]), raw: calls };
}

describe('supabase/scripts/load-check.sh (stubbed commands, nothing contacted)', () => {
  it.each(BAD)('refuses %j (exit 2, before any command is called)', (url) => {
    const r = stubRun({ args: [url] });
    expect([r.code, r.err.includes('refusing to run'), r.calls]).toEqual([2, true, []]);
    expect(stubRun({ args: ['--remove', url] }).calls).toEqual([]);
  });

  it('refuses a limit that is not a whole number of milliseconds, and rows left by an earlier run, before loading anything', () => {
    expect(stubRun({ env: { LOAD_CHECK_MAX_MS: '0' } }).calls).toEqual([]);
    expect(stubRun({ env: { LOAD_CHECK_MAX_MS: 'x' } }).code).toBe(2);
    const r = stubRun({ leftover: true });
    expect([r.code, r.calls, r.err.includes('--remove')]).toEqual([2, ['snapshot'], true]);
  });

  it('on success: snapshot, load, measure, clean-up, snapshot; the report labels every line and says the counts are equal; exit 0', () => {
    const r = stubRun();
    expect(r.calls).toEqual(['snapshot', 'load', 'measure', 'aggregate', 'sessions', 'cleanup', 'snapshot']);
    expect(r.code).toBe(0);
    const lines = r.out.split('\n').filter((l) => l.startsWith('['));
    expect(lines.length).toBeGreaterThanOrEqual(10);
    expect(lines.every((l) => /^\[(?:measured|computed|assumed)\]/.test(l))).toBe(true);
    for (const tag of ['measured', 'computed', 'assumed']) expect(lines.some((l) => l.startsWith(`[${tag}]`))).toBe(true);
    expect(r.out).toMatch(/\[measured\] load: 500 users, 50000 items/);
    expect(r.out).toMatch(/\[computed\] file storage for 500 users.*3950 MB.*5750 MB/);
    expect(r.out).toContain('counts and the analytics.cube checksum are EQUAL');
    expect(r.out).toMatch(/load-check: PASS/);
  });

  it('the clean-up gets the counter and the sequence it found, so it can put them back exactly', () => {
    const cleanup = stubRun().raw.find((c) => c.startsWith('cleanup')) ?? '';
    expect(cleanup).toBe('cleanup sig_day=2026-01-01 sig_n=35 seq_last=1 seq_called=f');
  });

  it.each(['load', 'measure', 'aggregate'])('removes what it created when the %s step fails (trap), then compares, and exits non-zero', (phase) => {
    const r = stubRun({ fail: phase });
    expect(r.code).not.toBe(0);
    expect(r.calls.slice(-3)).toEqual(['sessions', 'cleanup', 'snapshot']);
    expect(r.calls).not.toContain(phase === 'load' ? 'measure' : phase === 'measure' ? 'aggregate' : 'never');
  });

  it('exits non-zero when a query passes the limit (the break-check: limit 1 ms), after it has cleaned up', () => {
    const ok = stubRun({ ms: '2.0' });
    const over = stubRun({ ms: '2.0', env: { LOAD_CHECK_MAX_MS: '1' } });
    expect([ok.code, over.code]).toEqual([0, 1]);
    expect(over.out).toContain('OVER THE LIMIT');
    expect(over.calls.slice(-3)).toEqual(['sessions', 'cleanup', 'snapshot']);
    expect(stubRun({ ms: '3500.0' }).code).toBe(1);   // the default limit is 3000 ms
  });

  it('exits non-zero when the database is not as it was found (the after line differs), and says so', () => {
    const r = stubRun({ after: SNAP.replace('items=0', 'items=7') });
    expect([r.code, r.err.includes('NOT left as found')]).toEqual([1, true]);
  });

  it('refuses libpq environment variables: PGHOSTADDR, PGSERVICE and PGHOST never reach psql', () => {
    const r = stubRun({ env: { PGHOSTADDR: '10.9.9.9', PGSERVICE: 'evil', PGHOST: 'db.evil.test' } });
    expect(r.code).toBe(0);
    const lines = r.envLog.trim().split('\n');
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.every((l) => l.startsWith('PGHOSTADDR=unset PGSERVICE=unset PGHOST=unset'))).toBe(true);
  });

  it.each(['05', '08', '00', '5', '9', '1801', 'abc', '1e3', '-10', ''])('refuses LOAD_CHECK_AGG_SECONDS=%j before reading or loading anything', (v) => {
    const r = stubRun({ env: { LOAD_CHECK_AGG_SECONDS: v } });
    if (v === '') { expect(r.code).toBe(0); return; }   // empty means the default
    expect([r.code, r.calls]).toEqual([2, []]);
  });

  it('accepts 010 and 1800 as numbers (base 10, not octal)', () => {
    expect(stubRun({ env: { LOAD_CHECK_AGG_SECONDS: '010' } }).code).toBe(0);
    expect(stubRun({ env: { LOAD_CHECK_AGG_SECONDS: '1800' } }).code).toBe(0);
  });

  it('after a timed-out or failed step it waits until no session of the run is active, ends what is left, and only then cleans up', () => {
    const r = stubRun({ fail: 'load', busy: '2' });   // the first two checks still see an active session
    expect(r.code).not.toBe(0);
    expect(r.calls).toEqual(['snapshot', 'load', 'sessions', 'sessions', 'sessions', 'cleanup', 'snapshot']);
    const stuck = stubRun({ fail: 'load', busy: '99' });   // never quiet: the sessions are ended (kill=t), cleanup still runs, and the run fails
    expect(stuck.calls.filter((c) => c === 'sessions').length).toBe(12);
    expect(stuck.raw.some((c) => c === 'sessions')).toBe(true);
    expect(stuck.calls.slice(-2)).toEqual(['cleanup', 'snapshot']);
    expect(stuck.code).not.toBe(0);
    expect(stuck.err).toContain('still active');
  });

  it('--remove runs the clean-up only', () => {
    expect(stubRun({ args: ['--remove'] }).calls).toEqual(['cleanup']);
  });
});

describe('the load check script and its SQL, read as text', () => {
  it('names only the local stack: no linked project, no push, no hosted host, no secret, and a trap on exit', () => {
    const code = script.split('\n').filter((l) => !l.startsWith('#')).join('\n');   // the header comment says what the script never does
    expect(code).not.toMatch(/--linked|db push|--db-url|supabase\.co|sb_secret|service_role|password\s*[=:]\s*['"]?[a-z0-9]/i);
    expect(script).toMatch(/trap cleanup EXIT/);
    expect(script).toContain('transaction_timeout=$ms');
    expect(script).toContain('[[ "$url" == *$\'\\n\'* || "$url" == *$\'\\r\'* ]]');
    expect(script).toMatch(/trap 'status=1; exit 1' INT TERM/);
    expect(script).toContain('refusing to run');
    expect(script).not.toMatch(/echo[^\n]*\$url/);
  });

  it('loads 500 users x 100 items from fixed md5 seeds with example.test addresses only, and removes by the same address pattern', () => {
    expect(sql).toContain('generate_series(1, 500) n cross join generate_series(1, 100) j');
    expect(sql).toContain("'loadcheck-' || lpad(n::text, 3, '0') || '@example.test'");
    expect(sql).not.toMatch(/random\(\)|gen_random_uuid|now\(\)\s*-/);   // fixed seed: same data every run
    expect(sql).toContain("delete from auth.users where email ~ '^loadcheck-[0-9]{3}@example\\.test$'");
    expect([...sql.matchAll(/@[a-z]+/g)].every((m) => m[0] === '@example')).toBe(true);   // the only address domain in the SQL
  });

  it('runs the aggregation inside a transaction that is rolled back, and the three queries as an authenticated user under RLS with explain (analyze)', () => {
    expect(sql).toMatch(/begin;\ndo \$body\$\ndeclare t0 timestamptz[\s\S]*?analytics\.run_aggregation\(\)[\s\S]*?rollback;/);
    expect(sql).toContain('set local role authenticated');
    expect(sql).toContain("'explain (analyze, format json) '");
    for (const q of ['wardrobe_first_page', 'wardrobe_filtered', 'item_count']) expect(sql).toContain(`'${q}'`);
  });

  it('puts back the sign-up counter and the aggregate-run sequence, and compares a checksum of analytics.cube', () => {
    expect(sql).toContain('ops.daily_counts');
    expect(sql).toContain('set n = greatest(n - :removed, 0)');   // lowers by what this run removed, never writes an earlier absolute value
    expect(sql).toContain('max(id), 0) <= :\'seq_last\'::bigint');   // setval only when it can not repeat an id
    expect(sql).toMatch(/invites_accepted=.*ops\.invitations[\s\S]*facts=.*analytics_private\.facts[\s\S]*cube_stage=.*analytics_private\.cube_stage/);
    expect(sql).toContain("rls_not_applied");
    expect(sql).toContain("setval('ops.aggregate_runs_id_seq'");
    expect(sql).toMatch(/cube_md5=.*md5\(.*from analytics\.cube/);
    expect(sql).toContain("'items=' || (select count(*) from app.items)");
  });
});
