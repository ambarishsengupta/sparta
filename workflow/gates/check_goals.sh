#!/usr/bin/env bash
# Standing-goal check: runs the predicate of every workflow/goals/*.md from the repo root,
# prints holding or VIOLATED, updates the Status: and Last pass: lines in place, and exits 1
# if any predicate fails. It surfaces breakage and never fixes anything.
#
# Recursion guard: gate.sh exports SPARTA_GATE_ACTIVE=1; while it is set, predicates that start
# with `bash workflow/gates/gate.sh` are skipped (the gate is already running them).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

TODAY="$(date +%Y-%m-%d)"
FAIL=0
COUNT=0

set_field() { # file field value  (rewrites the first "Field:" line in place)
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, field, value = sys.argv[1:4]
lines = open(path, encoding='utf-8').read().split('\n')
for n, line in enumerate(lines):
    if line.startswith(field + ':'):
        lines[n] = f'{field}: {value}'
        break
open(path, 'w', encoding='utf-8').write('\n'.join(lines))
PY
}

shopt -s nullglob
for goal in workflow/goals/*.md; do
  COUNT=$((COUNT + 1))
  line="$(grep -m1 '^Predicate:' "$goal" || true)"
  predicate="${line#*\`}"; predicate="${predicate%\`*}"
  if [ -z "$line" ] || [ "$predicate" = "$line" ] || [ -z "$predicate" ]; then
    echo "VIOLATED  $goal (no Predicate: line with a backtick-quoted command)"
    FAIL=1
    continue
  fi
  if [ "${SPARTA_GATE_ACTIVE:-}" = "1" ] && [[ "$predicate" == "bash workflow/gates/gate.sh"* ]]; then
    echo "skipped   $goal (the gate is already running; predicate: $predicate)"
    continue
  fi
  if bash -c "$predicate"; then
    echo "holding   $goal"
    set_field "$goal" Status holding
    set_field "$goal" "Last pass" "$TODAY"
  else
    echo "VIOLATED  $goal (predicate: $predicate)"
    set_field "$goal" Status violated
    FAIL=1
  fi
done

echo "check_goals: ${COUNT} goal file(s), $([ "$FAIL" -eq 0 ] && echo 'none violated' || echo 'VIOLATION FOUND')"
exit "$FAIL"
