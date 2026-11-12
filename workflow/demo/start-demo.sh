#!/usr/bin/env bash
# LOCAL DEMO ONLY (WO-0097, Release 0). Builds the web app and starts it on a free local port. Nothing is hosted; nothing is written inside the repository except the Next build folder.
#   bash workflow/demo/start-demo.sh              # accounts mode: needs `supabase start` and `bash supabase/scripts/demo-data.sh` first; sign in with the demo accounts
#   bash workflow/demo/start-demo.sh --no-login   # NEXT_PUBLIC_DATA_BACKEND=local: browser-only backend, no accounts, no vendor portal, no add-by-photo (needs the worker)
#   bash workflow/demo/start-demo.sh --stop       # stops the server this script started
# The local keys come from `supabase status -o env` and live only in the server process environment: never printed, never written to a file. The build and the server run under hard
# timeouts (15 minutes, 2 hours; `timeout` ends the server's whole process group). Readiness is the exit status of a curl request, not a log text. The state (pid, port, mode) is kept in
# one small file in the temp folder and removed by --stop. REFUSED unless the auth API is on 127.0.0.1, localhost or [::1].
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
state="${TMPDIR:-/tmp}/sparta-demo.state"; logf="${TMPDIR:-/tmp}/sparta-demo.log"
die() { echo "start-demo: $*" >&2; exit 1; }
alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

if [ "${1:-}" = "--stop" ]; then
  [ -f "$state" ] || { echo "start-demo: nothing to stop."; exit 0; }
  read -r pid port mode < "$state"
  if alive "$pid"; then
    kill -TERM "$pid" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do alive "$pid" || break; sleep 1; done
    alive "$pid" && kill -KILL "$pid" 2>/dev/null
  fi
  rm -f "$state" "$logf"
  curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/" && die "port $port still answers: stop it by hand." || echo "start-demo: stopped (port $port is free)."; exit 0
fi
nologin=0; case "${1:-}" in --no-login) nologin=1;; "") ;; *) die "usage: start-demo.sh [--no-login | --stop]";; esac
if [ -f "$state" ]; then read -r pid _ < "$state"; alive "$pid" && die "a demo server is already running (bash workflow/demo/start-demo.sh --stop first)."; rm -f "$state"; fi

envs=(NEXT_PUBLIC_DATA_BACKEND=local)
if [ "$nologin" = 0 ]; then
  st="$(supabase status -o env 2>/dev/null)" || die "the local Supabase stack is not running (supabase start)."
  field() { printf '%s\n' "$st" | sed -n "s/^$1=\"\(.*\)\"\$/\1/p"; }   # one NAME="value" line of the status output
  api="$(field API_URL)"; pk="$(field PUBLISHABLE_KEY)"; sk="$(field SECRET_KEY)"; st=""
  printf '%s' "$api" | grep -Eq '^https?://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?$' || die "refusing to run: the auth API must be on 127.0.0.1, localhost or [::1]."
  [ -n "$pk" ] && [ -n "$sk" ] || die "the local stack did not report its keys."
  skn=SUPABASE_SECRET_KEY   # the server-only variable the app reads (Leave the pilot's file removal)
  envs=(NEXT_PUBLIC_DATA_BACKEND=supabase "NEXT_PUBLIC_SUPABASE_URL=$api" "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$pk" "$skn=$sk")
fi
envs+=(NEXT_PUBLIC_CONTACT_EMAIL=demo-contact@example.test "NEXT_PUBLIC_HOSTING_REGION=Local demo machine")

echo "start-demo: building (up to 15 minutes; NEXT_PUBLIC values are fixed at build time, so each mode builds again)..."
(cd apps/web && env "${envs[@]}" timeout 900 npm run build) > "$logf" 2>&1 || { tail -n 25 "$logf" >&2; rm -f "$logf"; die "the build failed."; }
port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')" || die "no free port."
(cd apps/web && exec env "${envs[@]}" timeout 7200 ../../node_modules/.bin/next start -H 127.0.0.1 -p "$port") > "$logf" 2>&1 &
pid=$!
echo "$pid $port $nologin" > "$state"
for _ in $(seq 1 60); do
  curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$port/" && break
  alive "$pid" || { tail -n 15 "$logf" >&2; rm -f "$state" "$logf"; die "the server stopped while starting."; }
  sleep 1
done
curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$port/" || { bash "$0" --stop >/dev/null; die "the server did not answer within 60 seconds (stopped)."; }
echo "start-demo: ready at http://127.0.0.1:$port/  ($([ "$nologin" = 1 ] && echo 'no-login mode' || echo 'accounts mode'); stops by itself after 2 hours; stop now with: bash workflow/demo/start-demo.sh --stop)"
