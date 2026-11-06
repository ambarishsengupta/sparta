#!/usr/bin/env bash
# gate.sh: the deterministic final authority (G2). Every other approval defers to this script.
# Exit 0 = work may be reported complete. Non-zero = not done, no exceptions.
#
# Stages, in order: typecheck, db_tests, worker_tests (pytest in the worker virtualenv; SKIPPED without it), test, lint, web_containment (builds the web app with dummy secrets and scans the bundles; SKIPPED without Node), manifest check, secret scan (BR-43), release map, goals check.
# db_tests runs before test so the vitest database checks see a freshly built database; it prints SKIPPED when
# the local Supabase stack is not running.
# Optional: set GATE_BASE and GATE_WO (and WO_ID if the file holds several work orders) to also
# run the scope check. A failing stage never stops the later stages: nothing is hidden, and the
# script exits 1 if ANY stage failed (including a stage that is missing or crashes).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

# check_goals.sh skips the goal whose predicate is this script, so it cannot recurse.
export SPARTA_GATE_ACTIVE=1

FAIL=0

run_stage() {
  local name="$1"; shift
  echo "=== GATE: ${name} ==="
  if "$@"; then
    echo "--- ${name}: PASS"
  else
    echo "--- ${name}: FAIL"
    FAIL=1
  fi
}

run_stage "clean_dupes" bash workflow/gates/clean_dupes.sh
run_stage "typecheck" npm run typecheck
run_stage "db_tests" bash workflow/gates/db_tests.sh
run_stage "worker_tests" bash workflow/gates/worker_tests.sh
run_stage "test" npm test
run_stage "lint" npm run lint
run_stage "web_containment" bash workflow/gates/web_containment.sh
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
  echo "GATE: FAIL, work is NOT done."
  exit 1
fi

echo "GATE: PASS"
exit 0
