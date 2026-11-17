#!/usr/bin/env bash
# G2 scope check: fails when the diff touches a path outside the work order's "In scope:" list.
#
# Usage:  bash workflow/gates/scope_check.sh BASE_REF WO_FILE     (env WO_ID picks the work order)
#         bash workflow/gates/scope_check.sh --parse-only WO_FILE (print the scope list; exit 0, or 2 on a parse error)
#         bash workflow/gates/scope_check.sh --selftest
#
# The scope is the comma (or semicolon) separated list on the work order's "In scope:" line, nothing else.
# Commentary goes on a separate "Note:" line, which is never read. An item with a parenthetical or with
# whitespace inside it is a parse error (exit 2): it is never dropped or trimmed, so a path that is only
# partly in scope can not be treated as fully in scope.
#
# Changed paths = `git diff --name-only BASE...HEAD` + modified-uncommitted + untracked files.
# Always allowed: workflow/work-orders/**, workflow/evidence/**, workflow/STATE.md, workflow/goals/**,
# and package-lock.json when package.json is in scope.
set -uo pipefail

# Prints the In scope: items (comma or semicolon separated in the file) one per line, for the chosen
# work order. Exit 2 on a malformed item (printed to stderr), 3 when no single work order is selected.
parse_scope() {
  local wo_file="$1" wo_id="${WO_ID:-}"
  awk -v id="$wo_id" '
    /^# Work Order / { cur = $4; sub(/:$/, "", cur); next }
    /^In scope:/ {
      if (id != "" && cur != id) next
      if (seen) multi = 1
      seen = 1
      line = $0; sub(/^In scope:[ \t]*/, "", line); sub(/[ \t\r]+$/, "", line)
      n = split(line, parts, /[,;]/)
      for (i = 1; i <= n; i++) {
        p = parts[i]; gsub(/^[ \t]+|[ \t]+$/, "", p)
        if (p == "") { printf "scope_check: empty item in the In scope line (stray separator): %s\n", $0 > "/dev/stderr"; bad = 1; continue }
        if (p ~ /[()]/) { printf "scope_check: parenthetical in an In scope item, put commentary on a Note: line: %s\n", p > "/dev/stderr"; bad = 1; continue }
        if (p ~ /[ \t]/) { printf "scope_check: whitespace inside an In scope item (one path or glob per item): %s\n", p > "/dev/stderr"; bad = 1; continue }
        print p
      }
    }
    END { if (bad) exit 2; if (multi) exit 3 }
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
  local base="$1" out
  # --no-renames: a rename must show BOTH the deleted old path and the new path.
  out="$(git diff --no-renames --name-only "${base}...HEAD")" || return 2
  { printf '%s\n' "$out"
    git diff --no-renames --name-only HEAD
    git ls-files --others --exclude-standard
  } | sort -u | sed '/^$/d'
}

check() {
  local base="$1" wo_file="$2"
  git rev-parse --verify --quiet "${base}^{commit}" >/dev/null || { echo "scope_check: unknown base ref $base" >&2; return 2; }
  [ -f "$wo_file" ] || { echo "scope_check: work order file not found: $wo_file" >&2; return 2; }
  local scope rc
  scope="$(parse_scope "$wo_file")"; rc=$?
  if [ "$rc" -eq 3 ]; then echo "scope_check: several 'In scope:' lines in $wo_file; set WO_ID to pick one work order" >&2; return 2; fi
  if [ "$rc" -ne 0 ]; then echo "scope_check: cannot parse the In scope line of $wo_file (WO_ID='${WO_ID:-}')" >&2; return 2; fi
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

  local changed
  changed="$(changed_files "$base")" || { echo "scope_check: cannot diff against base ref $base" >&2; return 2; }

  local violations="" f ok r
  while IFS= read -r f; do
    [ -n "$f" ] || continue   # an empty diff yields one blank line: it is not a path
    ok=0
    for r in "${regexes[@]}"; do
      if printf '%s' "$f" | python3 -c 'import re,sys; sys.exit(0 if re.match(sys.argv[1], sys.stdin.read()) else 1)' "$r"; then ok=1; break; fi
    done
    [ "$ok" -eq 1 ] || violations="${violations}${f}"$'\n'
  done <<< "$changed"

  if [ -n "$violations" ]; then
    echo "scope_check: FAIL, paths outside the work order's In scope list:" >&2
    printf '%s' "$violations" | sed 's/^/  /' >&2
    return 1
  fi
  echo "scope_check: PASS (all changed paths are inside the In scope list)"
  return 0
}

parse_only() {
  local wo_file="$1" out rc
  [ -f "$wo_file" ] || { echo "scope_check: work order file not found: $wo_file" >&2; return 2; }
  out="$(parse_scope "$wo_file")"; rc=$?
  if [ "$rc" -eq 3 ]; then echo "scope_check: several 'In scope:' lines in $wo_file; set WO_ID to pick one work order" >&2; return 2; fi
  if [ "$rc" -ne 0 ]; then return 2; fi
  [ -n "$out" ] || { echo "scope_check: no 'In scope:' line found in $wo_file (WO_ID='${WO_ID:-}')" >&2; return 2; }
  printf '%s\n' "$out"
  return 0
}

