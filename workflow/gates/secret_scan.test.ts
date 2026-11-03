import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('secret_scan', () => {
  it('selftest passes: fake secrets exit 1 (redacted), a clean dir exits 0', () => {
    const r = spawnSync('bash', ['workflow/gates/secret_scan.sh', '--selftest'], { encoding: 'utf8' });
    expect(r.stdout).toContain('secret_scan selftest: PASS');
    expect(r.status).toBe(0);
  });

  it('selftest covers lower-case assignments (test- and secret- values are not placeholders) and exempt lock files', () => {
    const r = spawnSync('bash', ['workflow/gates/secret_scan.sh', '--selftest'], { encoding: 'utf8' });
    expect(r.stdout).toContain('lower-case secret #3 exits 1');
    expect(r.stdout).toContain('lower-case secret #4 exits 1');
    expect(r.stdout).toContain('unquoted secret in a config file');
    expect(r.stdout).toContain('clean dir exits 0');
    expect(r.stdout).not.toContain('selftest FAIL');
  });

  it('exits 0 on this repository (BR-43)', () => {
    const r = spawnSync('bash', ['workflow/gates/secret_scan.sh'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  });
});
