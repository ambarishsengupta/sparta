import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// WO-0129: the py_lint stage (ruff: pyflakes F, bugbear B, bandit S over services, jobs, ml and workflow).
//   - a firing sample: a small bad Python file that ruff, with workflow/gates/ruff.toml, must flag (a `# noqa` comment must not hide it);
//   - the baseline: the findings that existed when the rules were added are listed per file in ruff.toml; they are counted here with exact
//     numbers, so the list can only shrink (lower a number when a finding is fixed and its line is deleted; never raise one);
//   - the script: SKIPPED without the virtualenv, FAIL when ruff is missing, crashes or finds something new.
const SCRIPT = 'workflow/gates/py_lint.sh';
const CONFIG = 'workflow/gates/ruff.toml';
const scratch = mkdtempSync(join(tmpdir(), 'py-lint-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const venvPython = (): string => {
  let py = process.env.SPARTA_VENV_PYTHON ?? '';
  if (!py && existsSync('workflow/local.env')) py = /^SPARTA_VENV_PYTHON=(.*)$/m.exec(readFileSync('workflow/local.env', 'utf8'))?.[1]?.trim() ?? '';
  if (!py || !existsSync(py)) return '';
  return spawnSync(py, ['-m', 'ruff', '--version'], { encoding: 'utf8' }).status === 0 ? py : '';
};
const PY = venvPython();
type Finding = { code: string; filename: string };
const ruffJson = (py: string, args: string[]): Finding[] => {
  const r = spawnSync(py, ['-m', 'ruff', 'check', '--config', CONFIG, '--no-cache', '--ignore-noqa', '--output-format', 'json', ...args], { encoding: 'utf8', timeout: 120_000 });
  expect([0, 1], r.stderr).toContain(r.status);   // 0 clean, 1 findings; anything else is a crash
  return JSON.parse(r.stdout) as Finding[];
};

// Findings that existed on 2026-11-17 (411 in 31 files), per file. Lower a number, never raise one.
const BASELINE: Record<string, number> = {
  'jobs/collector/collector/extract.py': 1,
  'jobs/collector/collector/fetcher.py': 1,
  'jobs/collector/collector/mapping.py': 1,
  'jobs/collector/tests/conftest.py': 4,
  'jobs/collector/tests/test_extract.py': 28,
  'jobs/collector/tests/test_fetcher.py': 33,
  'jobs/collector/tests/test_guard.py': 20,
  'jobs/collector/tests/test_mapping.py': 19,
  'jobs/collector/tests/test_run_db.py': 62,
  'jobs/collector/tests/test_store.py': 9,
  'ml/recommendation-engine/garment/export_onnx.py': 4,
  'ml/recommendation-engine/pairing/build_prior.py': 3,
  'ml/recommendation-engine/pairing/tests/test_maps_and_cleaning.py': 1,
  'ml/recommendation-engine/pairing/tests/test_validate_env_build.py': 1,
  'services/worker/scripts/e2e_local.py': 10,
  'services/worker/tests/conftest.py': 5,
  'services/worker/tests/test_app_and_background.py': 9,
  'services/worker/tests/test_config.py': 7,
  'services/worker/tests/test_db.py': 31,
  'services/worker/tests/test_handler.py': 15,
  'services/worker/tests/test_images.py': 30,
  'services/worker/tests/test_loop_fakes.py': 20,
  'services/worker/tests/test_preprocess_and_garment.py': 22,
  'services/worker/tests/test_storage_urls.py': 15,
  'services/worker/worker/handler.py': 1,
  'services/worker/worker/storage.py': 1,
  'workflow/demo/hm/load_hm_demo_catalog.py': 5,
  'workflow/demo/hm/tests/test_load_hm_demo_catalog.py': 47,
  'workflow/gates/repo_lint.py': 2,
  'workflow/github/setup_github_project.py': 2,
  'workflow/github/sync_github_project.py': 2,
};

describe.skipIf(!PY)('ruff with the project configuration (WO-0129)', () => {
  it('flags an unused import, a mutable default and eval, and a noqa comment hides nothing', () => {
    const file = join(scratch, 'bad.py');
    writeFileSync(file, 'import os  # noqa\n\n\ndef f(x=[]):\n    return eval(x)  # noqa: S307\n');
    const codes = ruffJson(PY, [file]).map((f) => f.code).sort();
    expect(codes).toEqual(['B006', 'F401', 'S307']);
  });

  it('the findings that existed when the rules were added are counted per file, and the list in ruff.toml matches them', () => {
    const found = ruffJson(PY, ['--config', 'lint.per-file-ignores={}', 'services', 'jobs', 'ml', 'workflow']);
    const perFile: Record<string, number> = {};
    const codes: Record<string, Set<string>> = {};
    for (const f of found) {
      const rel = f.filename.slice(process.cwd().length + 1);
      perFile[rel] = (perFile[rel] ?? 0) + 1;
      (codes[rel] ??= new Set()).add(f.code);
    }
    expect(perFile).toEqual(BASELINE);
    expect(Object.values(perFile).reduce((a, b) => a + b, 0)).toBe(411);
    const toml = readFileSync(CONFIG, 'utf8');
    const listed = Object.fromEntries([...toml.matchAll(/^"([^"]+)" = \[([^\]]*)\]$/gm)].map((m) => [m[1]!, [...m[2]!.matchAll(/"([^"]+)"/g)].map((c) => c[1]!).sort()]));
    expect(listed).toEqual(Object.fromEntries(Object.entries(codes).map(([k, v]) => [k, [...v].sort()])));
  });

  it('the real run over the four folders is clean once the listed findings are set aside', () => {
    expect(ruffJson(PY, ['services', 'jobs', 'ml', 'workflow'])).toEqual([]);
  });
});

