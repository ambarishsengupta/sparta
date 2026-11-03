import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync('bash', ['workflow/gates/scope_check.sh', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

describe('scope_check', () => {
  it('selftest passes: in-scope 0, out-of-scope 1, untracked 1, rename out of scope 1, unknown base ref 2, empty diff 0', () => {
    const r = run(['--selftest']);
    expect(r.stdout).toContain('rename from an out-of-scope path exits 1');
    expect(r.stdout).toContain('unknown base ref exits 2');
    expect(r.stdout).toContain('empty diff (base equals HEAD) exits 0');
    expect(r.stdout).toContain('scope_check selftest: PASS');
    expect(r.status).toBe(0);
  });

  it('selftest ignores a WO_ID inherited from the caller (the gate may run with WO_ID set)', () => {
    const r = run(['--selftest'], { WO_ID: 'WO-0002' });
    expect(r.stdout).toContain('scope_check selftest: PASS');
    expect(r.status).toBe(0);
  });

  it('selftest ignores an inherited GIT_DIR as well', () => {
    const r = run(['--selftest'], { GIT_DIR: '/nonexistent/.git' });
    expect(r.status).toBe(0);
  });

  it('selftest covers the strict parser: semicolons split, parentheticals and NOT created items exit 2', () => {
    const r = run(['--selftest']);
    expect(r.stdout).toContain('semicolon and comma both split items');
    expect(r.stdout).toContain('parenthetical on an item is a parse error');
    expect(r.stdout).toContain('an item naming NOT created is a parse error');
  });

  it('--parse-only prints the scope list of the R1 work orders and exits 0', () => {
    for (const id of ['WO-0003', 'WO-0004', 'WO-0005']) {
      const r = run(['--parse-only', 'workflow/work-orders/R1.md'], { WO_ID: id });
      expect(r.status, `${id}: ${r.stderr}`).toBe(0);
      expect(r.stdout).toContain('package-lock.json');
      expect(r.stdout).toContain('packages/rules/');
    }
  });

  it('--parse-only exits 2 when several work orders match and WO_ID is not set', () => {
    const r = run(['--parse-only', 'workflow/work-orders/R1.md'], { WO_ID: '' });
    expect(r.status).toBe(2);
  });
});
