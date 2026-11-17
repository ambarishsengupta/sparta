#!/usr/bin/env bash
# gate.sh: the deterministic final authority (G2). Every other approval defers to this script.
# Exit 0 = work may be reported complete. Non-zero = not done, no exceptions.
#
# Stages, in order: typecheck, db_tests, types_drift (regenerates the database types from the freshly reset local database and fails when they differ from the committed apps/web/lib/supabase/database.types.ts; SKIPPED without the local stack), worker_tests (pytest in the worker virtualenv; SKIPPED without it), collector_tests (pytest for jobs/collector, same virtualenv, local test server only; SKIPPED without it), test (with GATE_STRICT=1: workflow/gates/strict_tests.sh, which runs the live seed checks on their own and then the suites that need the demo insights), lint, web_containment (builds the web app with dummy secrets and scans the bundles; SKIPPED without Node), repo_lint (non-JavaScript lint: tracked files, H&M rows, Python, SQL, Docker, workflows, work items), py_lint (ruff: pyflakes, bugbear and bandit over services, jobs, ml and workflow, known findings listed per file in ruff.toml; SKIPPED without the virtualenv), db_lint (plpgsql checks against a baseline; SKIPPED without the local stack), manifest check, secret scan (BR-43), release map, goals check.
# db_tests runs before test so the vitest database checks see a freshly built database; it prints SKIPPED when
# the local Supabase stack is not running.
# GATE_STRICT=1: a stage that skipped a check fails the gate (required before a merge; see run_stage below).
# Optional: set GATE_BASE and GATE_WO (and WO_ID if the file holds several work orders) to also
# run the scope check. A failing stage never stops the later stages: nothing is hidden, and the
# script exits 1 if ANY stage failed (including a stage that is missing or crashes).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

# Tools that change their output when they see an AI agent (the Supabase CLI writes JSON then, text otherwise) must behave here as on a
# CI runner, so the gate clears the agent-detection variables first: a run inside a Claude session then shows what CI will show.
unset CLAUDECODE AI_AGENT CLAUDE_CODE_ENTRYPOINT

# check_goals.sh skips the goal whose predicate is this script, so it cannot recurse.
export SPARTA_GATE_ACTIVE=1

FAIL=0

SKIPPED=""
LOG="$(mktemp "${TMPDIR:-/tmp}/sparta-gate.XXXXXX")"
trap 'rm -f "$LOG"' EXIT

# A stage that prints a line with the word SKIPPED did not run all of its checks (no local database, no Python virtualenv, no Node).
# Such a stage is listed at the end. With GATE_STRICT=1 it FAILS the gate: a merge into main or a release branch needs GATE_STRICT=1
# (docs/MVP-AGENT-WORKFLOW.md rule 12, WO-0123), because a gate that skipped the database tests proved nothing about the database.
run_stage() {
  local name="$1"; shift
  echo "=== GATE: ${name} ==="
  "$@" 2>&1 | tee "$LOG"
  local rc="${PIPESTATUS[0]}"
  if grep -q "SKIPPED" "$LOG"; then
    SKIPPED="${SKIPPED}${SKIPPED:+, }${name}"
    if [ "${GATE_STRICT:-0}" = "1" ]; then
      echo "--- ${name}: FAIL (a check was SKIPPED and GATE_STRICT=1)"
      FAIL=1
      return
    fi
  fi
  if [ "$rc" -eq 0 ]; then
    echo "--- ${name}: PASS"
  else
    echo "--- ${name}: FAIL"
    FAIL=1
  fi
}

run_stage "clean_dupes" bash workflow/gates/clean_dupes.sh
run_stage "typecheck" npm run typecheck
run_stage "db_tests" bash workflow/gates/db_tests.sh
run_stage "types_drift" bash workflow/gates/types_drift.sh
run_stage "worker_tests" bash workflow/gates/worker_tests.sh
run_stage "collector_tests" bash workflow/gates/collector_tests.sh
TEST_CMD=(npm test); [ "${GATE_STRICT:-0}" = "1" ] && TEST_CMD=(bash workflow/gates/strict_tests.sh)
run_stage "test" "${TEST_CMD[@]}"
run_stage "lint" npm run lint
run_stage "web_containment" bash workflow/gates/web_containment.sh
run_stage "repo_lint" python3 workflow/gates/repo_lint.py
run_stage "py_lint" bash workflow/gates/py_lint.sh
run_stage "db_lint" bash workflow/gates/db_lint.sh
run_stage "manifest_check" node workflow/gates/manifest_check.mjs
run_stage "secret_scan" bash workflow/gates/secret_scan.sh
run_stage "release_map" python3 workflow/gates/release_map.py
run_stage "check_goals" bash workflow/gates/check_goals.sh

if [ -n "${GATE_BASE:-}" ] && [ -n "${GATE_WO:-}" ]; then
  run_stage "scope_check" bash workflow/gates/scope_check.sh "${GATE_BASE}" "${GATE_WO}"
else
  echo "=== GATE: scope_check ==="
  echo "--- scope_check: SKIPPED (set GATE_BASE and GATE_WO to run it)"
fi

if [ "${FAIL}" -ne 0 ]; then
  [ -n "$SKIPPED" ] && echo "GATE: stages with SKIPPED checks: ${SKIPPED}"
  echo "GATE: FAIL, work is NOT done."
  exit 1
fi

if [ -n "$SKIPPED" ]; then
  echo "GATE: PASS (PARTIAL). Stages with SKIPPED checks: ${SKIPPED}. Not valid for a merge: run again with GATE_STRICT=1 and the local stack and virtualenv up."
  exit 0
fi

echo "GATE: PASS (FULL: no stage skipped a check)"
exit 0
