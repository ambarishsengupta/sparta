#!/usr/bin/env bash
# types_drift (WO-0126, audit finding A6): fails when the committed database types are not what the migrations produce, so a migration cannot land
# without its types. It regenerates the types from the LOCAL stack with supabase/scripts/gen-types.sh into a temporary directory (the repository is
# never written) and compares the result with the committed file. Runs right after db_tests, which has just rebuilt the database from the committed
# migrations (`supabase db reset`); run it by hand only on a database that is in that state.
#
#   bash workflow/gates/types_drift.sh [COMMITTED_FILE]     # default: apps/web/lib/supabase/database.types.ts
#
# Exit 0: the files are identical. Exit 1: they differ (a unified diff is printed, then the two commands that fix it), or the generator failed (a
# failed generator is a failure, not a skip). Without the CLI or the stack it prints SKIPPED and exits 0, like db_tests and db_lint, so GATE_STRICT=1
# fails the gate (gate.sh run_stage) when this check was not run.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
committed="${1:-apps/web/lib/supabase/database.types.ts}"

if ! command -v supabase >/dev/null 2>&1 || ! supabase status >/dev/null 2>&1; then
  echo "SKIPPED: the local Supabase stack is not running (start it with 'supabase start'); the database types were not checked for drift."
  exit 0
fi
if [ ! -f "$committed" ]; then
  echo "types_drift: FAIL: ${committed} does not exist. Run: bash supabase/scripts/gen-types.sh, and commit the file."
  exit 1
fi

dir="$(mktemp -d "${TMPDIR:-/tmp}/sparta-types.XXXXXX")" || { echo "types_drift: cannot make a temporary directory." >&2; exit 2; }
trap 'rm -rf "$dir"' EXIT
if ! bash supabase/scripts/gen-types.sh "${dir}/database.types.ts"; then
  echo "types_drift: FAIL: the types could not be generated from the local database."
  exit 1
fi
if cmp -s "$committed" "${dir}/database.types.ts"; then
  echo "types_drift: PASS: ${committed} matches the local database."
  exit 0
fi
echo "types_drift: FAIL: ${committed} is not what the migrations produce (first lines of the difference, committed file first):"
diff -u "$committed" "${dir}/database.types.ts" | head -n 40
echo "types_drift: a migration changed the schema without its types. Run: supabase db reset && bash supabase/scripts/gen-types.sh, then commit ${committed}."
exit 1
