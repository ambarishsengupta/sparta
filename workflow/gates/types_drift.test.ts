import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// WO-0126: the types_drift stage fails when the committed database types are not what the migrations produce. The `supabase` CLI is a stub: `status`
// answers as asked and `gen types` prints a fixture file, so no database is needed. The real run is the gate (it follows db_tests, which resets the database).
const SCRIPT = 'workflow/gates/types_drift.sh';
const COMMITTED = 'apps/web/lib/supabase/database.types.ts';
const real = readFileSync(COMMITTED, 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'types-drift-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Runs the script with a stub CLI. `generated` is what `supabase gen types` prints (null: the generator fails); `committed` is the file under check (null: it does not exist). */
function run(o: { stack?: boolean; generated: string | null; committed: string | null }) {
  const dir = mkdtempSync(join(scratch, 'run-'));
  const fixture = join(dir, 'generated.ts');
  // gen-types.sh adds its own two comment lines in front of what the CLI prints, so the stub prints the fixture without the two lines of a full file
  if (o.generated !== null) writeFileSync(fixture, o.generated.startsWith('// GENERATED') ? o.generated.split('\n').slice(2).join('\n') : o.generated);
  const stub = `#!/bin/sh\ncase "$1" in\nstatus) exit ${o.stack === false ? 1 : 0};;\ngen) ${o.generated === null ? 'exit 3' : `cat "${fixture}"`};;\nesac\n`;
  writeFileSync(join(dir, 'supabase'), stub);
  chmodSync(join(dir, 'supabase'), 0o755);
  const file = join(dir, 'committed.ts');
  if (o.committed !== null) writeFileSync(file, o.committed);
  const r = spawnSync('bash', [SCRIPT, file], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TMPDIR: dir } });
  return { code: r.status, out: r.stdout + r.stderr, file };
}

/** The real generated file with one column added after the first column line of the file (the first table's Row type; the regex replaces its first match only): enough to stand for what a migration `alter table ... add column` does. */
const withColumn = (text: string): string => {
  let n = 0;
  return text.replace(/^(\s*)"([a-z_]+)"(\??): ([^,]+),/gm, (m, ws: string, name: string, opt: string, type: string) => (n++ === 0 ? `${m}"nickname"${opt}: ${type},` : m));
};

