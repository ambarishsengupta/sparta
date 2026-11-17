import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const run = (...args: string[]) =>
  spawnSync('python3', ['workflow/gates/release_map.py', ...args], { encoding: 'utf8' });

describe('release_map', () => {
  it('exits 0 when every FR, NFR and BR id is in exactly one release', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('release_map: PASS');
  });

  it('exits 1 and reports FR-12 missing with --selftest-drop FR-12', () => {
    const r = run('--selftest-drop', 'FR-12');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('MISSING FR-12');
  });
});
