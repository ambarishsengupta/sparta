import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// WO-0127: the CI job runs the strict gate on a fresh checkout. This file pins the two things that make that possible and safe:
// the helper that writes the git-ignored role password scripts on a runner (and only there), and the shape of the workflow itself.
const SCRIPT = 'workflow/gates/ci_role_password_scripts.sh';
const ROLES = ['worker', 'collector'] as const;
const scratch = mkdtempSync(join(tmpdir(), 'ci-role-scripts-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Runs the helper with a clean environment, so a GITHUB_ACTIONS value of the machine that runs the tests cannot leak in. */
function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env }, timeout: 30_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const printed = (role: string) => run(['--print', role]);

describe('ci_role_password_scripts.sh (WO-0127)', () => {
  it('prints a script per role that reads the password from the environment and holds no value of its own', () => {
    for (const role of ROLES) {
      const r = printed(role);
      expect(r.code, role).toBe(0);
      const variable = `SPARTA_${role.toUpperCase()}_DB_PASSWORD`;
      expect(r.out).toContain(`pw="\${${variable}:-}"`);
      expect(r.out).toContain(`alter role ${role}_role password '%s';`);
      expect(r.out).toContain(`alter role ${role}_role password null;`);
      expect(r.out).toContain("grep -Eq '^[A-Za-z0-9._~-]{16,128}$'");
      // local stack only: the only way to the database is the local container, never a connection string or a hosted project
      expect(r.out).toContain('docker exec -i "$container" psql');
      expect(r.out).not.toMatch(/postgres(ql)?:\/\/|--db-url|--linked|supabase\.co/);
      // the other role's name never appears: one template, two outputs, nothing mixed up
      expect(r.out).not.toContain(`${role === 'worker' ? 'collector' : 'worker'}_role`);
      expect(r.out.includes('@')).toBe(false);   // no placeholder left behind
    }
    expect(printed('admin').code).toBe(2);
    expect(printed('').code).toBe(2);
  });

  it('prints exactly what a developer machine holds, when the git-ignored copies exist (so the two cannot drift apart)', () => {
    for (const role of ROLES) {
      const local = `supabase/scripts/set-${role}-password.sh`;
      if (existsSync(local)) expect(printed(role).out, local).toBe(readFileSync(local, 'utf8'));
    }
    // and the copies stay out of the repository whatever happens (repo_lint RL04 checks the worker one; both are named in .gitignore)
    const ignore = readFileSync('.gitignore', 'utf8');
    for (const role of ROLES) expect(ignore).toContain(`supabase/scripts/set-${role}-password.sh`);
  });

  it('refuses to write anywhere unless it runs on GitHub Actions', () => {
    const dir = mkdtempSync(join(scratch, 'refuse-'));
    for (const env of [{}, { GITHUB_ACTIONS: 'false' }, { GITHUB_ACTIONS: '1' }, { CI: 'true' }]) {
      const r = run([dir], env);
      expect(r.code, JSON.stringify(env)).toBe(2);
      expect(r.err).toContain('refused');
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it('on a runner writes both scripts, each equal to the printed text, and never overwrites a file that is there', () => {
    const dir = mkdtempSync(join(scratch, 'write-'));
    const r = run([dir], { GITHUB_ACTIONS: 'true' });
    expect(r.code).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(['set-collector-password.sh', 'set-worker-password.sh']);
    for (const role of ROLES) expect(readFileSync(join(dir, `set-${role}-password.sh`), 'utf8')).toBe(printed(role).out);

    const kept = mkdtempSync(join(scratch, 'keep-'));
    writeFileSync(join(kept, 'set-worker-password.sh'), 'mine\n');
    const again = run([kept], { GITHUB_ACTIONS: 'true' });
    expect(again.code).toBe(0);
    expect(again.out).toContain('left as it is');
    expect(readFileSync(join(kept, 'set-worker-password.sh'), 'utf8')).toBe('mine\n');
    expect(readFileSync(join(kept, 'set-collector-password.sh'), 'utf8')).toBe(printed('collector').out);
    expect(readdirSync(kept).sort()).toEqual(['set-collector-password.sh', 'set-worker-password.sh']);   // no temporary file left behind

    expect(run([join(scratch, 'no-such-folder')], { GITHUB_ACTIONS: 'true' }).code).toBe(2);
  });
});

describe('.github/workflows/ci.yml runs the strict gate on a stack it builds itself (WO-0127)', () => {
  const yml = readFileSync('.github/workflows/ci.yml', 'utf8');
  const at = (needle: string) => { const i = yml.indexOf(needle); expect(i, `ci.yml contains: ${needle}`).toBeGreaterThan(-1); return i; };

  it('runs the gate in strict mode, after the stack, the virtualenv and the role helpers exist, within 30 minutes', () => {
    const order = ['npm ci', 'python -m venv', 'supabase start', 'bash workflow/gates/ci_role_password_scripts.sh', 'GATE_STRICT=1 bash workflow/gates/gate.sh'].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(yml).toMatch(/^ {4}timeout-minutes: 30$/m);
    // the gate is never run without strict mode: that is the reduced gate finding A2 was about
    expect(yml.match(/gate\.sh/g)).toHaveLength(1);
    expect(yml).not.toMatch(/continue-on-error|\|\| true/);
  });

  it('gives the gate the interpreter both ways it is read: the environment, and the one line in workflow/local.env', () => {
    expect(yml).toContain('echo "SPARTA_VENV_PYTHON=$RUNNER_TEMP/sparta-venv/bin/python" >> "$GITHUB_ENV"');
    expect(yml).toContain(`printf 'SPARTA_VENV_PYTHON=%s\\n' "$RUNNER_TEMP/sparta-venv/bin/python" > workflow/local.env`);
    // the virtualenv is outside the checkout, and it installs every requirements file the gate's Python stages import from
    for (const f of ['ml/recommendation-engine/requirements.txt', 'services/worker/requirements-dev.txt', 'services/worker/requirements.txt', 'jobs/collector/requirements.txt']) {
      expect(existsSync(f), f).toBe(true);
      expect(yml, f).toContain(`-r ${f}`);
    }
  });

  it('names every action by a commit with its version in a comment, the CLI by a fixed version, and reads no secret', () => {
    const uses = [...yml.matchAll(/^\s*-\s*uses:\s*(\S+)(.*)$/gm)];
    expect(uses.map((m) => m[1]!.split('@')[0])).toEqual(['actions/checkout', 'actions/setup-node', 'actions/setup-python', 'supabase/setup-cli']);
    for (const m of uses) {
      expect(m[1], m[0]).toMatch(/@[0-9a-f]{40}$/);
      expect(m[2], m[0]).toMatch(/^ # v\d+\.\d+\.\d+$/);
    }
    expect(yml).toMatch(/uses: supabase\/setup-cli@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+version: \d+\.\d+\.\d+\n/);
    expect(yml).toContain('persist-credentials: false');
    expect(yml).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(yml).not.toMatch(/secrets\.|pull_request_target|id-token|contents: write/);
  });

  it('declares that a runner holds no dataset folder, and only that declaration on a runner quietens the H&M live check', () => {
    expect(yml).toMatch(/^ {6}SPARTA_NO_LOCAL_DATASETS: '1'$/m);
    const test = readFileSync('supabase/scripts/demo-data.test.ts', 'utf8');
    expect(test).toContain("const noDatasetsByDesign = process.env.GITHUB_ACTIONS === 'true' && process.env.SPARTA_NO_LOCAL_DATASETS === '1';");
    // on every other machine the word stays, so a strict gate without the H&M folder is not called FULL
    expect(test).toContain(": 'SKIPPED: the live check of demo-data.sh --hm needs the local H&M folder (SPARTA_DATA_ROOT_HM).');");
  });
});

describe('services/worker/Dockerfile names its base image by digest (WO-0127)', () => {
  it('has one FROM line, pinned, and the README says how to refresh it', () => {
    const froms = [...readFileSync('services/worker/Dockerfile', 'utf8').matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
    expect(froms).toHaveLength(1);
    expect(froms[0]).toMatch(/^python:3\.13-slim@sha256:[0-9a-f]{64}$/);
    const readme = readFileSync('services/worker/README.md', 'utf8');
    expect(readme).toContain('## Base image');
    expect(readme).toContain('docker images --digests python');
  });
});
