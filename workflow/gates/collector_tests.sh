#!/usr/bin/env bash
# collector_tests: the collector's pytest suite (WO-0086, R6c CC8). Same virtualenv rule as worker_tests: SPARTA_VENV_PYTHON from the
# environment or workflow/local.env (git-ignored); without it prints SKIPPED and exits 0. The tests talk only to a local test server on
# 127.0.0.1 and refuse any other host. Tests marked `db` (WO-0087) need the LOCAL Supabase stack and are deselected, with a printed line,
# when it is not running. Hard time limit 300 seconds.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

PY="${SPARTA_VENV_PYTHON:-}"
if [ -z "$PY" ] && [ -f workflow/local.env ]; then
  PY="$(sed -n 's/^SPARTA_VENV_PYTHON=//p' workflow/local.env | head -n1)"
fi
if [ -z "$PY" ] || [ ! -x "$PY" ] || ! "$PY" -c "import pytest" >/dev/null 2>&1; then
  echo "SKIPPED: no Python virtualenv with pytest (set SPARTA_VENV_PYTHON in workflow/local.env; see services/worker/README.md); the collector tests were not run."
  exit 0
fi

args=()
if ! supabase status >/dev/null 2>&1; then
  echo "DB tests SKIPPED: the local Supabase stack is not running; running the other collector tests only."
  args=(-m "not db")
fi
cd jobs/collector || exit 2
export PYTHONDONTWRITEBYTECODE=1
if command -v timeout >/dev/null 2>&1; then timeout 300 "$PY" -m pytest ${args[@]+"${args[@]}"}; else "$PY" -m pytest ${args[@]+"${args[@]}"}; fi
