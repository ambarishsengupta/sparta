import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WO-0123: the non-JavaScript lint (tracked files, H&M rows, Python, SQL, Docker, workflows, work items).
const run = (...args: string[]) => spawnSync('python3', ['workflow/gates/repo_lint.py', ...args], { encoding: 'utf8' });
interface Entry { rule: string; path: string; reason?: string; work_order?: string }
const baseline = JSON.parse(readFileSync('workflow/gates/repo_lint.baseline.json', 'utf8')) as { allow: Entry[]; baseline: Entry[] };

describe('repo_lint', () => {
  it('passes on the repository', () => {
    const r = run();
    expect(r.stdout).toContain('repo_lint: PASS');
    expect(r.status).toBe(0);
  });

  it('every rule fires on a bad sample and stays quiet on a good one (--selftest)', () => {
    const r = run('--selftest');
    expect(r.stdout).toMatch(/repo_lint selftest: \d+ samples over 9 rules, 0 failure\(s\)/);
    expect(r.status).toBe(0);
  });

  it('every exception gives a reason, and every baseline entry names a work order of the audit', () => {
    for (const e of baseline.allow) expect((e.reason ?? '').length, `${e.rule} ${e.path}`).toBeGreaterThan(20);
    const audit = readFileSync('workflow/work-orders/Audit.md', 'utf8');
    for (const e of baseline.baseline) {
      expect(e.work_order, `${e.rule} ${e.path}`).toMatch(/^WO-\d{4}$/);
      expect(audit, `${e.work_order} is defined in Audit.md`).toContain(`# Work Order ${e.work_order}:`);
    }
  });

  it('the lists may only shrink: no secret, env or key file is ever an exception, and the counts do not grow', () => {
    const all = [...baseline.allow, ...baseline.baseline];
    expect(all.filter((e) => /\.env|\.pem$|\.key$|secret|password/i.test(e.path))).toEqual([]);
    expect(all.filter((e) => e.rule === 'RL04' || e.rule === 'RL05' || e.rule === 'RL09')).toEqual([]);
    expect(baseline.allow.length).toBeLessThanOrEqual(13);
    expect(baseline.baseline.length).toBe(0);   // WO-0127 removed the last two (RL07 base image, RL08 actions); a new entry needs a work order and this number
  });
});
