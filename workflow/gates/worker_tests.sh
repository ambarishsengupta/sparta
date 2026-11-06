#!/usr/bin/env bash
# worker_tests: the worker's pytest suite (WO-0072, R5b CC3). Uses the virtualenv python named by SPARTA_VENV_PYTHON in workflow/local.env
# (git-ignored); without it (CI, a fresh clone) prints SKIPPED and exits 0, like db_tests. The tests marked `db` need the LOCAL Supabase stack:
# when it is not running they are deselected and the line "DB tests SKIPPED" is printed (never silently). Hard time limit 600 seconds.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

PY="${SPARTA_VENV_PYTHON:-}"
if [ -z "$PY" ] && [ -f workflow/local.env ]; then
  PY="$(sed -n 's/^SPARTA_VENV_PYTHON=//p' workflow/local.env | head -n1)"
fi
if [ -z "$PY" ] || [ ! -x "$PY" ] || ! "$PY" -c "import pytest, fastapi, psycopg, onnxruntime, PIL" >/dev/null 2>&1; then
  echo "SKIPPED: no Python virtualenv with the worker requirements (set SPARTA_VENV_PYTHON in workflow/local.env; see services/worker/README.md); the worker tests were not run."
  exit 0
fi

args=()
if ! supabase status >/dev/null 2>&1; then
  echo "DB tests SKIPPED: the local Supabase stack is not running; running the other worker tests only."
  args=(-m "not db")
fi
cd services/worker || exit 2
export PYTHONDONTWRITEBYTECODE=1
if command -v timeout >/dev/null 2>&1; then timeout 600 "$PY" -m pytest ${args[@]+"${args[@]}"}; else "$PY" -m pytest ${args[@]+"${args[@]}"}; fi