describe('ruff.toml (WO-0129)', () => {
  it('selects exactly the pyflakes, bugbear and bandit sets and ignores nothing globally', () => {
    const toml = readFileSync(CONFIG, 'utf8');
    expect(toml).toMatch(/^select = \["F", "B", "S"\]$/m);
    expect(toml).not.toMatch(/^\s*(ignore|extend-ignore)\s*=/m);
  });
});

// A stub `python`: `-m ruff --version` answers as asked; `-m ruff check` prints and exits as asked.
function run(o: { venv?: boolean; ruffInstalled?: boolean; out?: string; exit?: number }) {
  const dir = mkdtempSync(join(scratch, 'run-'));
  const py = join(dir, 'python');
  writeFileSync(py, `#!/bin/sh\ncase "$3" in\n--version) exit ${o.ruffInstalled === false ? 1 : 0};;\ncheck) printf '%s\\n' "${o.out ?? ''}"; exit ${o.exit ?? 0};;\nesac\n`);
  chmodSync(py, 0o755);
  const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: { ...process.env, SPARTA_VENV_PYTHON: o.venv === false ? join(dir, 'missing') : py }, timeout: 60_000 });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe('py_lint.sh (WO-0129)', () => {
  it('prints SKIPPED and exits 0 without the virtualenv, so a strict gate fails the stage', () => {
    const r = run({ venv: false });
    expect([r.code, r.out.includes('SKIPPED')]).toEqual([0, true]);
    expect(r.out).not.toContain('PASS');
  });

  it('FAILS when ruff is not installed in the virtualenv', () => {
    const r = run({ ruffInstalled: false });
    expect(r.code).toBe(1);
    expect(r.out).toContain('py_lint: FAIL, ruff is not installed');
  });

  it('FAILS when ruff reports a finding or crashes, and shows what it printed', () => {
    const r = run({ out: 'services/worker/x.py:1:1: F401 `os` imported but unused', exit: 1 });
    expect(r.code).toBe(1);
    expect(r.out).toContain('F401');
    expect(r.out).toContain('py_lint: FAIL, ruff exited with status 1');
    expect(r.out).not.toContain('PASS');
    expect(run({ out: 'ruff failed', exit: 2 }).code).toBe(1);
  });

  it('passes when ruff exits 0', () => {
    const r = run({});
    expect([r.code, r.out.includes('py_lint: PASS')]).toEqual([0, true]);
  });

  it('is a stage of gate.sh, after repo_lint', () => {
    const gate = readFileSync('workflow/gates/gate.sh', 'utf8');
    const stages = [...gate.matchAll(/^run_stage "(\w+)"/gm)].map((m) => m[1]!);
    expect(stages.indexOf('py_lint')).toBe(stages.indexOf('repo_lint') + 1);
    expect(gate).toContain('run_stage "py_lint" bash workflow/gates/py_lint.sh');
    const code = readFileSync(SCRIPT, 'utf8').split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
    expect(code).not.toMatch(/--fix|ruff format/);   // an autofix would change files outside the work order
  });
});
