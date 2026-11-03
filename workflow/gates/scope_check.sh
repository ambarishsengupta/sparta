#!/usr/bin/env bash
# G2 scope check: fails when the diff touches a path outside the work order's "In scope:" list.
#
# Usage:  bash workflow/gates/scope_check.sh BASE_REF WO_FILE     (env WO_ID picks the work order)
#         bash workflow/gates/scope_check.sh --selftest
#
# Changed paths = `git diff --name-only BASE...HEAD` + modified-uncommitted + untracked files.
# Always allowed: workflow/work-orders/**, workflow/evidence/**, workflow/STATE.md, workflow/goals/**,
# and package-lock.json when package.json is in scope.
set -uo pipefail

# Prints the In scope: items (comma separated in the file) one per line, for the chosen work order.
parse_scope() {
  local wo_file="$1" wo_id="${WO_ID:-}"
  awk -v id="$wo_id" '
    /^# Work Order / { cur = $4; sub(/:$/, "", cur); next }
    /^In scope:/ {
      if (id != "" && cur != id) next
      if (id == "" && seen) { multi = 1 }
      seen = 1
      line = $0; sub(/^In scope:[ \t]*/, "", line)
      n = split(line, parts, /[ \t]*,[ \t]*/)
      for (i = 1; i <= n; i++) { p = parts[i]; if (p ~ /NOT created/) continue; gsub(/^[ \t]+|[ \t]+$/, "", p); sub(/ \(.*\)$/, "", p); if (p != "") print p }
    }
    END { if (multi) exit 3 }
  ' "$wo_file"
}

# glob -> anchored regex ('**' crosses directories, '*' does not)
glob_to_regex() {
  python3 - "$1" <<'PY'
import re, sys
g = sys.argv[1]
out, i = '', 0
while i < len(g):
    if g.startswith('**/', i): out += '(?:.*/)?'; i += 3
    elif g.startswith('**', i): out += '.*'; i += 2
    elif g[i] == '*': out += '[^/]*'; i += 1
    elif g[i] == '?': out += '[^/]'; i += 1
    else: out += re.escape(g[i]); i += 1
print('^' + out + '$')
PY
}

changed_files() {
  local base="$1"
  { git diff --name-only "${base}...HEAD" 2>/dev/null || git diff --name-only "${base}" HEAD
    git diff --name-only HEAD
    git ls-files --others --exclude-standard
  } | sort -u | sed '/^$/d'
}

check() {
  local base="$1" wo_file="$2"
  [ -f "$wo_file" ] || { echo "scope_check: work order file not found: $wo_file" >&2; return 2; }
  local scope rc
  scope="$(parse_scope "$wo_file")"; rc=$?
  if [ "$rc" -eq 3 ]; then echo "scope_check: several work orders in $wo_file; set WO_ID" >&2; return 2; fi
  [ -n "$scope" ] || { echo "scope_check: no 'In scope:' line found in $wo_file (WO_ID='${WO_ID:-}')" >&2; return 2; }

  local always="workflow/work-orders/**
workflow/evidence/**
workflow/STATE.md
workflow/goals/**"
  local patterns="$scope
$always"
  if printf '%s\n' "$scope" | grep -qx 'package.json'; then patterns="$patterns
package-lock.json"; fi

  local regexes=() p
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    # a bare directory name allows everything beneath it
    case "$p" in */) p="${p}**";; esac
    regexes+=("$(glob_to_regex "$p")")
  done <<< "$patterns"

  local violations="" f ok r
  while IFS= read -r f; do
    ok=0
    for r in "${regexes[@]}"; do
      if printf '%s' "$f" | python3 -c 'import re,sys; sys.exit(0 if re.match(sys.argv[1], sys.stdin.read()) else 1)' "$r"; then ok=1; break; fi
    done
    [ "$ok" -eq 1 ] || violations="${violations}${f}"$'\n'
  done < <(changed_files "$base")

  if [ -n "$violations" ]; then
    echo "scope_check: FAIL, paths outside the work order's In scope list:" >&2
    printf '%s' "$violations" | sed 's/^/  /' >&2
    return 1
  fi
  echo "scope_check: PASS (all changed paths are inside the In scope list)"
  return 0
}

selftest() {
  local tmp start rc=0
  start="$(pwd)"
  tmp="$(mktemp -d)"
  local script; script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  (
    set -e
    cd "$tmp"
    git init -q . && git config user.email t@example.com && git config user.name t
    mkdir -p src other workflow/work-orders
    printf 'a\n' > src/a.txt
    cat > workflow/work-orders/R.md <<'WO'
# Work Order WO-1: demo
In scope: src/**, README.md
Out of scope: everything else.
WO
    git add -A && git commit -q -m base && git branch -M main
    git checkout -q -b feature
    printf 'b\n' > src/b.txt; printf 'r\n' > README.md
    git add -A && git commit -q -m inside
  )
  if ! ( cd "$tmp" && bash "$script" main workflow/work-orders/R.md >/dev/null 2>&1 ); then
    echo "selftest FAIL: an in-scope diff was rejected"; rc=1
  else echo "selftest ok: in-scope diff exits 0"; fi
  ( cd "$tmp" && printf 'x\n' > other/c.txt && git add -A && git commit -q -m outside )
  ( cd "$tmp" && bash "$script" main workflow/work-orders/R.md >/dev/null 2>&1 ); local out=$?
  if [ "$out" -ne 1 ]; then echo "selftest FAIL: an out-of-scope diff exited $out, expected 1"; rc=1
  else echo "selftest ok: out-of-scope diff exits 1"; fi
  ( cd "$tmp" && git reset -q --hard HEAD~1 && printf 'u\n' > untracked.txt )
  ( cd "$tmp" && bash "$script" main workflow/work-orders/R.md >/dev/null 2>&1 ); out=$?
  if [ "$out" -ne 1 ]; then echo "selftest FAIL: an untracked out-of-scope file exited $out, expected 1"; rc=1
  else echo "selftest ok: untracked out-of-scope file exits 1"; fi
  cd "$start" && rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "scope_check selftest: PASS"
  return "$rc"
}

if [ "${1:-}" = "--selftest" ]; then selftest; exit $?; fi
if [ "$#" -ne 2 ]; then echo "usage: scope_check.sh BASE_REF WO_FILE | --selftest" >&2; exit 2; fi
check "$1" "$2"
exit $?