describe('types_drift.sh', () => {
  it('the committed file is a real generated file (the fixture base is not empty)', () => {
    expect(real).toContain('export type Database = {');
    expect(withColumn(real)).not.toBe(real);
  });
  it('passes when the regenerated types equal the committed file', () => {
    const r = run({ generated: real, committed: real });
    expect([r.code, r.out.includes('types_drift: PASS'), r.out.includes('SKIPPED')]).toEqual([0, true, false]);
  });
  it('FAILS when a column is added without regenerating, names the file and the two commands that fix it, and shows the difference', () => {
    const r = run({ generated: withColumn(real), committed: real });
    expect(r.code).toBe(1);
    expect(r.out).toContain('types_drift: FAIL');
    expect(r.out).toContain('supabase db reset && bash supabase/scripts/gen-types.sh');
    expect(r.out).toMatch(/^\+.*"nickname"/m);
    expect(r.out).not.toContain('SKIPPED');
  });
  it('FAILS the other way round too (the committed file has a column the database no longer has)', () => {
    expect(run({ generated: real, committed: withColumn(real) }).code).toBe(1);
  });
  it('FAILS, not skips, when the generator fails or prints something that is not the types', () => {
    const failed = run({ generated: null, committed: real });
    expect([failed.code, failed.out.includes('SKIPPED')]).toEqual([1, false]);
    const junk = run({ generated: 'Error: connection refused\n', committed: real });
    expect([junk.code, junk.out.includes('SKIPPED')]).toEqual([1, false]);
  });
  it('FAILS when the committed file is missing', () => {
    const r = run({ generated: real, committed: null });
    expect([r.code, r.out.includes('does not exist')]).toEqual([1, true]);
  });
  it('prints SKIPPED and exits 0 when the stack is not running, so GATE_STRICT=1 fails the stage (gate.sh run_stage greps SKIPPED)', () => {
    const r = run({ stack: false, generated: real, committed: withColumn(real) });
    expect([r.code, r.out.includes('SKIPPED')]).toEqual([0, true]);
  });
  it('never writes the repository: the temporary file is outside the tree and removed', () => {
    const text = readFileSync(SCRIPT, 'utf8');
    expect(text).toContain('mktemp -d'); expect(text).toContain("trap 'rm -rf \"$dir\"' EXIT"); expect(text).not.toMatch(/>\s*"?\$committed/);
  });
});

describe('the stage is wired into the gate right after db_tests', () => {
  const gate = readFileSync('workflow/gates/gate.sh', 'utf8');
  const stages = [...gate.matchAll(/^run_stage "([a-z_]+)"/gm)].map((m) => m[1]);
  it('through this script, directly after the stage that resets the database', () => {
    expect(gate).toContain('run_stage "types_drift" bash workflow/gates/types_drift.sh');
    expect(stages.indexOf('types_drift')).toBe(stages.indexOf('db_tests') + 1);
    expect(stages.indexOf('db_tests')).toBeGreaterThan(-1);
  });
});

describe('gen-types.sh is deterministic input for the check', () => {
  const text = readFileSync('supabase/scripts/gen-types.sh', 'utf8');
  it('reads the LOCAL stack only, for the four schemas, and writes only after the generator succeeded', () => {
    expect(text).toContain('supabase gen types typescript --local --schema "$SCHEMAS"');
    expect(text).toContain('SCHEMAS="app,catalog,ops,analytics"');
    expect(text).not.toMatch(/--linked|--db-url|--project-id/);
    expect(text).toContain("grep -q '^export type Database = {'");
  });
  it('the committed types hold no secret, no machine path and no address', () => {
    expect(real).not.toMatch(/\/Users\/|\/home\/|postgres(ql)?:\/\/|127\.0\.0\.1|sb_(secret|publishable)_|eyJ[A-Za-z0-9]{10,}/);
    expect(real.startsWith('// GENERATED by supabase/scripts/gen-types.sh')).toBe(true);
  });
});

describe('gen-types.sh never leaves a truncated or half-written file', () => {
  /** Runs gen-types.sh into a target that already holds `before`; the stub CLI prints `printed` and exits with `exit` (124 is what `timeout` returns). */
  function gen(printed: string, exit: number) {
    const dir = mkdtempSync(join(scratch, 'gen-'));
    writeFileSync(join(dir, 'supabase'), `#!/bin/sh\ncase "$1" in\nstatus) exit 0;;\ngen) cat "${join(dir, 'printed.ts')}"; exit ${exit};;\nesac\n`);
    chmodSync(join(dir, 'supabase'), 0o755);
    writeFileSync(join(dir, 'printed.ts'), printed);
    const target = join(dir, 'target.ts');
    const before = 'the committed file, untouched\n';
    writeFileSync(target, before);
    const r = spawnSync('bash', ['supabase/scripts/gen-types.sh', target], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
    return { code: r.status, out: r.stdout + r.stderr, after: readFileSync(target, 'utf8'), before, leftovers: readdirSync(dir).filter((f) => f.startsWith('target.ts.')) };
  }
  const body = real.split('\n').slice(2).join('\n');
  it('partial output and exit 124 (a time-out): non-zero, no success message, the target byte-identical, no temporary file left', () => {
    const r = gen(body.split('\n').slice(0, 598).join('\n') + '\n', 124);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain('wrote');
    expect([r.after, r.leftovers]).toEqual([r.before, []]);
  });
  it('a generator that exits non-zero fails whatever it printed; one that exits 0 without the Database type fails too', () => {
    expect(gen(body, 1).code).not.toBe(0);
    const junk = gen('Error: connection refused\n', 0);
    expect([junk.code, junk.after, junk.leftovers]).toEqual([1, junk.before, []]);
  });
  it('a complete run writes the file (header plus the generator output)', () => {
    const r = gen(body, 0);
    expect([r.code, r.after]).toEqual([0, real]);
  });
});
