#!/usr/bin/env bash
# sweep.sh: list (and optionally stop) background work that has no owner.
# Usage: bash workflow/gates/sweep.sh            list only, exit 1 if strays are found
#        bash workflow/gates/sweep.sh --kill     stop strays, then list again
# Strays: dev/production web servers (next start/dev), wait loops (until grep ...), tail -f on logs,
# long sleeps, node/vitest runs older than 30 minutes. The local Supabase containers and the Colima VM
# are NOT strays (the database work needs them): they are only listed.
set -uo pipefail
PAT='next start|next dev|until grep|tail -f|sleep [0-9]{3,}|vitest --watch|inotifywait'
list() { ps -axo pid,etime,command | grep -E "$PAT" | grep -vE "grep -E|sweep.sh" || true; }
if [ "${1:-}" = "--kill" ]; then
  list | awk '{print $1}' | while read -r p; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  sleep 1
fi
strays="$(list)"
echo "== strays (processes) =="; [ -n "$strays" ] && echo "$strays" || echo "none"
echo "== listening web ports (3000-3399) =="; lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E ":3[0-3][0-9]{2}\b" || echo "none"
echo "== local stack (kept on purpose) =="; docker ps --format '{{.Names}}' 2>/dev/null | wc -l | xargs echo "containers running:"
echo "== scratch clones =="; ls -d /private/tmp/r[0-9]*qc* 2>/dev/null || echo "none"
[ -z "$strays" ]
