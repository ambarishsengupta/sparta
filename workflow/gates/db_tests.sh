#!/usr/bin/env bash
# db_tests: the database stage of the gate (R2). If the LOCAL Supabase stack is running, rebuild the database from the
# committed migrations and seed (`supabase db reset`, CC2) and run the pgTAP suite (`supabase test db`, CC3), exiting
# with their status. If the stack is not running (or the CLI is missing), print SKIPPED and exit 0. Neither command is
# given --linked or --db-url, so both can only reach the local stack. The vitest part (CC4) runs in `npm test`.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

if ! supabase status >/dev/null 2>&1; then
  echo "SKIPPED: the local Supabase stack is not running (start it with 'supabase start'); no database tests were run."
  exit 0
fi

supabase db reset || exit $?
supabase test db
