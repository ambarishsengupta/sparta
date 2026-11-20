// WO-0167 (R8b): the incident drill refuses non-local databases, exits before any change when set-worker-password.sh is missing, and restores worker_role and backup_role on every exit (re-check finding A).
// PURE: every run below uses stub `docker` and `psql` commands first on PATH (they log the tag of the SQL they were given and print canned answers) in a throw-away copy of the repository layout
// (a copy of the script, a stub set-worker-password.sh, the plan's text), or a non-local URL that is refused before any command is called. No container is started, no role is changed, no row
// is written, and the git-ignored real set-worker-password.sh is neither needed nor touched. The live run is only the completion-condition command of WO-0167 (`bash supabase/scripts/incident-drill.sh`).
// Collected through workflow/gates/db_tests.test.ts (vitest.config.ts does not include supabase/).
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = process.env.SEED_SCRIPT ?? 'supabase/scripts/incident-drill.sh';   // the override is for the mutation proof only
const BAD = ['postgresql://postgres:x@db.example.test:5432/postgres', 'postgresql://postgres:x@127.0.0.1:54322/postgres?host=db.example.test', 'postgresql://postgres@evil.test@127.0.0.1/postgres',
  'postgresql://postgres:x@127.0.0.1.evil.test:5432/postgres', 'postgresql://postgres:x@10.0.0.5/postgres', 'postgresql://postgres:x@localhost.evil.test/postgres', 'https://127.0.0.1/postgres',
  'host=db.evil.test dbname=postgres application_name=\npostgresql://u@127.0.0.1/postgres', 'postgresql://postgres:x@127.0.0.1:54322/postgres\n', 'postgresql://postgres:x@127.0.0.1:54322/postgres\r', 'postgresql://postgres:x@127.0.0.1:54322/postgres\nhost=db.evil.test'];
const STATE = 'w=|b=|p=abc123|u=0';
const POLICIES = 'items_insert INSERT using: - check: true\nitems_select SELECT using: (user_id = auth.uid()) check: -';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

interface Opts { args?: string[]; workerScript?: 'executable' | 'missing' | 'not-executable'; env?: Record<string, string> }
interface Result { code: number | null; out: string; err: string; tags: string[]; worker: string[]; envLog: string; rotateSql: string; policySql: string; pwSql: string; dir: string }

