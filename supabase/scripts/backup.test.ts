// WO-0164 (R8b): backup.sh and restore-rehearsal.sh refuse non-local databases, fail on a failed dump, leave no plain-text dump behind, and the rehearsal's trap removes its container (re-check finding A).
// PURE: every run below uses stub `docker`, `age`, `age-keygen`, `pg_dump` and `pg_dumpall` commands first on PATH (they log their arguments and print canned answers) in a throw-away copy of the
// repository layout, or a non-local URL that is refused before any command is called. No container is started, no age call is real, no row is written, nothing is dumped. TMPDIR points into the
// throw-away folder, so "nothing left behind" is read from that folder. The live run is only the completion-condition command of WO-0164 (`bash supabase/scripts/restore-rehearsal.sh`).
// Collected through workflow/gates/db_tests.test.ts (vitest.config.ts does not include supabase/).
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const BACKUP = process.env.BACKUP_SCRIPT ?? 'supabase/scripts/backup.sh';   // the overrides are for the mutation proof only
const REHEARSAL = process.env.REHEARSAL_SCRIPT ?? 'supabase/scripts/restore-rehearsal.sh';
const BAD = ['postgresql://backup_role@db.example.test:5432/postgres', 'postgresql://backup_role@127.0.0.1:54322/postgres?host=db.example.test', 'postgresql://backup_role@evil.test@127.0.0.1/postgres',
  'postgresql://backup_role@127.0.0.1.evil.test:5432/postgres', 'postgresql://backup_role@10.0.0.5/postgres', 'postgresql://backup_role@localhost.evil.test/postgres', 'https://127.0.0.1/postgres',
  'postgresql://backup_role@127.0.0.1:54322/postgres\n', 'postgresql://backup_role@127.0.0.1:54322/postgres\r', 'host=db.evil.test dbname=postgres\npostgresql://u@127.0.0.1/postgres',
  'postgresql://backup_role:x@127.0.0.1:54322/postgres'];   // the last one is local but carries a password in the URL, which would show in `ps`

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

interface Run { code: number | null; out: string; err: string; calls: string[]; outDir: string; tmp: string; dir: string }

