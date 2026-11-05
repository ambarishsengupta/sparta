#!/usr/bin/env bash
# clean_dupes.sh: delete cloud-sync conflict copies such as "package 2.json" or "page 3.tsx".
# Only untracked files whose original (the same name without " N") exists are removed; nothing else is touched.
# Run at the start of every gate: the copies break source scans and typecheck (seen repeatedly in the build).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
n=0
while IFS= read -r f; do
  o=$(printf '%s' "$f" | sed -E 's/ [0-9]+(\.[A-Za-z0-9]+)?$/\1/')
  if [ "$o" != "$f" ] && [ -e "$o" ] && ! git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
    rm -f -- "$f"; n=$((n+1))
  fi
done < <(find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./apps/web/.next -prune -o -type f -print | grep -E " [0-9]+(\.[A-Za-z0-9]+)?$")
echo "clean_dupes: removed $n duplicate copies"