/** Runs a copy of the script inside a throw-away repository layout with stub `docker` and `psql` first on PATH. `env` goes to the stubs and the script (DR_FAIL=<tag> makes that call exit 3). */
function stubRun(o: Opts = {}): Result {
  const dir = mkdtempSync(join(tmpdir(), 'incidentdrill-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'supabase', 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'legal'));
  mkdirSync(join(dir, 'bin'));
  copyFileSync(SCRIPT, join(dir, 'supabase', 'scripts', 'incident-drill.sh'));
  copyFileSync('legal/INCIDENT-RESPONSE-PLAN.md', join(dir, 'legal', 'INCIDENT-RESPONSE-PLAN.md'));
  writeFileSync(join(dir, 'supabase', 'config.toml'), 'project_id = "sparta"\n');
  const mode = o.workerScript ?? 'executable';
  if (mode !== 'missing') {
    // the stub of the developer's script: it records whether it was asked to set or to clear, never the value
    writeFileSync(join(dir, 'supabase', 'scripts', 'set-worker-password.sh'), `#!/bin/sh\nif [ "$1" = "--clear" ]; then echo clear >> "$DR_DIR/worker.log"; else [ -n "$SPARTA_WORKER_DB_PASSWORD" ] && echo set >> "$DR_DIR/worker.log"; fi\nexit 0\n`);
    chmodSync(join(dir, 'supabase', 'scripts', 'set-worker-password.sh'), mode === 'executable' ? 0o755 : 0o644);
  }
  const log = join(dir, 'calls.log');
  const body = `#!/bin/sh
in=$(cat)
tag=$(printf '%s\\n' "$in" | sed -n 's/^-- q:\\(.*\\)$/\\1/p' | head -n 1)
echo "$tag" >> "${log}"
echo "PGHOST=\${PGHOST-unset} PGSERVICE=\${PGSERVICE-unset}" >> "${log}.env"
[ "$tag" = rotate ] && printf '%s\\n' "$in" > "${dir}/rotate.sql"
[ "$tag" = policy_drill ] && printf '%s\\n' "$in" > "${dir}/policy.sql"
case "$tag" in stand_in|rotate|restore_*) printf '%s\\n' "$in" >> "${dir}/pw.sql";; esac
[ "$tag" = "$DR_FAIL" ] && { echo "stub failure in $tag" >&2; exit 3; }
case "$tag" in
  state) n=$(grep -c '^state$' "${log}"); if [ "$n" -ge 2 ] && [ -n "$DR_STATE_AFTER" ]; then echo "$DR_STATE_AFTER"; else echo "$DR_STATE"; fi;;
  policies) n=$(grep -c '^policies$' "${log}"); if [ "$n" -ge 2 ] && [ -n "$DR_POL_AFTER" ]; then printf '%s\\n' "$DR_POL_AFTER"; else printf '%s\\n' "$DR_POL"; fi;;
  conn_old_worker) if [ -n "$DR_OLD_OK" ]; then echo worker_role; else echo 'FATAL:  password authentication failed for user "worker_role"' >&2; exit 2; fi;;
  conn_new_worker) echo worker_role;;
  conn_new_backup) echo backup_role;;
  conn_after_restore) if [ -n "$DR_AFTER_OK" ]; then echo worker_role; exit 0; fi; echo 'FATAL:  password authentication failed for user "worker_role"' >&2; exit 2;;
  policy_drill) printf 'BASE|%s\\nDENY|%s\\nINTX|1\\n' "\${DR_BASE-3}" "\${DR_DENY-0}";;
esac
exit 0
`;
  for (const cmd of ['docker', 'psql']) { writeFileSync(join(dir, 'bin', cmd), body); chmodSync(join(dir, 'bin', cmd), 0o755); }
  const r = spawnSync('bash', [join(dir, 'supabase', 'scripts', 'incident-drill.sh'), ...(o.args ?? [])], {
    encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, DR_DIR: dir, DR_STATE: STATE, DR_POL: POLICIES, PGHOST: 'db.evil.test', PGSERVICE: 'evil', DR_FAIL: '', DR_STATE_AFTER: '', DR_POL_AFTER: '', DR_OLD_OK: '', DR_AFTER_OK: '', ...o.env },
  });
  const read = (f: string): string[] => { try { return readFileSync(f, 'utf8').trim().split('\n'); } catch { return []; } };
  return { code: r.status, out: r.stdout, err: r.stderr, tags: read(log), worker: read(join(dir, 'worker.log')), envLog: read(`${log}.env`).join('\n'), rotateSql: existsSync(join(dir, 'rotate.sql')) ? readFileSync(join(dir, 'rotate.sql'), 'utf8') : '', policySql: existsSync(join(dir, 'policy.sql')) ? readFileSync(join(dir, 'policy.sql'), 'utf8') : '',
    pwSql: existsSync(join(dir, 'pw.sql')) ? readFileSync(join(dir, 'pw.sql'), 'utf8') : '', dir };
}

describe('supabase/scripts/incident-drill.sh (stub commands in a throw-away layout, nothing real contacted)', () => {
  it.each(BAD)('refuses the database URL %j (exit 2, before any command is called)', (url) => {
    const r = stubRun({ args: [url] });
    expect([r.code, r.err.includes('refusing to run'), r.tags, r.worker]).toEqual([2, true, [], []]);
  }, 30_000);

  it('exits non-zero BEFORE any change when set-worker-password.sh is missing, saying which file (QC 15): no database call, no role change', () => {
    const r = stubRun({ workerScript: 'missing' });
    expect(r.code).toBe(2);
    expect(r.err).toContain('supabase/scripts/set-worker-password.sh');
    expect(r.err).toContain('nothing was changed');
    expect([r.tags, r.worker, r.out]).toEqual([[], [], '']);
  }, 30_000);

  it('exits non-zero before any change when set-worker-password.sh exists but is not executable', () => {
    const r = stubRun({ workerScript: 'not-executable' });
    expect(r.code).toBe(2);
    expect(r.err).toContain('missing or not executable');
    expect([r.tags, r.worker]).toEqual([[], []]);
  }, 30_000);

  it('refuses to start when a synthetic user of an earlier drill is still present, before rotating anything', () => {
    const r = stubRun({ env: { DR_STATE: 'w=|b=|p=abc123|u=1' } });
    expect(r.code).toBe(2);
    expect(r.err).toContain('refusing to run');
    expect(r.tags).not.toContain('rotate');
    expect(r.worker).toEqual([]);
  }, 30_000);

  it('on success: every step prints PASS with its time, the order is rotate, old refused, new connect, restore, policy drill, rollback check, and the roles are put back', () => {
    const r = stubRun();
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const passes = r.out.split('\n').filter((l) => /^PASS [abc]\d? .* \(\d+ ms\)$/.test(l));
    expect(passes.map((l) => l.slice(5, 8).trim())).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2', 'c']);
    expect(r.out).not.toMatch(/FAIL/);
    const order = ['stand_in', 'rotate', 'conn_old_worker', 'conn_new_worker', 'conn_new_backup', 'restore_backup_role', 'policy_drill'].map((t) => r.tags.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(r.worker).toEqual([]);   // the drill sets and restores passwords itself (log statement off); set-worker-password.sh is only a precondition
    expect(r.tags.filter((t) => t === 'restore_worker_role')).toHaveLength(2);   // a5 and the (idempotent) restore of the trap
    expect(r.out).toContain('connection with the old worker_role password refused');
    expect(r.out).toContain('app.items policies identical before and after');
    expect(r.out).toContain('restored: worker_role password none as found, backup_role password none as found, app.items policies unchanged, no synthetic user left');
    expect(r.out).toContain('incident-drill: PASS');
  }, 60_000);

  it('(c) prints the section 6 message outline and the section 5 record fields, and writes no file into the layout', () => {
    const r = stubRun();
    expect(r.out).toContain('Subject: A security issue affecting your Sparta pilot account');
    expect(r.out).toContain('We are sorry. This is a student pilot');
    expect(r.out).toContain('--- section 5: record fields ---');
    expect(r.out).toContain('[ ] actions and times');
    expect(existsSync(join(r.dir, 'incident-log.md'))).toBe(false);
  }, 60_000);

  it('never prints, logs or passes on the command line a generated password; libpq environment variables never reach the commands', () => {
    const r = stubRun();
    const secrets = r.rotateSql.match(/'([0-9a-f]{32})'/g)?.map((s) => s.slice(1, -1)) ?? [];
    expect(secrets).toHaveLength(2);   // the worker_role and the backup_role value, each 32 hex characters
    for (const s of secrets) {
      expect(r.out + r.err).not.toContain(s);
      expect(readFileSync(join(r.dir, 'calls.log'), 'utf8')).not.toContain(s);
    }
    expect(r.envLog.split('\n').every((l) => l === 'PGHOST=unset PGSERVICE=unset')).toBe(true);
  }, 60_000);

  it('pins the policy drill SQL: one transaction that ends in rollback, no commit, deny-all before the DENY count, the authenticated role before both counts', () => {
    const sql = stubRun().policySql.replace(/^-- q:policy_drill\n/, '').trim();
    expect(sql.startsWith('begin;')).toBe(true);
    expect(sql.endsWith('rollback;')).toBe(true);
    expect(sql).not.toMatch(/commit/i);
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    const at = (needle: string, from = 0): number => sql.indexOf(needle, from);
    const alter = at('alter policy items_select on app.items using (false);');
    const base = at("select 'BASE|'");
    const deny = at("select 'DENY|'");
    expect(alter).toBeGreaterThan(-1);
    expect([base, deny].every((i) => i > -1)).toBe(true);
    const role1 = at('set local role authenticated;');
    const role2 = at('set local role authenticated;', role1 + 1);
    expect(role1).toBeGreaterThan(-1);
    expect(role1).toBeLessThan(base);              // the first count runs as the signed-in user
    expect(role2).toBeGreaterThan(alter);          // and so does the one after the policy is closed
    expect(role2).toBeLessThan(deny);
    expect(base).toBeLessThan(alter);
    expect(alter).toBeLessThan(deny);
  }, 60_000);

  it('pins the a5 check: after the restore the rotated worker_role password is tried again, and a restore that leaves it working FAILS', () => {
    const ok = stubRun();
    expect(ok.tags.indexOf('conn_after_restore')).toBeGreaterThan(ok.tags.indexOf('restore_worker_role'));
    const bad = stubRun({ env: { DR_AFTER_OK: '1' } });
    expect([bad.code, /FAIL a5 /.test(bad.err), bad.out.includes('still connects after the restore')]).toEqual([1, true, true]);
  }, 60_000);

  it('every session that carries a password turns statement logging and pg_stat_statements tracking off BEFORE the alter role', () => {
    const r = stubRun({ env: { DR_STATE: 'w=SCRAM-SHA-256$4096:salt$stored:server|b=|p=abc123|u=0' } });
    const blocks = r.pwSql.split(/^-- q:/m).filter((b) => b.trim() !== '');
    expect(blocks.length).toBeGreaterThanOrEqual(5);   // stand_in, rotate, and the restores of a5 and of the trap
    for (const b of blocks) {
      const log = b.indexOf("set log_statement = 'none'; set pg_stat_statements.track = 'none';");
      expect(log).toBeGreaterThan(-1);
      expect(log).toBeLessThan(b.indexOf('alter role'));
    }
  }, 60_000);

  it('TRAP: a step failing midway (the new worker_role password does not connect) restores worker_role and clears backup_role, removes the synthetic user, ends its sessions, and exits 1', () => {
    const r = stubRun({ env: { DR_FAIL: 'conn_new_worker' } });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/FAIL a3 /);
    expect(r.out).toMatch(/PASS a2 /);
    expect(r.out).not.toMatch(/PASS a4 /);
    expect(r.tags).not.toContain('conn_new_backup');   // the drill stopped at the first failure
    expect(r.tags).not.toContain('policy_drill');
    expect(r.tags.filter((t) => t === 'restore_worker_role')).toHaveLength(1);   // the trap restored worker_role (no password before, so cleared)
    expect(r.pwSql).toMatch(/q:restore_worker_role\n[^\n]*\nalter role worker_role password null;/);
    const after = r.tags.slice(r.tags.indexOf('conn_new_worker') + 1);
    expect(after).toEqual(expect.arrayContaining(['restore_backup_role', 'kill', 'remove_user']));
    expect(r.out).toContain('restored: worker_role password none as found, backup_role password none as found');
  }, 60_000);

  it('TRAP: a failure while rotating (before the roles were confirmed changed) still restores both roles', () => {
    const r = stubRun({ env: { DR_FAIL: 'rotate' } });
    expect(r.code).toBe(1);
    expect(r.tags).toContain('restore_worker_role');
    expect(r.tags).toContain('restore_backup_role');
  }, 60_000);

  it('TRAP: when worker_role had a password before, the stored verifier is put back (restore_worker_role), not cleared', () => {
    const r = stubRun({ env: { DR_FAIL: 'conn_new_backup', DR_STATE: 'w=SCRAM-SHA-256$4096:salt$stored:server|b=|p=abc123|u=0' } });
    expect(r.code).toBe(1);
    expect(r.tags).toContain('restore_worker_role');
    expect(r.pwSql).toContain("alter role worker_role password 'SCRAM-SHA-256$4096:salt$stored:server';");   // the stored value, not null
    expect(r.pwSql).not.toMatch(/restore_worker_role\n[^\n]*\nalter role worker_role password null/);
    expect(r.out).toContain('restored: worker_role password set as found');
    expect(r.out + r.err).not.toContain('SCRAM-SHA-256');
  }, 60_000);

  it('FAILS when the OLD worker_role password still connects after the rotation, and still restores', () => {
    const r = stubRun({ env: { DR_OLD_OK: '1' } });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/FAIL a2 /);
    expect(r.out).toContain('the OLD worker_role password still connects');
    expect(r.tags).toContain('restore_worker_role');
  }, 60_000);

  it('FAILS when the synthetic user read no rows before the policy was closed (the test would prove nothing), and when it still reads rows with the deny-all policy', () => {
    const empty = stubRun({ env: { DR_BASE: '0' } });
    expect([empty.code, /FAIL b1 /.test(empty.err), empty.out.includes('proves nothing')]).toEqual([1, true, true]);
    const leaky = stubRun({ env: { DR_DENY: '2' } });
    expect([leaky.code, /FAIL b1 /.test(leaky.err), leaky.out.includes('still read 2 rows')]).toEqual([1, true, true]);
  }, 60_000);

  it('FAILS and shows the difference when the app.items policies differ after the rollback', () => {
    const r = stubRun({ env: { DR_POL_AFTER: 'items_select SELECT using: false check: -' } });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/FAIL b2 /);
    expect(r.out).toContain('policies DIFFER after the rollback');
    expect(r.out).toContain('using: false');
  }, 60_000);

  it('FAILS (exit 1) when the final check finds the roles NOT as found, and says so', () => {
    const r = stubRun({ env: { DR_STATE_AFTER: 'w=SCRAM-SHA-256$4096:other|b=|p=abc123|u=0' } });
    expect(r.code).toBe(1);
    expect(r.err).toContain('NOT left as found');
  }, 60_000);
});