/** One throw-away layout: a copy of the scripts, a stub backup.sh for the rehearsal runs, stub commands first on PATH. `env` reaches the stubs (DR_FAIL=<command> makes that command exit 3). */
function layout(noPg = false): { dir: string; tmp: string; outDir: string; recipients: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'backuptest-'));
  dirs.push(dir);
  for (const d of ['supabase/scripts', 'bin']) mkdirSync(join(dir, d), { recursive: true });
  // TMPDIR and OUT_DIR are outside the layout: both scripts refuse a folder inside the repository
  const tmp = mkdtempSync(join(tmpdir(), 'backuptest-tmp-'));
  const outDir = mkdtempSync(join(tmpdir(), 'backuptest-out-'));
  dirs.push(tmp, outDir);
  writeFileSync(join(dir, 'supabase', 'config.toml'), 'project_id = "sparta"\n');
  copyFileSync(BACKUP, join(dir, 'supabase', 'scripts', 'backup.sh'));
  copyFileSync(REHEARSAL, join(dir, 'supabase', 'scripts', 'restore-rehearsal.sh'));
  writeFileSync(join(dir, 'recipients.txt'), 'age1examplepublickeyexamplepublickeyexamplepublickeyexample00\n');
  const log = join(dir, 'calls.log');
  const stub = (name: string, body: string): void => { writeFileSync(join(dir, 'bin', name), `#!/bin/sh\n${body}\n`); chmodSync(join(dir, 'bin', name), 0o755); };
  const common = `echo "${'$'}(basename "${'$'}0") ${'$'}*" >> "${log}"\n[ "${'$'}DR_FAIL" = "${'$'}(basename "${'$'}0")" ] && { echo "stub failure" >&2; exit 3; }`;
  if (!noPg) {
    // each stub dump is padded past backup.sh's 1000-byte minimum (a real dump is far larger); DR_EMPTY=1 makes both print nothing
    stub('pg_dump', `${common}\n[ -n "${'$'}DR_EMPTY" ] && exit 0\necho '-- PLAIN-DATA-MARKER'\nhead -c 1100 /dev/zero | tr '\\0' x; echo`);
    stub('pg_dumpall', `${common}\n[ -n "${'$'}DR_EMPTY" ] && exit 0\necho '-- PLAIN-ROLES-MARKER'\nhead -c 1100 /dev/zero | tr '\\0' x; echo`);
  }
  // age: -o FILE writes a fake ciphertext; -d (decrypt) fails as it does with a wrong key
  stub('age', `${common}
if [ "${'$'}1" = "-d" ] && [ -n "${'$'}DR_AGE_FAIL_SECOND" ]; then n=$(cat "${log}.dcount" 2>/dev/null || echo 0); n=$((n + 1)); echo "${'$'}n" > "${log}.dcount"; [ "${'$'}n" -ge 2 ] && { echo "stub: the second decrypt fails" >&2; exit 1; }; fi
cat > "${log}.stdin"\nout=''; while [ "${'$'}#" -gt 0 ]; do [ "${'$'}1" = "-o" ] && out="${'$'}2"; shift; done\n[ -n "${'$'}out" ] && echo STUB-CIPHERTEXT > "${'$'}out"\nexit 0`);
  stub('age-keygen', `${common}\nif [ "${'$'}1" = "-o" ]; then echo AGE-SECRET-KEY-1PLACEHOLDERPLACEHOLDERPLACEHOLDER > "${'$'}2"; else echo age1stubpublickey; fi`);
  stub('docker', `${common}
in=$(cat 2>/dev/null)
echo "pwenv=${'$'}(env | grep -c '^PGPASS')" >> "${log}.env"
case "${'$'}in" in
  *"alter role backup_role password '"*) echo "SQL: set-password" >> "${log}";;
  *"alter role backup_role password null"*) echo "SQL: clear-password" >> "${log}";;
  *"delete from auth.users where email like"*) echo "SQL: remove-users" >> "${log}";;
esac
case "${'$'}*" in *pg_dump*) echo '-- PLAIN-DATA-MARKER'; head -c 1100 /dev/zero | tr '\\0' x; echo;; esac
case "${'$'}1" in
  inspect) echo "example/postgres:1.2.3";;
  run) echo cid;;
  port) echo "127.0.0.1:32768";;
  exec)
    case "${'$'}in" in
      *session_replication_role*) [ -n "${'$'}DR_FAIL_RESTORE" ] && exit 5;;
      *"insert into auth.users"*) ;;
      *"'users=' ||"*) echo "users=3;log=0;counts=x;pw=false;authgrant=false;app=y";;
      *"app.delete_my_account"*) echo deleted;;
      *"from ops.deletion_log where deleted_at"*) echo 11111111-1111-1111-1111-111111111111;;
      *"select md5('rehearsal:user:"*) echo 11111111-1111-1111-1111-111111111111;;
      *"json_agg"*) echo '[]';;
      *"count(*) from auth.users where email like"*) echo 0;;
      *"count(*) from auth.users;"*) echo 3;;
      *"has_schema_privilege('backup_role', 'auth', 'usage');"*) echo f;;
      *"clock_timestamp"*) echo '2026-11-21 00:00:00.000000';;
      *"query_to_xml"*) echo 'items|6';;
    esac;;
esac
exit 0`);
  return { dir, tmp, outDir, recipients: join(dir, 'recipients.txt'), log };
}

function run(script: string, args: string[], env: Record<string, string> = {}, l = layout(), basePath = process.env.PATH ?? ''): Run {
  if (script.endsWith('restore-rehearsal.sh')) {
    // the rehearsal's own backup step is a stub in the layout: it writes a fake encrypted file, as backup.sh would
    writeFileSync(join(l.dir, 'supabase', 'scripts', 'backup.sh'), '#!/bin/sh\necho "backup.sh $*" >> "$DR_LOG"\n[ -n "$DR_FAIL_BACKUP" ] && exit 1\nmkdir -p "$3"\necho STUB-CIPHERTEXT > "$3/backup-stub.sql.age"\nexit 0\n');
  }
  const r = spawnSync('bash', [join(l.dir, 'supabase', 'scripts', script), ...args], {
    encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, PATH: `${join(l.dir, 'bin')}:${basePath}`, TMPDIR: l.tmp, DR_LOG: l.log, DR_FAIL: '', PGHOST: 'db.evil.test', ...env },
  });
  const calls = existsSync(l.log) ? readFileSync(l.log, 'utf8').trim().split('\n') : [];
  return { code: r.status, out: r.stdout, err: r.stderr, calls, outDir: l.outDir, tmp: l.tmp, dir: l.dir };
}
const backup = (url: string, env: Record<string, string> = {}, l = layout()): Run => run('backup.sh', [url, l.recipients, l.outDir], env, l);
const GOOD = 'postgresql://backup_role@127.0.0.1:54322/postgres';

