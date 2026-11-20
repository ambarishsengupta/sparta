#!/usr/bin/env bash
# LOCAL LOAD CHECK (WO-0165, Release 8b; NFR-7 and BR-42; LLD 14 M6; HLD 6.4). Loads SYNTHETIC data at the pilot's size into the LOCAL database, measures it and removes it again:
# 500 consumers (loadcheck-001@example.test .. loadcheck-500@example.test, auth rows by SQL, no password) with 100 items each (50,000 items), 10 wishlist entries and 30 purchases each,
# from a fixed seed (load-check.sql). It then times, as one signed-in synthetic user under RLS, the wardrobe first page, a filtered list and the item count with explain (analyze); times
# one analytics.run_aggregation() inside a transaction that is ROLLED BACK (the function runs in the caller's transaction, so no snapshot is needed); reads pg_database_size; and prints a
# report in which every line is labelled [measured], [computed] or [assumed]. The hosted limits are NOT measured here: they are assumptions from HLD 6.4 and the report says so.
#
#   bash supabase/scripts/load-check.sh [DATABASE_URL]    # default: postgresql://postgres:postgres@127.0.0.1:54322/postgres
#   bash supabase/scripts/load-check.sh --remove          # removes the rows of an interrupted earlier run (and nothing else)
# The URL may also come from SPARTA_LOAD_DB_URL. It is REFUSED unless its host is 127.0.0.1, localhost or [::1] (no query string, no other host). Never --linked, never a hosted project.
# LOAD_CHECK_MAX_MS (default 3000) is the per-query limit: NFR-3's 3-second screen budget used as an upper bound; the break-check sets it to 1 (or 0.1, since the queries take well under 1 ms on the local stack).
# Exit 0: every query within the limit, database size within 80% of the assumed 500 MB, the aggregation ok, and the counts and the cube checksum equal before and after.
# Exit 1: a limit passed, a step failed, or the database was not left as found. Exit 2: refused (non-local URL, bad limit, or rows of an earlier run still present).
# Uses psql when it is installed, else `docker exec` into the local stack's database container. Hard time limits per step (60 + 300 + 300 + LOAD_CHECK_AGG_SECONDS (default 600, at most 1800) + 300 + 60 seconds at most);
# the rows it created are removed on EVERY exit (trap), including a failure, a timeout, Ctrl-C and a kill. No secret is read or printed; the URL is never printed.
set -uo pipefail
# libpq reads these and can send a connection anywhere the URL does not say: none of them reaches psql or docker
unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGSYSCONFDIR PGDATABASE PGUSER PGPASSFILE PGPASSWORD PGSSLMODE PGOPTIONS PGAPPNAME PGPASSFILE PGTARGETSESSIONATTRS PGCONNECT_TIMEOUT
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
mode="check"; if [ "${1:-}" = "--remove" ]; then mode="remove"; shift; fi
url="${1:-${SPARTA_LOAD_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}}"
url_re='^postgres(ql)?://[^@/?#[:space:]]*@(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?/[A-Za-z0-9_]+$'
if [[ "$url" == *$'\n'* || "$url" == *$'\r'* ]] || ! [[ "$url" =~ $url_re ]]; then
  echo "load-check: refusing to run: the database URL must point at 127.0.0.1, localhost or [::1] (no query string)." >&2; exit 2
fi
max_ms="${LOAD_CHECK_MAX_MS:-3000}"
if ! printf '%s' "$max_ms" | grep -Eq '^[0-9]{1,7}(\.[0-9]{1,3})?$' || ! awk -v a="$max_ms" 'BEGIN { exit !(a + 0 > 0) }'; then
  echo "load-check: refusing to run: LOAD_CHECK_MAX_MS must be a positive number of milliseconds (decimals allowed)." >&2; exit 2
