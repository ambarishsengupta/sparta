#!/usr/bin/env bash
# db_lint (WO-0123): runs the Supabase database linter (plpgsql_check) on the LOCAL stack and compares what it reports with
# workflow/gates/db_lint.baseline.json. A finding that is not in the baseline FAILS the stage; so does a baseline entry the linter no
# longer reports (delete it: the list may only shrink). Without the local stack or the CLI it prints SKIPPED and exits 0, like db_tests.
# No --linked and no --db-url: it can only reach the local stack. Hard time limit 180 seconds (rule 11).
# A linter that fails, or that prints no result, FAILS the stage (WO-0149, repo_lint RL14): until then its error output was thrown away and
# "no result" was read as "no finding", so a crashed linter passed. The linter prints {"results": [...]} on stdout also when it finds nothing.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
if ! command -v supabase >/dev/null 2>&1 || ! supabase status >/dev/null 2>&1; then
  echo "SKIPPED: the local Supabase stack is not running; the database linter was not run."
  exit 0
fi
limited() { if command -v timeout >/dev/null 2>&1; then timeout 180 "$@"; else perl -e 'alarm shift; exec @ARGV' 180 "$@"; fi; }
err="$(mktemp "${TMPDIR:-/tmp}/sparta-db-lint.XXXXXX")" || exit 1
trap '[ -n "${err:-}" ] && rm -f "$err"' EXIT
# --output-format json is required: the CLI writes JSON on its own only when it sees an AI agent in the environment (CLAUDECODE,
# AI_AGENT), so the gate passed in a Claude session and failed on every GitHub runner, which got text (found 2026-11-17).
out="$(limited supabase db lint --level warning --output-format json 2>"$err" </dev/null)"; rc=$?
if [ "$rc" -ne 0 ]; then
  echo "db_lint: FAIL, the database linter exited with status ${rc} (its last lines follow); nothing was checked."
  tail -n 15 "$err" | sed 's/^/  | /'
  exit 1
fi
python3 - "$out" <<'PY'
import json, sys
raw = sys.argv[1]
start = raw.find('{"results"')
if start < 0:
    print('db_lint: FAIL, the database linter printed no result ({"results": ...}); nothing was checked.'); sys.exit(1)
try:
    results = json.JSONDecoder().raw_decode(raw[start:])[0].get('results') or []
except ValueError as e:
    print(f'db_lint: FAIL, cannot read the linter output: {e}'); sys.exit(1)
found = {(r.get('function', '?'), i.get('level', '?'), i.get('message', '?')) for r in results for i in r.get('issues', [])}
base = {(e['function'], e['level'], e['message']) for e in json.load(open('workflow/gates/db_lint.baseline.json'))['baseline']}
new, gone = sorted(found - base), sorted(base - found)
for f, level, msg in new: print(f'db_lint NEW {level}: {f}: {msg}')
for f, level, msg in gone: print(f'db_lint: the baseline entry for {f} ({msg[:60]}) is no longer reported: delete it')
if new or gone:
    print(f'db_lint: FAIL ({len(new)} new, {len(gone)} stale baseline entries)'); sys.exit(1)
print(f'db_lint: PASS ({len(found)} known finding(s) in the baseline, 0 new)')
PY