selftest() {
  # The selftest builds its own work orders and repo: nothing from the caller's environment may leak in.
  unset WO_ID GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
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
  # rename out of scope: the deleted old path (outside scope) must still be reported
  ( cd "$tmp" && rm -f untracked.txt && mkdir -p other && printf 'moved\n' > other/old.txt && git add -A && git commit -q -m seed-out-of-scope-file )
  ( cd "$tmp" && git checkout -q main && git merge -q --ff-only feature && git branch -f base2 HEAD && git checkout -q -b renamer )
  ( cd "$tmp" && git mv other/old.txt src/moved.txt && git commit -q -m rename-into-scope )
  ( cd "$tmp" && bash "$script" base2 workflow/work-orders/R.md >/dev/null 2>&1 ); out=$?
  if [ "$out" -ne 1 ]; then echo "selftest FAIL: a rename out of scope exited $out, expected 1"; rc=1
  else echo "selftest ok: rename from an out-of-scope path exits 1"; fi
  # unknown base ref must not pass
  ( cd "$tmp" && bash "$script" no-such-ref workflow/work-orders/R.md >/dev/null 2>&1 ); out=$?
  if [ "$out" -ne 2 ]; then echo "selftest FAIL: an unknown base ref exited $out, expected 2"; rc=1
  else echo "selftest ok: unknown base ref exits 2"; fi
  # empty diff: base equal to HEAD must pass, not fail on a blank path
  ( cd "$tmp" && bash "$script" HEAD workflow/work-orders/R.md >/dev/null 2>&1 ); out=$?
  if [ "$out" -ne 0 ]; then echo "selftest FAIL: an empty diff exited $out, expected 0"; rc=1
  else echo "selftest ok: empty diff (base equals HEAD) exits 0"; fi
  # the caller's WO_ID must not change the selftest: an unrelated WO_ID exported to the script is ignored by selftest()
  ( cd "$tmp" && WO_ID=WO-9999 bash "$script" HEAD workflow/work-orders/R.md >/dev/null 2>&1 ); out=$?
  if [ "$out" -ne 2 ]; then echo "selftest FAIL: a WO_ID naming no work order exited $out, expected 2"; rc=1
  else echo "selftest ok: WO_ID naming no work order exits 2"; fi
  # parser: strict, simple. Each case writes a work order file and runs --parse-only.
  local wo="$tmp/parse.md" want
  parse_case() { # label expected_exit expected_first_line_or_empty ; work order text on stdin
    local label="$1" want_rc="$2" want_out="$3" got got_rc
    cat > "$wo"
    got="$(bash "$script" --parse-only "$wo" 2>/dev/null)"; got_rc=$?
    if [ "$got_rc" -ne "$want_rc" ]; then echo "selftest FAIL: $label exited $got_rc, expected $want_rc"; rc=1
    elif [ -n "$want_out" ] && [ "$got" != "$want_out" ]; then echo "selftest FAIL: $label printed [$(printf '%s' "$got" | tr '\n' '|')], expected [$want_out]"; rc=1
    else echo "selftest ok: $label"; fi
  }
  parse_case "semicolon and comma both split items" 0 $'a/**\nb.txt\nc.txt' <<'WO'
# Work Order WO-1: x
In scope: a/**; b.txt, c.txt
WO
  parse_case "Note: line is commentary and is not read" 0 $'a/**' <<'WO'
# Work Order WO-1: x
In scope: a/**
Note: b.txt (not in scope); apps/web is NOT created yet
WO
  parse_case "parenthetical on an item is a parse error" 2 "" <<'WO'
# Work Order WO-1: x
In scope: a/**, .gitignore (append only)
WO
  parse_case "an item naming NOT created is a parse error, not silently dropped" 2 "" <<'WO'
# Work Order WO-1: x
In scope: a/**, apps/web/lib/colour/** is NOT created yet
WO
  parse_case "a stray separator (empty item) is a parse error" 2 "" <<'WO'
# Work Order WO-1: x
In scope: a/**,, b.txt
WO
  parse_case "no In scope line is a parse error" 2 "" <<'WO'
# Work Order WO-1: x
Out of scope: everything.
WO
  parse_case "several work orders without WO_ID is a parse error" 2 "" <<'WO'
# Work Order WO-1: x
In scope: a/**
# Work Order WO-2: y
In scope: b/**
WO
  cat > "$wo" <<'WO'
# Work Order WO-1: x
In scope: a/**
# Work Order WO-2: y
In scope: b/**, package-lock.json
WO
  got="$(WO_ID=WO-2 bash "$script" --parse-only "$wo" 2>/dev/null)"; out=$?
  if [ "$out" -ne 0 ] || [ "$got" != $'b/**\npackage-lock.json' ]; then echo "selftest FAIL: WO_ID=WO-2 did not select the second work order (exit $out)"; rc=1
  else echo "selftest ok: WO_ID selects one work order of several"; fi
  # a malformed In scope line makes the full check exit 2 too (never a silent pass)
  printf '# Work Order WO-1: x\nIn scope: src/** (partly)\n' > "$tmp/workflow/work-orders/bad.md"
  ( cd "$tmp" && bash "$script" main workflow/work-orders/bad.md >/dev/null 2>&1 ); out=$?
  if [ "$out" -ne 2 ]; then echo "selftest FAIL: a malformed In scope line exited $out in the full check, expected 2"; rc=1
  else echo "selftest ok: malformed In scope line exits 2 in the full check"; fi
  cd "$start" && rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "scope_check selftest: PASS"
  return "$rc"
}

if [ "${1:-}" = "--selftest" ]; then selftest; exit $?; fi
if [ "${1:-}" = "--parse-only" ]; then
  if [ "$#" -ne 2 ]; then echo "usage: scope_check.sh --parse-only WO_FILE" >&2; exit 2; fi
  parse_only "$2"; exit $?
fi
if [ "$#" -ne 2 ]; then echo "usage: scope_check.sh BASE_REF WO_FILE | --parse-only WO_FILE | --selftest" >&2; exit 2; fi
check "$1" "$2"
exit $?
