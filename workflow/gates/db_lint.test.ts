import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// WO-0149: the db_lint stage must tell a linter that found nothing from a linter that did not run. Until this work order the script threw
// the linter's error output away and read "no result" as "no finding" (found by the WO-0128 check). The `supabase` CLI here is a stub:
// `status` answers as asked, `db lint` prints and exits as asked; no database is needed. The real run is the gate.
const SCRIPT = 'workflow/gates/db_lint.sh';
const scratch = mkdtempSync(join(tmpdir(), 'db-lint-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const CLEAN = '{"results":[],"message":"db lint","target":{"kind":"local","host":"127.0.0.1","port":54322}}';
const finding = (fn: string, level: string, message: string) => JSON.stringify({ results: [{ function: fn, issues: [{ level, message }] }] });

function run(o: { stack?: boolean; stdout?: string; stderr?: string; exit?: number }) {
  const dir = mkdtempSync(join(scratch, 'run-'));
  writeFileSync(join(dir, 'stdout'), o.stdout ?? '');
  writeFileSync(join(dir, 'stderr'), o.stderr ?? '');
  const stub = `#!/bin/sh\ncase "$1" in\nstatus) exit ${o.stack === false ? 1 : 0};;\ndb) cat "${join(dir, 'stdout')}"; cat "${join(dir, 'stderr')}" >&2; exit ${o.exit ?? 0};;\nesac\n`;
  writeFileSync(join(dir, 'supabase'), stub);
  chmodSync(join(dir, 'supabase'), 0o755);
  const tmp = mkdtempSync(join(dir, 'tmp-'));
  const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TMPDIR: tmp }, timeout: 60_000 });
  return { code: r.status, out: r.stdout + r.stderr, left: readdirSync(tmp) };
}

describe('db_lint.sh (WO-0123, WO-0149)', () => {
  it('passes when the linter ran and reports nothing beyond the baseline', () => {
    const baseline = JSON.parse(readFileSync('workflow/gates/db_lint.baseline.json', 'utf8')) as { baseline: unknown[] };
    expect(baseline.baseline).toEqual([]);   // WO-0128 emptied it; with an entry this test would need that finding in its fixture
    const r = run({ stdout: `Linting schema: app\n${CLEAN}\n`, stderr: 'A new version of Supabase CLI is available\n' });
    expect([r.code, r.out.includes('db_lint: PASS (0 known finding(s) in the baseline, 0 new)')]).toEqual([0, true]);
    expect(r.left).toEqual([]);   // the error-output file is removed
  });

  it('FAILS when the linter crashes, and shows why (it used to pass: no output read as no finding)', () => {
    const r = run({ stdout: '', stderr: 'failed to connect to postgres: connection refused\n', exit: 1 });
    expect(r.code).toBe(1);
    expect(r.out).toContain('db_lint: FAIL, the database linter exited with status 1');
    expect(r.out).toContain('connection refused');
    expect(r.out).not.toContain('PASS');
    expect(r.left).toEqual([]);
  });

  it('FAILS when the linter exits 0 but prints no result, or a result that cannot be read', () => {
    for (const stdout of ['', 'Linting schema: app\n', '{"results": [\n']) {
      const r = run({ stdout });
      expect(r.code, JSON.stringify(stdout)).toBe(1);
      expect(r.out, JSON.stringify(stdout)).toMatch(/db_lint: FAIL, (the database linter printed no result|cannot read the linter output)/);
      expect(r.out).not.toContain('PASS');
    }
  });

  it('FAILS on a finding that is not in the baseline, and names it', () => {
    const r = run({ stdout: finding('app.confirm_receipt', 'warning', 'target type is different type than source type') });
    expect(r.code).toBe(1);
    expect(r.out).toContain('db_lint NEW warning: app.confirm_receipt: target type is different type than source type');
    expect(r.out).toContain('db_lint: FAIL (1 new, 0 stale baseline entries)');
  });

  it('prints SKIPPED and exits 0 without the local stack, so a strict gate fails the stage', () => {
    const r = run({ stack: false, stdout: CLEAN });
    expect([r.code, r.out.includes('SKIPPED')]).toEqual([0, true]);
    expect(r.out).not.toContain('PASS');
  });
});
