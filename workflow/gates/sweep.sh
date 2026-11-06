#!/usr/bin/env bash
# sweep.sh: list (and optionally stop) background work that has no owner.
# Usage: bash workflow/gates/sweep.sh            list only, exit 1 if strays are found
#        bash workflow/gates/sweep.sh --kill     stop strays, then list again
# Strays: dev/production web servers (next start/dev), ANY wait loop (until ..., while true, pgrep -f polling: note `pgrep -f X`
# matches its own shell, so such a loop never ends), tail -f on logs,
# long sleeps, node/vitest runs older than 30 minutes. The local Supabase containers and the Colima VM
# are NOT strays (the database work needs them): they are only listed.
set -uo pipefail
PAT='next start|next dev|until |while true|while \[|tail -f|sleep [0-9]{3,}|vitest --watch|inotifywait|pgrep -f'
list() { ps -axo pid,etime,command | grep -E "$PAT" | grep -vE "grep -E|sweep.sh|ps -axo" | cut -c1-160 || true; }
if [ "${1:-}" = "--kill" ]; then
  list | awk '{print $1}' | while read -r p; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  sleep 1
fi
# Any agent-launched shell command still running after 30 minutes is a stray (a `cat` waiting on stdin, a wait loop, a hung test).
# Agent shells are the processes whose command starts with "/bin/zsh -c source ...shell-snapshots".
old_shells() { ps -axo pid,etime,command | awk '$3 == "/bin/zsh" && $4 == "-c" && /shell-snapshots/ && ($2 ~ /^[0-9]+-/ || $2 ~ /^[0-9]+:[0-9]+:[0-9]+$/ || $2 ~ /^([3-9][0-9]|[1-9][0-9][0-9]+):/) {print $1, $2}'; }
if [ "${1:-}" = "--kill" ]; then
  old_shells | while read -r p e; do pkill -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; done
fi
oldlist="$(old_shells)"
strays="$(list)"
if [ -n "$oldlist" ]; then strays="${strays}${strays:+
}agent shell commands older than 30 minutes (pid elapsed):
$oldlist"; fi
echo "== strays (processes) =="; [ -n "$strays" ] && echo "$strays" || echo "none"
echo "== listening web ports (3000-3399) =="; lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E ":3[0-3][0-9]{2}\b" || echo "none"
echo "== local stack (kept on purpose) =="; docker ps --format '{{.Names}}' 2>/dev/null | wc -l | xargs echo "containers running:"
echo "== scratch clones =="; ls -d /private/tmp/r[0-9]*qc* 2>/dev/null || echo "none"
[ -z "$strays" ]
