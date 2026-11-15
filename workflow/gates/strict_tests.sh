#!/usr/bin/env bash
# strict_tests (WO-0123, WO-0148): the `test` stage of a GATE_STRICT=1 run. A plain `npm test` skips three kinds of test and still passes; this
# script runs them, in three steps, so that a FULL gate really ran everything this machine can run:
#   1. every suite EXCEPT workflow/gates/db_tests.test.ts, the two vendor suites and build-output.test.ts, without SEED_LIVE (they may use the database together);
#   2. workflow/gates/db_tests.test.ts alone, with SEED_LIVE=1: the live seed checks (they write the demo users to the LOCAL database and remove them
#      again) compare row counts over the whole database, so nothing else may use the database during this step;
#   3. the two vendor suites that need the demo insights: the insights are seeded, the suites run on their own, the seed is removed.
# build-output.test.ts is left to the web_containment stage, which runs it against a real build (SPARTA_REQUIRE_BUILD=1).
# Local stack only (the seed script refuses any other database). Hard time limits (rule 11); the seed is removed on every exit.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
if ! supabase status >/dev/null 2>&1; then
  echo "SKIPPED: the local Supabase stack is not running; the strict test stage needs it."
  exit 0
fi
limited() { local s="$1"; shift; if command -v timeout >/dev/null 2>&1; then timeout -k 10 "$s" "$@" </dev/null; else perl -e 'alarm shift; exec @ARGV' "$s" "$@" </dev/null; fi; }
SEEDED=(apps/web/lib/vendor/dashboard.int.test.ts apps/web/lib/vendor/reports.int.test.ts)
rc=0
echo "strict_tests: 1/3 every suite except the live seed checks"
limited 1500 npx vitest run --exclude workflow/gates/db_tests.test.ts --exclude "${SEEDED[0]}" --exclude "${SEEDED[1]}" --exclude apps/web/lib/server/build-output.test.ts || rc=1
echo "strict_tests: 2/3 the live seed checks, alone"
SEED_LIVE=1 limited 900 npx vitest run workflow/gates/db_tests.test.ts || rc=1
echo "strict_tests: 3/3 the vendor suites against the demo insights"
unseed() { limited 300 bash supabase/scripts/seed-demo-insights.sh --remove >/dev/null 2>&1; }
trap unseed EXIT
if limited 600 bash supabase/scripts/seed-demo-insights.sh >/dev/null 2>&1; then
  limited 900 npx vitest run "${SEEDED[@]}" || rc=1
else
  echo "strict_tests: the demo insights could not be loaded"; rc=1
fi
exit "$rc"