/** A folder of symlinks to exactly the system tools backup.sh and the stubs run (each found with `command -v` on THIS machine), and never pg_dump or pg_dumpall: a PATH made of this folder alone cannot reach a host PostgreSQL tool on any machine. */
function systemToolsOnly(dir: string): string {
  const sys = join(dir, 'systools');
  mkdirSync(sys, { recursive: true });
  // backup.sh: dirname grep mkdir mktemp sed head date tee wc tr seq sleep rm mv (cd, pwd, echo, test are builtins), the stubs: sh basename cat env head tr, the test's own spawn: bash
  const need = ['bash', 'sh', 'dirname', 'basename', 'grep', 'mkdir', 'mktemp', 'sed', 'head', 'date', 'tee', 'wc', 'tr', 'seq', 'sleep', 'rm', 'mv', 'cat', 'env'];
  const find = (tool: string): string => spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
  for (const tool of need) {
    const found = find(tool);
    if (!found.startsWith('/')) throw new Error(`the test needs the system tool "${tool}" on PATH and it is missing on this machine`);
    symlinkSync(found, join(sys, tool));
  }
  // backup.sh's time limit uses timeout when there is one, else perl: one of the two must exist
  const limiter = ['timeout', 'perl'].filter((t) => find(t).startsWith('/'));
  if (limiter.length === 0) throw new Error('the test needs the system tool "timeout" or "perl" on PATH and both are missing on this machine');
  for (const tool of limiter) symlinkSync(find(tool), join(sys, tool));
  expect(readdirSync(sys).filter((f) => f.startsWith('pg_'))).toEqual([]);   // by construction: no host dump tool
  return sys;
}

