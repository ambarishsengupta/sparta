import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('scope_check', () => {
  it('selftest passes: in-scope 0, out-of-scope 1, untracked 1, rename out of scope 1, unknown base ref 2', () => {
    const r = spawnSync('bash', ['workflow/gates/scope_check.sh', '--selftest'], { encoding: 'utf8' });
    expect(r.stdout).toContain('rename from an out-of-scope path exits 1');
    expect(r.stdout).toContain('unknown base ref exits 2');
    expect(r.stdout).toContain('scope_check selftest: PASS');
    expect(r.status).toBe(0);
  });
});
