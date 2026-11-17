import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WO-0148: pins the three steps of the strict test stage and their order. These tests never run the stage; the gate does.
const text = readFileSync('workflow/gates/strict_tests.sh', 'utf8');
const gate = readFileSync('workflow/gates/gate.sh', 'utf8');
const at = (marker: string) => text.indexOf(marker);
const lineOf = (marker: string) => text.split('\n').find((l) => l.includes(marker)) ?? '';
const DB = 'workflow/gates/db_tests.test.ts';

describe('strict_tests.sh has three steps, in order', () => {
  it('the markers 1/3, 2/3 and 3/3 appear once each, in order', () => {
    const m = ['strict_tests: 1/3', 'strict_tests: 2/3', 'strict_tests: 3/3'];
    for (const x of m) expect(text.split(x).length - 1).toBe(1);
    expect(at(m[0])).toBeGreaterThan(-1); expect(at(m[0])).toBeLessThan(at(m[1])); expect(at(m[1])).toBeLessThan(at(m[2]));
  });
  it('step 1 excludes the seed checks file and does not set SEED_LIVE', () => {
    const step1 = text.slice(at('strict_tests: 1/3'), at('strict_tests: 2/3'));
    expect(step1).toContain(`--exclude ${DB}`); expect(step1).not.toContain('SEED_LIVE');
    expect(step1).toContain('--exclude apps/web/lib/server/build-output.test.ts'); expect(step1).toMatch(/--exclude "\$\{SEEDED\[0\]\}" --exclude "\$\{SEEDED\[1\]\}"/);
  });
  it('step 2 runs the seed checks file alone with SEED_LIVE=1', () => {
    const step2 = text.slice(at('strict_tests: 2/3'), at('strict_tests: 3/3'));
    expect(step2).toMatch(new RegExp(`SEED_LIVE=1 limited \\d+ npx vitest run --reporter=dot ${DB.replace(/\./g, '\\.')} \\|\\| rc=1`));
    expect(step2).not.toContain('--exclude');
  });
  it('step 3 runs the two vendor suites and SEED_LIVE is set nowhere else', () => {
    expect(text.slice(at('strict_tests: 3/3'))).toContain('npx vitest run --reporter=dot "${SEEDED[@]}"');
    expect(text.match(/SEED_LIVE=1/g)?.length).toBe(2); // one in the header comment, one in step 2
    expect(lineOf('SEED_LIVE=1 limited')).toContain(DB);
  });
});

describe('the script keeps its guards', () => {
  it('removes the seed on every exit and exits non-zero when any step failed', () => {
    expect(text).toContain('trap unseed EXIT'); expect(text).toContain('seed-demo-insights.sh --remove'); expect(text).toContain('exit "$rc"');
    expect((text.match(/\|\| rc=1/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it('prints SKIPPED and exits 0 only when the stack is down, and every step has a time limit', () => {
    expect(text).toContain('SKIPPED: the local Supabase stack is not running');
    expect((text.match(/SKIPPED/g) ?? []).length).toBe(1);
    expect(text).not.toMatch(/pgrep|pkill|until |while |tail -f/);
  });
});

describe('gate.sh', () => {
  it('uses strict_tests.sh for the test stage when GATE_STRICT=1', () => {
    expect(gate).toContain('TEST_CMD=(npm test); [ "${GATE_STRICT:-0}" = "1" ] && TEST_CMD=(bash workflow/gates/strict_tests.sh)');
  });
});

describe('strict_tests.sh output (2026-11-17)', () => {
  it('runs every vitest call with the dot reporter, so no passing test title reaches the gate log', () => {
    const code = readFileSync('workflow/gates/strict_tests.sh', 'utf8').split('\n').filter((l) => !l.trimStart().startsWith('#'));
    const runs = code.filter((l) => l.includes('npx vitest run'));
    expect(runs).toHaveLength(3);
    for (const l of runs) expect(l).toContain('npx vitest run --reporter=dot ');
  });
});