describe('supabase/scripts/backup.sh (stub commands in a throw-away layout, nothing real contacted)', () => {
  it.each(BAD)('refuses the database URL %j (exit 2, before any command is called)', (url) => {
    const r = backup(url);
    expect([r.code, r.err.includes('refusing to run'), r.calls]).toEqual([2, true, []]);
    expect(readdirSync(r.outDir)).toEqual([]);
  }, 30_000);

  it('refuses a recipient file with a private key, a missing one, and an OUT_DIR inside the repository', () => {
    const l = layout();
    writeFileSync(join(l.dir, 'private.txt'), 'AGE-SECRET-KEY-placeholder\nage1examplepublickey\n');
    const priv = run('backup.sh', [GOOD, join(l.dir, 'private.txt'), l.outDir], {}, l);
    const none = run('backup.sh', [GOOD, join(l.dir, 'absent.txt'), l.outDir], {}, l);
    const inside = run('backup.sh', [GOOD, l.recipients, join(l.dir, 'dumps')], {}, l);
    expect([priv.code, none.code, inside.code]).toEqual([2, 2, 2]);
    expect(priv.err).toContain('PRIVATE key');
    expect(inside.err).toContain('outside this repository');
    expect(inside.calls).toEqual([]);
  }, 30_000);

  it('on success writes ONLY one encrypted file to OUT_DIR, with the documented flags, and leaves no plain-text file anywhere', () => {
    const r = backup(GOOD);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const files = readdirSync(r.outDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^backup-\d{8}T\d{6}Z\.sql\.age$/);
    expect(readFileSync(join(r.outDir, files[0]), 'utf8')).not.toMatch(/PLAIN-(DATA|ROLES)-MARKER/);
    expect(readdirSync(r.tmp)).toEqual([]);   // nothing was written to the temporary folder: the dumps are streamed into age
    const stream = readFileSync(join(r.dir, 'calls.log.stdin'), 'utf8');   // what age was given on stdin (the stub's copy lives outside OUT_DIR)
    expect(stream.indexOf('PLAIN-ROLES-MARKER')).toBeGreaterThanOrEqual(0);
    expect(stream.indexOf('PLAIN-ROLES-MARKER')).toBeLessThan(stream.indexOf('PLAIN-DATA-MARKER'));   // roles first, then schema and data
    const roles = r.calls.find((c) => c.startsWith('pg_dumpall')) ?? '';
    const data = r.calls.find((c) => c.startsWith('pg_dump ')) ?? '';
    for (const flag of ['--roles-only', '--no-role-passwords', '-U backup_role']) expect(roles).toContain(flag);
    expect(data).toContain('-U backup_role');
    expect(data.match(/--exclude-table /g)?.length).toBeGreaterThanOrEqual(21);   // the 21 platform-feature tables (plus auth.refresh_tokens and its sequence)
    expect(data).not.toContain('--role');   // backup_role cannot SET ROLE postgres (why the CLI's own dump is not used)
    expect(r.calls.find((c) => c.startsWith('age'))).toContain(`-R ${r.dir}/recipients.txt`);
    expect(r.calls.join('\n')).not.toMatch(/PGPASSWORD|:x@/);
  }, 30_000);

  it.each(['pg_dumpall', 'pg_dump', 'age'])('fails when %s fails: non-zero exit, no file in OUT_DIR, no plain-text file left in the work folder', (cmd) => {
    const r = backup(GOOD, { DR_FAIL: cmd });
    expect(r.code).toBe(1);
    expect(r.err).toContain('backup:');
    expect(readdirSync(r.outDir)).toEqual([]);
    expect(readdirSync(r.tmp)).toEqual([]);
    expect(readdirSync(r.outDir).some((f) => f.endsWith('.part'))).toBe(false);   // a partial ciphertext is removed too
  }, 30_000);

  it('fails when both dumps come back empty: no file in OUT_DIR, nothing kept (an empty stream still gives a non-empty age file)', () => {
    const r = backup(GOOD, { DR_EMPTY: '1' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('an empty or cut-off dump is not a backup');
    expect(readdirSync(r.outDir)).toEqual([]);
    expect(readdirSync(r.tmp)).toEqual([]);   // the one-number count folder is removed too
  }, 30_000);

  it('refuses an OUT_DIR inside the repository typed in another case (identity, not text: a case-insensitive volume lets the same folder be named twice)', () => {
    const l = layout();
    const upper = join(l.dir.toUpperCase(), 'dumps');
    const r = run('backup.sh', [GOOD, l.recipients, upper], {}, l);
    if (existsSync(l.dir.toUpperCase())) {   // true on a case-insensitive volume (macOS APFS): the same folder, so it must be refused
      expect([r.code, r.err.includes('outside this repository'), r.calls]).toEqual([2, true, []]);
    } else {
      // a case-sensitive volume: another folder altogether, so the identity check has nothing to refuse; the run is not refused as "outside this repository" (it may still fail to create a folder under the upper-case root)
      expect(r.err).not.toContain('outside this repository');
      expect([0, 2]).toContain(r.code);
      if (r.code === 0) expect([r.calls.some((c) => c.startsWith('pg_dumpall')), r.calls.some((c) => c.startsWith('pg_dump ')), r.calls.some((c) => c.startsWith('age'))]).toEqual([true, true, true]);
      else { expect(r.err).toContain('cannot create OUT_DIR'); expect(r.calls).toEqual([]); }
    }
  }, 30_000);

  it('without a host pg_dump it runs the dumps through docker exec with the password passed by environment name only, and no argument holds its value', () => {
    const l = layout(true);
    const r = run('backup.sh', [GOOD, l.recipients, l.outDir], { PGPASSWORD: 'your-probe-value' }, l, systemToolsOnly(l.dir));
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const execs = r.calls.filter((c) => c.startsWith('docker exec'));
    expect(execs).toHaveLength(2);   // pg_dumpall and pg_dump
    for (const c of execs) { expect(c).toContain('-e PGPASSWORD supabase_db_sparta'); expect(c).not.toContain('your-probe-value'); }
    expect(r.calls.join('\n')).not.toContain('your-probe-value');
    expect(readFileSync(join(r.dir, 'calls.log.env'), 'utf8')).toContain('pwenv=1');   // the value was in the environment of the docker client
  }, 30_000);
});

describe('supabase/scripts/restore-rehearsal.sh (stub commands in a throw-away layout)', () => {
  it.each(BAD.filter((u) => !u.includes(':x@')))('refuses the database URL %j (exit 2, before any command is called)', (url) => {
    const l = layout();
    const r = run('restore-rehearsal.sh', [url], {}, l);
    expect([r.code, r.err.includes('refusing to run'), r.calls]).toEqual([2, true, []]);
  }, 30_000);

  it('the trap removes the container (docker rm -f of the rehearsal container), the key folder and the synthetic users when the restore step fails', () => {
    const r = run('restore-rehearsal.sh', [], { DR_FAIL: 'age' });   // the stub age cannot decrypt: the run fails after the container was started
    expect(r.code).toBe(1);
    expect(r.calls.some((c) => /^docker run .*--name sparta_restore_rehearsal_\d+ /.test(c))).toBe(true);
    expect(r.calls.some((c) => /^docker rm -f sparta_restore_rehearsal_\d+$/.test(c))).toBe(true);
    expect(r.calls.some((c) => c.startsWith('backup.sh '))).toBe(true);
    expect(r.err).toContain('RESTORE REHEARSAL: FAIL');
    expect(r.out + r.err).not.toContain('RESTORE REHEARSAL: PASS');
    expect(readdirSync(r.tmp)).toEqual([]);   // key folder (and the stub's fake backup inside it) removed
    expect(r.calls).toContain('SQL: remove-users');   // the synthetic users are deleted by the trap
    expect(r.calls.join('\n')).not.toMatch(/AGE-SECRET-KEY|POSTGRES_PASSWORD=/);   // no key and no password on any command line (the stub key file holds a private-key-shaped value)
    expect(readdirSync(r.tmp)).toEqual([]);
  }, 60_000);

  it('prints the NOT IN THIS BACKUP line naming what the backup leaves out', () => {
    const r = run('restore-rehearsal.sh', [], { DR_FAIL: 'age' });
    const line = r.out.split('\n').find((l) => l.startsWith('NOT IN THIS BACKUP:')) ?? '';
    for (const word of ['analytics', 'analytics_private', 'auth.refresh_tokens', 'auth.refresh_tokens_id_seq', '21 platform-feature tables']) expect(line).toContain(word);
  }, 60_000);

  it('clears backup_role\'s password in the trap when backup.sh fails after the password was set', () => {
    const r = run('restore-rehearsal.sh', [], { DR_FAIL_BACKUP: '1' });
    expect(r.code).toBe(1);
    const set = r.calls.indexOf('SQL: set-password');
    expect(set).toBeGreaterThanOrEqual(0);
    expect(r.calls.indexOf('SQL: clear-password')).toBeGreaterThan(set);   // the only clear on this path is the trap's
    expect(r.calls).toContain('SQL: remove-users');
  }, 60_000);

  it('fails when the restore ends early (decrypt, docker or psql dies or hits the limit): the status of the restore pipeline is read', () => {
    const r = run('restore-rehearsal.sh', [], { DR_FAIL_RESTORE: '1' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('the restore did not finish');
    expect(r.out + r.err).not.toContain('RESTORE REHEARSAL: PASS');
    expect(r.calls.some((c) => /^docker rm -f sparta_restore_rehearsal_\d+$/.test(c))).toBe(true);
  }, 60_000);

  it('fails when only the in-stream decrypt fails (the pre-check decrypt succeeded): the status of the decrypt inside the stream is read', () => {
    const r = run('restore-rehearsal.sh', [], { DR_AGE_FAIL_SECOND: '1' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('the restore did not finish');
    expect(r.out + r.err).not.toContain('RESTORE REHEARSAL: PASS');
  }, 60_000);

  it('refuses a key folder inside the repository typed in another case (TMPDIR identity check)', () => {
    const l = layout();
    const inside = join(l.dir, 'tmpin');
    mkdirSync(inside);
    const r = run('restore-rehearsal.sh', [], { TMPDIR: inside.toUpperCase() }, l);
    if (existsSync(inside.toUpperCase())) expect([r.code, r.err.includes('inside the repository')]).toEqual([1, true]);
    else expect(r.code).not.toBe(2);
  }, 60_000);

  it('refuses (exit 2) when the database container cannot be inspected, before it starts or changes anything', () => {
    const l = layout();
    const r = run('restore-rehearsal.sh', [], { DR_FAIL: 'docker' }, l);   // the stub docker fails at its first call: refused before anything starts
    expect(r.code).toBe(2);
    expect(r.calls.some((c) => c.startsWith('docker run'))).toBe(false);
    expect(readdirSync(r.tmp)).toEqual([]);
  }, 60_000);
});
