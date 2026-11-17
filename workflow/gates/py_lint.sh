#!/usr/bin/env bash
# py_lint (WO-0129): ruff (pyflakes F, bugbear B, bandit S) over services, jobs, ml and workflow, with the configuration in
# workflow/gates/ruff.toml (existing findings are listed there per file; py_lint.test.ts counts them, so they can only shrink).
# Uses the virtualenv python named by SPARTA_VENV_PYTHON in workflow/local.env (git-ignored); without it (CI, a fresh clone) prints SKIPPED
# and exits 0, like worker_tests, so a strict gate fails the stage. A ruff that fails, or that is not installed, FAILS the stage
# (repo_lint RL14): its exit status is used and its error output is kept. Hard time limit 120 seconds. No autofix: ruff is never given --fix.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

PY="${SPARTA_VENV_PYTHON:-}"
if [ -z "$PY" ] && [ -f workflow/local.env ]; then
  PY="$(sed -n 's/^SPARTA_VENV_PYTHON=//p' workflow/local.env | head -n1)"
fi
if [ -z "$PY" ] || [ ! -x "$PY" ]; then
  echo "SKIPPED: no Python virtualenv (set SPARTA_VENV_PYTHON in workflow/local.env; see services/worker/README.md); ruff was not run."
  exit 0
fi
if ! "$PY" -m ruff --version >/dev/null 2>&1; then
  echo "py_lint: FAIL, ruff is not installed in the virtualenv; run: \"$PY\" -m pip install -r services/worker/requirements-dev.txt"
  exit 1
fi
limited() { if command -v timeout >/dev/null 2>&1; then timeout 120 "$@"; else perl -e 'alarm shift; exec @ARGV' 120 "$@"; fi; }
export PYTHONDONTWRITEBYTECODE=1
limited "$PY" -m ruff check --config workflow/gates/ruff.toml --no-cache --ignore-noqa --output-format concise "$@" services jobs ml workflow </dev/null
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "py_lint: FAIL, ruff exited with status ${rc} (findings above are new: fix them; do not add them to workflow/gates/ruff.toml)."
  exit 1
fi
echo "py_lint: PASS (ruff F, B, S over services, jobs, ml, workflow; the known findings are listed in workflow/gates/ruff.toml)"
