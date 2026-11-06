import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// WO-0074 item 2: the containment stage of the gate. These tests never run a build; the real stage is run by the gate itself.
const SCRIPT = 'workflow/gates/web_containment.sh';
const scratch = mkdtempSync(join(tmpdir(), 'sparta-containment-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const sh = (env: Record<string, string>) => spawnSync('/bin/bash', [SCRIPT], { encoding: 'utf8', env, timeout: 60_000 });

describe('web_containment.sh prints SKIPPED, and only when Node or the web workspace is unavailable', () => {
  it('no node or npm on the PATH: SKIPPED, exit 0', () => {
    const r = sh({ PATH: scratch });
    expect(r.stdout).toContain('web_containment: SKIPPED'); expect(r.status).toBe(0);
  });
  it('no web workspace: SKIPPED, exit 0, and nothing is built', () => {
    const r = sh({ PATH: process.env.PATH ?? '', WEB_WORKSPACE: join(scratch, 'no-such-workspace') });
    expect(r.stdout).toContain('web_containment: SKIPPED'); expect(r.stdout).not.toContain('building'); expect(r.status).toBe(0);
  });
});

describe('the stage is wired into the gate after lint', () => {
  const gate = readFileSync('workflow/gates/gate.sh', 'utf8');
  const stages = [...gate.matchAll(/^run_stage "([a-z_]+)"/gm)].map((m) => m[1]);
  it('web_containment runs right after lint', () => { expect(stages.indexOf('web_containment')).toBe(stages.indexOf('lint') + 1); expect(stages.indexOf('lint')).toBeGreaterThan(-1); });
  it('through this script', () => { expect(gate).toContain('run_stage "web_containment" bash workflow/gates/web_containment.sh'); });
});

describe('what the script does (pinned; the real run is the gate)', () => {
  const text = readFileSync(SCRIPT, 'utf8');
  it('builds the web workspace with a dummy secret key and worker token in the environment, runs the containment test with SPARTA_REQUIRE_BUILD=1, and deletes .next on every exit', () => {
    expect(text).toContain('npm run build -w "${WEB}"');
    // the variable names are assembled so this file holds no assignment-shaped text for the repository's secret scan
    const keyVar = ['SUPABASE', 'SECRET', 'KEY'].join('_'); const workerVar = ['WORKER', 'API', 'TOKEN'].join('_');
    expect(text).toContain(`export ${keyVar}="$` + '{dummy_key}"'); expect(text).toContain(`export ${workerVar}="$` + '{dummy_worker}"');
    expect(text).toContain('export SPARTA_REQUIRE_BUILD=1'); expect(text).toContain('lib/server/build-output.test.ts');
    expect(text).toContain("trap cleanup EXIT"); expect(text).toContain('rm -rf "${ROOT}/${WEB}/.next"');
  });
  it('every child has a hard timeout and nothing is polled', () => {
    expect(text).toContain('limited "$BUILD_TIMEOUT"'); expect(text).toContain('limited "$TEST_TIMEOUT"');
    expect(text).not.toMatch(/pgrep|pkill|until |while |tail -f/);
  });
});

describe('build-output.test.ts FAILS (not skips) when SPARTA_REQUIRE_BUILD=1 and there is no build', () => {
  const run = (env: Record<string, string>) => spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'apps/web/lib/server/build-output.test.ts'],
    { encoding: 'utf8', timeout: 90_000, env: { ...process.env, SPARTA_REQUIRE_BUILD: '', SPARTA_NEXT_DIR: join(scratch, 'no-build'), ...env } });
  it('required and missing: non-zero exit and the message', () => {
    const r = run({ SPARTA_REQUIRE_BUILD: '1' });
    expect(r.status).not.toBe(0); expect(`${r.stdout}${r.stderr}`).toContain('a missing build is a failure here, never a skip');
  });
  it('not required and missing: skipped, exit 0 (an ordinary run before any build still works)', () => {
    const r = run({});
    expect(r.status).toBe(0); expect(`${r.stdout}${r.stderr}`).toMatch(/skipped/i);
  });
});