fi
agg_secs="${LOAD_CHECK_AGG_SECONDS:-600}"   # the aggregation is a batch job with its own limit; it is cancelled (and rolled back) when it passes it
if ! [[ "$agg_secs" =~ ^[0-9]{1,4}$ ]] || [ $((10#$agg_secs)) -lt 10 ] || [ $((10#$agg_secs)) -gt 1800 ]; then
  echo "load-check: refusing to run: LOAD_CHECK_AGG_SECONDS must be a whole number from 10 to 1800." >&2; exit 2
fi
agg_secs=$((10#$agg_secs))
poll="${LOAD_CHECK_POLL:-2}"; [[ "$poll" =~ ^[0-9]{1,2}$ ]] || poll=2
app="load-check-$$"   # application_name of every session of this run, so the run can tell whether any of its sessions is still active
sql_file="supabase/scripts/load-check.sql"
project="$(sed -n 's/^project_id *= *"\([^"]*\)".*/\1/p' supabase/config.toml | head -n1)"
limited() { local s="$1"; shift; if command -v timeout >/dev/null 2>&1; then timeout -k 5 "$s" "$@"; else perl -e 'alarm shift; exec @ARGV' "$s" "$@"; fi; }

# quiesce: after any step (finished, failed or timed out) wait, bounded, until no session of this run is active; then end any that is left. Cleanup and the after-snapshot only run when it returns 0.
quiesce() {
  local i n
  for i in 1 2 3 4 5 6 7 8 9 10; do
    n="$(run_sql 20 sessions -v "app=$app" -v kill=f 2>/dev/null)" || n=1
    [ "$n" = "0" ] && return 0
    sleep "$poll"
  done
  run_sql 20 sessions -v "app=$app" -v kill=t >/dev/null 2>&1
  sleep "$poll"
  n="$(run_sql 20 sessions -v "app=$app" -v kill=f 2>/dev/null)" || n=1
  [ "$n" = "0" ]
}

# run_sql <seconds> <phase> [psql -v name=value ...]: the SQL file with one phase switched on; the server-side statement timeout is a little under the client limit, so a killed client leaves no query running
run_sql() {
  local secs="$1" phase="$2"; shift 2
  local ms=$(( (secs - 5) * 1000 ))
  local opts="-c statement_timeout=$ms -c transaction_timeout=$ms -c lock_timeout=20000"   # a transaction (the load is one) is bounded on the SERVER too, even when only the client is killed
  if command -v psql >/dev/null 2>&1; then
    PGAPPNAME="$app" PGOPTIONS="$opts" limited "$secs" psql "$url" -X -v ON_ERROR_STOP=1 -q -At -v "phase=$phase" "$@" -f - < "$sql_file"
  else
    limited "$secs" docker exec -i -e "PGOPTIONS=$opts" -e "PGAPPNAME=$app" "supabase_db_${project:-sparta}" psql -U postgres -X -v ON_ERROR_STOP=1 -q -At -v "phase=$phase" "$@" -f - < "$sql_file"
  fi
}
field() { printf '%s\n' "$1" | tr ' ' '\n' | sed -n "s/^$2=//p" | head -n1; }   # one key=value out of the snapshot line
pick() { printf '%s\n' "$1" | grep "^$2|" | head -n1; }                             # one report line of the SQL output by its tag
over() { awk -v a="$1" -v b="$2" 'BEGIN { exit !(a + 0 > b + 0) }'; }               # true when a > b

if [ "$mode" = "remove" ]; then
  out="$(run_sql 300 cleanup -v sig_day= -v sig_n= -v seq_last= -v seq_called= 2>&1)"; rc=$?
  echo "$out" | tail -n 3
  [ $rc -eq 0 ] && echo "load-check: removed the rows of an earlier run (the sign-up counter of the day they were created lowered by the number of users removed). One writer per stack: do not run two load checks at once."
  exit $rc
fi

if ! before="$(run_sql 60 snapshot 2>&1)" || [ -z "$before" ]; then
  echo "load-check: could not read the local database (is the local Supabase stack running?)." >&2; exit 2
fi
if [ "$(field "$before" leftover)" != "0" ]; then
  echo "load-check: refusing to run: rows of an earlier load check are still in the local database (run: bash supabase/scripts/load-check.sh --remove)." >&2; exit 2
fi

status=0
touched=0
cleaned=0
cleanup() {
  local rc=$status
  trap - EXIT INT TERM
  if [ "$touched" = 1 ] && [ "$cleaned" = 0 ]; then
    cleaned=1
    if ! quiesce; then echo "load-check: a session of this run is still active after the wait; clean-up may be incomplete." >&2; rc=1; fi
    if ! run_sql 300 cleanup -v "sig_day=$(field "$before" signups_day)" -v "sig_n=$(field "$before" signups_n)" -v "seq_last=$(field "$before" seq_last)" -v "seq_called=$(field "$before" seq_called)" >/dev/null 2>&1; then
      echo "load-check: FAILED to remove the rows it created; run: bash supabase/scripts/load-check.sh --remove" >&2; rc=1
    fi
    if after="$(run_sql 60 snapshot 2>&1)" && [ "$after" = "$before" ]; then
      echo "[measured] before/after check: counts and the analytics.cube checksum are EQUAL"
      echo "[measured]   before: $before"
      echo "[measured]   after:  $after"
    else
      echo "load-check: FAIL: the local database was NOT left as found." >&2
      echo "  before: $before" >&2; echo "  after:  ${after:-unreadable}" >&2; rc=1
    fi
  fi
  [ "$rc" = 0 ] && echo "load-check: PASS" || echo "load-check: FAIL (exit $rc)" >&2
  exit "$rc"
}
trap cleanup EXIT
trap 'status=1; exit 1' INT TERM

echo "load-check (LOCAL stack, SYNTHETIC data; no hosted project is read) $(date -u +%Y-%m-%dT%H:%M:%SZ)"
touched=1
if ! load="$(run_sql 300 load 2>&1)"; then
  echo "load-check: the load failed or timed out: $(printf '%s' "$load" | tail -n 2 | cut -c1-300)" >&2; status=1; exit 1
fi
l="$(pick "$load" LOAD)"
IFS='|' read -r _ l_secs l_users l_items l_wish l_purch <<<"$l"
echo "[measured] load: ${l_users:-?} users, ${l_items:-?} items, ${l_wish:-?} wishlist entries, ${l_purch:-?} purchases in ${l_secs:-?} s (fixed seed load-check:v1, one transaction)"
if [ "${l_users:-0}" != 500 ] || [ "${l_items:-0}" != 50000 ]; then echo "load-check: the load did not create 500 users and 50,000 items." >&2; status=1; exit 1; fi

if ! meas="$(run_sql 300 measure 2>&1)"; then
  echo "load-check: the measurement failed or timed out: $(printf '%s' "$meas" | tail -n 2 | cut -c1-300)" >&2; status=1; exit 1
fi

echo "[assumed] per-query limit ${max_ms} ms: NFR-3's 3-second screen budget used as an upper bound (no new requirement); LOAD_CHECK_MAX_MS=${max_ms}"
for name in wardrobe_first_page wardrobe_filtered item_count; do
  q="$(printf '%s\n' "$meas" | grep "^Q|$name|" | head -n1)"
  IFS='|' read -r _ _ cold warm rows idx idxname <<<"$q"
  if [ -z "$q" ] || [ -z "${warm:-}" ]; then echo "load-check: no timing for $name." >&2; status=1; continue; fi
  verdict="within the limit"
  if over "$cold" "$max_ms" || over "$warm" "$max_ms"; then verdict="OVER THE LIMIT"; status=1; fi
  echo "[measured] $name (one user under RLS, explain analyze, planning + execution): first run ${cold} ms, second run ${warm} ms, ${rows} rows returned, index used: ${idx} (${idxname}); ${verdict}"
done

rls="$(pick "$meas" RLS | cut -d'|' -f2)"
if [ "$rls" = "100" ]; then
  echo "[measured] RLS proof: count(*) as the signed-in user = 100 (their own items) while the table holds 50000, so the three timings above are the policy path and not a table scan of everyone's rows"
else
  echo "load-check: RLS proof failed: count(*) as the signed-in user was '${rls:-none}', expected 100." >&2; status=1
fi
if agg="$(run_sql "$agg_secs" aggregate 2>&1)"; then a="$(pick "$agg" AGG)"; else a=""; fi
IFS='|' read -r _ a_ms a_status a_users a_items a_cube a_err <<<"$a"
if [ "${a_status:-}" = "ok" ]; then
  echo "[measured] analytics.run_aggregation() inside a ROLLED-BACK transaction (the function runs in the caller's transaction, so no snapshot was needed): ${a_ms} ms, status ok, ${a_users} users and ${a_items} items included, ${a_cube} cube rows built (all undone by the rollback); aggregation is a batch job, so the screen limit is not applied to it"
elif [ -z "$a" ]; then
  echo "[measured] analytics.run_aggregation() inside a ROLLED-BACK transaction: DID NOT FINISH within ${agg_secs} s at 500 users and 50,000 items (cancelled, rolled back): $(printf '%s' "$agg" | tail -n 2 | tr '\n' ' ' | cut -c1-200)" >&2
  status=1
else
  echo "load-check: the aggregation did not finish ok (status ${a_status:-none}, error ${a_err:--})." >&2; status=1
fi

size="$(pick "$meas" SIZE | cut -d'|' -f2)"
if [ -n "$size" ]; then
  size_mb="$(awk -v b="$size" 'BEGIN { printf "%.1f", b / 1048576 }')"
  limit_mb=400   # 80% of the assumed 500 MB database of the free plan (HLD 6.4)
  verdict="within the limit"; if over "$size_mb" "$limit_mb"; then verdict="OVER THE LIMIT"; status=1; fi
  echo "[measured] database size (pg_database_size, whole local database with the load in it, before clean-up): ${size_mb} MiB"
  echo "[assumed] free-plan database limit 500 MB per project, check at 80% = ${limit_mb} MB (HLD 6.4, Supabase free plan as written there, not read from any hosted project); size ${verdict}"
else
  echo "load-check: no database size read." >&2; status=1
fi

# storage for 500 users from the HLD 6.4 rates (decimal units, as the HLD writes them): images 80 KB and thumbnails 10 KB per item, 10 receipts of 250 KB per user; exports are left out, as in HLD NFR-7
hld="$(awk 'BEGIN { u = 500; r = u * 10 * 250 / 1000; printf "%d %d %d", u * 60 * (80 + 10) / 1000 + r, u * 100 * (80 + 10) / 1000 + r, r }')"
set -- $hld
echo "[computed] file storage for 500 users at the HLD 6.4 rates, 60 items per user: $1 MB (item images 80 KB + thumbnail 10 KB per item, 10 receipts of 250 KB per user; HLD NFR-7 states about 3.7 GB for the same inputs, so this arithmetic is about 7% higher than the HLD's rounded figure); at this check's 100 items per user: $2 MB; no image or receipt was uploaded"
echo "[assumed] free-plan file storage about 1 GB (1000 MB) per organisation (HLD 6.4 and 11): 500 users EXCEED it ($1 MB against 1000 MB), as HLD NFR-7 already states; this line is information and does not change the exit status; the fallbacks are in HLD section 11 and a paid plan needs the owner's approval"
echo "[assumed] hosted limits (5 GB egress a month, pause after 7 days without activity, connection limits) are not measured here: hosted readings are the owner's or the SA's (workflow R8, human)"
exit "$status"
