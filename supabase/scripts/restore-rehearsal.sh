#!/usr/bin/env bash
# LOCAL RESTORE REHEARSAL (WO-0164, Release 8b; NFR-8 "a restore tested once before the pilot starts"; LLD 13.3). On the LOCAL stack only it proves that a backup made by backup.sh as backup_role
# can be decrypted and restored into a FRESH cluster, that the roles and auth.users come back, and that a deletion made after the backup is run again from a copy of ops.deletion_log:
#   1 seed a few SYNTHETIC users (rehearsal-N@example.test) with items on the local stack; 2 make a throwaway age key pair in a mktemp folder outside the repository; 3 as supabase_admin
#   `grant usage on schema auth to backup_role` (only when not held already); 4 set a generated password on backup_role (as postgres) and run backup.sh as backup_role; 5 delete one synthetic
#   user through the self-service path (app.delete_my_account, as a signed-in user with a fresh sign-in); 6 copy ops.deletion_log; 7 start a throwaway container of the SAME supabase/postgres image
#   tag as the running database container, on a free port, ready when pg_isready answers inside it (120 s limit); 8 decrypt and restore into it; 9 run ops.delete_participant again there for every
#   user in the copied log deleted after the backup; 10 check and print: roles exist (backup_role and worker_role included), auth.users count equals the backup's minus the re-deleted users, every
#   `app` table's row count matches the live stack, the deleted user is absent. The last line is `RESTORE REHEARSAL: PASS`.
# On EVERY exit (trap: success, failure, timeout, Ctrl-C, kill): the container is removed, the key folder (and with it the backup file) is removed, the synthetic users and their log rows are removed,
# backup_role's password is cleared, the auth grant is put back as it was found, and the live database is compared with how it was found. Nothing is sent off this machine. Never --linked.
# No password or private key is printed, logged, written in the repository or put on a command line: generated values live in shell variables and in the environment of one command; each session that
# sets or clears a password first sets log_statement and pg_stat_statements.track to 'none' (the local database logs DDL), and the run shows that the container log holds no `alter role ... password`.
#
#   bash supabase/scripts/restore-rehearsal.sh [DATABASE_URL]    # default: postgresql://postgres@127.0.0.1:54322/postgres  (also SPARTA_REHEARSAL_DB_URL)
# The URL is only checked: it must point at 127.0.0.1, localhost or [::1] (no query string); all SQL goes through `docker exec` into the local database container.
# REHEARSAL_WRONG_KEY=1 decrypts with a second, unrelated throwaway key instead (the proof that a wrong key fails); it can only make the run fail, never pass.
# Exit 0: PASS. Exit 1: a step or a check failed, or the live database was not left as found. Exit 2: refused (non-local URL, missing tool, stack not running, leftovers of an earlier run).
set -uo pipefail
# libpq reads these and can send a connection anywhere the URL does not say: none of them reaches docker or backup.sh
unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGSYSCONFDIR PGDATABASE PGUSER PGPASSFILE PGPASSWORD PGSSLMODE PGOPTIONS PGAPPNAME PGTARGETSESSIONATTRS PGCONNECT_TIMEOUT
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
repo="$(pwd -P)"
refuse() { echo "restore-rehearsal: refusing to run: $1" >&2; exit 2; }
# --foreground keeps the child in OUR process group, so Ctrl-C (SIGINT to the group) reaches it and the INT trap runs; -k still sends KILL 5 s after the time limit
limited() { local s="$1"; shift; if command -v timeout >/dev/null 2>&1; then timeout --foreground -k 5 "$s" "$@"; else perl -e 'alarm shift; exec @ARGV' "$s" "$@"; fi; }
now_s() { date +%s; }

url="${1:-${SPARTA_REHEARSAL_DB_URL:-postgresql://postgres@127.0.0.1:54322/postgres}}"
url_re='^postgres(ql)?://[^@/?#[:space:]]*@((127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?)/([A-Za-z0-9_]+)$'
if [[ "$url" == *$'\n'* || "$url" == *$'\r'* ]] || ! [[ "$url" =~ $url_re ]]; then
  refuse "the database URL must point at 127.0.0.1, localhost or [::1] (no query string)."
fi
db_port_part="${BASH_REMATCH[4]}"
live_port="${db_port_part#:}"; live_port="${live_port:-5432}"
for tool in docker age age-keygen; do command -v "$tool" >/dev/null 2>&1 || refuse "$tool is not installed."; done
[ -f supabase/scripts/backup.sh ] || refuse "supabase/scripts/backup.sh is missing."

project="$(sed -n 's/^project_id *= *"\([^"]*\)".*/\1/p' supabase/config.toml | head -n1)"
db_container="supabase_db_${project:-sparta}"
image="$(docker inspect --format '{{.Config.Image}}' "$db_container" 2>/dev/null)" || refuse "the local database container $db_container is not running (supabase start)."
[ -n "$image" ] || refuse "could not read the image of $db_container."
rehearsal="sparta_restore_rehearsal_$$"
mail_re="rehearsal-%@example.test"

# live <role> : SQL on stdin, run in the live container over its local socket (trusted there). Role postgres for data, supabase_admin only for the one auth grant.
live() { limited 60 docker exec -i "$db_container" psql -U "$1" -d postgres -X -q -At -v ON_ERROR_STOP=1; }
LOGOFF="set log_statement = 'none'; set pg_stat_statements.track = 'none';"
gen() { od -An -N16 -tx1 /dev/urandom | tr -d ' \n'; }

APP_COUNTS_SQL="select c.relname || '|' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from app.%I', c.relname), false, true, '')))[1]::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relkind in ('r', 'p') order by c.relname;"
# the data comparison covers every table of app, analytics and analytics_private (WO-0182: backup_role now reads the two analytics schemas); names come out as schema.table
COUNTS_SQL="select n.nspname || '.' || c.relname || '|' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('app', 'analytics', 'analytics_private') and c.relkind in ('r', 'p') order by 1;"
# what must be the same before and after: users, every app table, the deletion log, today's counters, backup_role's password and auth grant
STATE_SQL="select 'users=' || (select count(*) from auth.users)
  || ';log=' || (select count(*) from ops.deletion_log)
  || ';counts=' || (select md5(string_agg(day::text || metric || n::text, ',' order by day, metric)) from ops.daily_counts)
  || ';pw=' || (select (rolpassword is not null)::text from pg_authid where rolname = 'backup_role')
  || ';authgrant=' || has_schema_privilege('backup_role', 'auth', 'usage')::text
  || ';app=' || (select md5(string_agg(t, ',' order by t)) from (${APP_COUNTS_SQL%;}) q(t));"
state() { printf '%s\n' "$STATE_SQL" | live postgres; }

if ! before_state="$(state 2>&1)" || [[ "$before_state" != users=*';authgrant='* ]]; then
  echo "restore-rehearsal: could not read the local database: $(printf '%s' "$before_state" | tail -n 1 | cut -c1-200)" >&2; exit 2
fi
case "$before_state" in *';pw=true;'*) refuse "backup_role already has a password; clear it first (alter role backup_role password null) and run again." ;; esac
left="$(printf "select count(*) from auth.users where email like '%s';\n" "$mail_re" | live postgres 2>&1)" || refuse "could not read auth.users."
[ "$left" = "0" ] || refuse "a synthetic user of an earlier rehearsal is still present (rehearsal-N@example.test); remove it first."
grant_before="$(printf "select has_schema_privilege('backup_role', 'auth', 'usage');\n" | live postgres)" || refuse "could not read the auth grant."
daily_before="$(printf "select coalesce(json_agg(d), '[]'::json) from (select day, metric, n from ops.daily_counts where day = current_date order by metric) d;\n" | live postgres)" || refuse "could not read ops.daily_counts."
start_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

poll=""; keydir=""; container_started=0; pw_set=0; grant_changed=0; seeded=0; done_flag=0; status=1; wrong_label=""
user_ids=()

cleanup() {
  local rc=$status after logn
  trap '' INT TERM
  trap - EXIT
  [ -n "${poll:-}" ] && kill "$poll" 2>/dev/null   # a readiness poll still running (Ctrl-C during the wait)
  if [ "$done_flag" = 0 ]; then
    done_flag=1
    [ "$container_started" = 1 ] && docker rm -f "$rehearsal" >/dev/null 2>&1
    if [ -n "$(docker ps -a --filter "name=${rehearsal}" --format '{{.Names}}' 2>/dev/null)" ]; then echo "restore-rehearsal: the rehearsal container is STILL there" >&2; rc=1; fi
    [ -n "$keydir" ] && rm -rf "$keydir"
    if [ "$pw_set" = 1 ]; then
      printf "%s\nalter role backup_role password null;\n" "$LOGOFF" | live postgres >/dev/null 2>&1 || { echo "restore-rehearsal: FAILED to clear backup_role's password (run: alter role backup_role password null)" >&2; rc=1; }
    fi
    if [ "$grant_changed" = 1 ]; then
      printf "revoke usage on schema auth from backup_role;\n" | live supabase_admin >/dev/null 2>&1 || { echo "restore-rehearsal: FAILED to revoke the auth grant again" >&2; rc=1; }
    fi
    if [ "$seeded" = 1 ]; then
      printf "delete from ops.deletion_log where user_id in (select md5('rehearsal:user:' || g)::uuid from generate_series(1, 3) g);\ndelete from auth.users where email like '%s';\n" "$mail_re" | live postgres >/dev/null 2>&1 || { echo "restore-rehearsal: FAILED to remove the synthetic users" >&2; rc=1; }
      # the deletion counters of today go back to what they were (delete_participant adds one)
      printf "delete from ops.daily_counts where day = current_date;\ninsert into ops.daily_counts (day, metric, n) select current_date, d->>'metric', (d->>'n')::int from json_array_elements('%s'::json) d;\n" "$daily_before" | live postgres >/dev/null 2>&1 \
        || { echo "restore-rehearsal: FAILED to put today's counters back" >&2; rc=1; }
    fi
    if after="$(state 2>&1)" && [ "$after" = "$before_state" ]; then
      echo "left as found: auth.users, ops.deletion_log, today's counters, every app table, backup_role password (none) and the auth grant ($grant_before) are as before; no container, key folder or file left"
    else
      echo "restore-rehearsal: FAIL: the local database was NOT left as found" >&2; rc=1
    fi
    logn="$(docker logs --since "$start_ts" "$db_container" 2>&1 | grep -ci "alter role .* password")"
    echo "container log since the start: 'alter role ... password' lines: ${logn:-?}"
    if [ "${logn:-1}" != "0" ]; then echo "restore-rehearsal: FAIL: a password statement reached the database log" >&2; rc=1; fi
  fi
  if [ "$rc" = 0 ]; then echo "RESTORE REHEARSAL: PASS"; else echo "RESTORE REHEARSAL: FAIL (exit $rc)" >&2; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'status=1; exit 1' INT TERM
fail() { echo "restore-rehearsal: $1" >&2; status=1; exit 1; }

umask 077
keydir="$(mktemp -d "${TMPDIR:-/tmp}/sparta-rehearsal.XXXXXX")" || fail "cannot make the key folder"
# by identity (-ef), not by text: on a case-insensitive volume a path typed in another case would pass a prefix test
d="$keydir"; while :; do { [ "$d" -ef "$repo" ] && fail "the key folder is inside the repository; set TMPDIR elsewhere"; }; [ "$d" = "/" ] && break; d="$(dirname "$d")"; done
echo "restore-rehearsal: LOCAL stack only ($db_container, image $image); nothing leaves this machine"

# ---- 1 seed: three synthetic users, three items each --------------------------------------------------------------------------------------
echo "-- 1 seed synthetic users"
seeded=1
cat <<'SQL' | live postgres >/dev/null || fail "the seed failed"
insert into auth.users (id, email) select md5('rehearsal:user:' || g)::uuid, 'rehearsal-' || g || '@example.test' from generate_series(1, 3) g;
update app.profiles set country = 'IN', hemisphere = 'north', age_confirmed = true where id in (select md5('rehearsal:user:' || g)::uuid from generate_series(1, 3) g);
insert into app.consent_records (user_id, notice_version) select md5('rehearsal:user:' || g)::uuid, value from ops.settings, generate_series(1, 3) g where key = 'current_notice_version';
insert into app.document_acceptances (user_id, document, version)
  select md5('rehearsal:user:' || g)::uuid, d.doc, (select value from ops.settings where key = d.key)
  from (values ('terms', 'current_terms_version'), ('privacy_policy', 'current_privacy_version')) d(doc, key), generate_series(1, 3) g;
insert into app.items (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin)
  select md5('rehearsal:item:' || u || ':' || i)::uuid, md5('rehearsal:user:' || u)::uuid, 'Rehearsal item ' || u || '-' || i, category, code, 17, 17, 17, 'manual'
  from (select category, code from catalog.lk_sub_type where active order by category, sort, code limit 1) s, generate_series(1, 3) u, generate_series(1, 3) i;
SQL
for n in 1 2 3; do user_ids+=("$(printf "select md5('rehearsal:user:%s')::uuid;\n" "$n" | live postgres)"); done
deleted_id="${user_ids[2]}"

# ---- 2 throwaway key pair (outside the repository) ---------------------------------------------------------------------------------------
echo "-- 2 throwaway age key pair in a private folder outside the repository"
age-keygen -o "$keydir/key.txt" >/dev/null 2>&1 || fail "age-keygen failed"
age-keygen -y "$keydir/key.txt" > "$keydir/recipient.txt" 2>/dev/null || fail "could not derive the public key"
decrypt_key="$keydir/key.txt"
if [ "${REHEARSAL_WRONG_KEY:-}" = "1" ]; then
  age-keygen -o "$keydir/other.txt" >/dev/null 2>&1 || fail "age-keygen failed"
  decrypt_key="$keydir/other.txt"; wrong_label=" (REHEARSAL_WRONG_KEY=1: decrypting with an unrelated key, this run must fail)"
fi

# ---- 3 and 4: the auth grant and a generated password for backup_role ----------------------------------------------------------------------
if [ "$grant_before" = "t" ] || [ "$grant_before" = "true" ]; then echo "-- 3 backup_role already has usage on schema auth; left as it is"
else
  echo "-- 3 grant usage on schema auth to backup_role (as supabase_admin, local only)"
  grant_changed=1
  printf "grant usage on schema auth to backup_role;\n" | live supabase_admin >/dev/null || fail "the auth grant failed"
fi
echo "-- 4 generated password on backup_role (as postgres, statement logging off), then backup.sh as backup_role"
bpw="$(gen)"
pw_set=1
printf "%s\nalter role backup_role password '%s';\n" "$LOGOFF" "$bpw" | live postgres >/dev/null || fail "could not set backup_role's password"
users_at_backup="$(printf "select count(*) from auth.users;\n" | live postgres)"
printf '%s\n' "$COUNTS_SQL" | live postgres > "$keydir/counts.backup" || fail "could not count the tables"
mkdir -p "$keydir/out"
(
  PGPASSWORD="${bpw}"
  export PGPASSWORD
  bash supabase/scripts/backup.sh "postgresql://backup_role@127.0.0.1:${live_port}/postgres" "$keydir/recipient.txt" "$keydir/out"
) || fail "backup.sh failed"
printf "%s\nalter role backup_role password null;\n" "$LOGOFF" | live postgres >/dev/null || fail "could not clear backup_role's password"
pw_set=0
shopt -s nullglob
backups=("$keydir"/out/backup-*.sql.age)
[ "${#backups[@]}" -eq 1 ] || fail "expected exactly one encrypted backup file, found ${#backups[@]}"
backup_file="${backups[0]}"
others=("$keydir"/out/*); [ "${#others[@]}" -eq 1 ] || fail "OUT_DIR holds more than the encrypted file"
backup_ts="$(printf "select to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS.US');\n" | live postgres)"
echo "backup taken; the encrypted file is $(wc -c < "$backup_file" | tr -d ' ') bytes; auth.users at backup time: $users_at_backup"
echo "NOT IN THIS BACKUP: auth.refresh_tokens and auth.refresh_tokens_id_seq (session state), and the 21 platform-feature tables of the WO-0163 migration header (Auth and Storage features, no pilot data)"
sleep 1

# ---- 5 and 6: a deletion after the backup, through the self-service path; copy the deletion log -----------------------------------------------
echo "-- 5 delete one synthetic user through the self-service path (app.delete_my_account, signed-in user, fresh sign-in)"
res="$(cat <<SQL | live postgres 2>&1
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${deleted_id}', 'role', 'authenticated',
  'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text, true);
select set_config('request.jwt.claim.sub', '${deleted_id}', true);
select app.delete_my_account();
commit;
SQL
)" || fail "the self-service deletion failed: $(printf '%s' "$res" | tail -n 1 | cut -c1-200)"
printf '%s\n' "$res" | grep -qx 'deleted' || fail "the self-service deletion did not answer 'deleted' (got: $(printf '%s' "$res" | tail -n 1 | cut -c1-100))"
echo "-- 6 copy ops.deletion_log (rows after the backup)"
log_ids="$(printf "select user_id from ops.deletion_log where deleted_at > '%s'::timestamp at time zone 'utc' order by user_id;\n" "$backup_ts" | live postgres)" || fail "could not copy ops.deletion_log"
printf '%s\n' "$log_ids" > "$keydir/deletion_log.copy"
n_log="$(printf '%s' "$log_ids" | grep -c . )"
[ "$n_log" = "1" ] && [ "$log_ids" = "$deleted_id" ] || fail "the copied deletion log should hold exactly the one deleted user (got $n_log rows)"
printf '%s\n' "$COUNTS_SQL" | live postgres > "$keydir/counts.live" || fail "could not count the tables"

# ---- 7 throwaway container: same image tag, free port, ready by pg_isready inside it (120 s) -------------------------------------------------
echo "-- 7 throwaway container of $image on a free port"
rpw="$(gen)"
container_started=1
(
  POSTGRES_PASSWORD="${rpw}"
  export POSTGRES_PASSWORD
  limited 120 docker run -d --name "$rehearsal" -e POSTGRES_PASSWORD -p 127.0.0.1::5432 "$image" >/dev/null
) || fail "could not start the throwaway container"
free_port="$(docker port "$rehearsal" 5432/tcp 2>/dev/null | head -n1 | sed 's/.*://')"
echo "container $rehearsal on 127.0.0.1:${free_port:-?}"
# Ctrl-C works in this wait too: a plain foreground `docker exec` swallows SIGINT and exits 0, so each poll and each pause runs in the BACKGROUND and the shell `wait`s on it; `wait` is
# interrupted by the INT trap, which exits and runs cleanup (cleanup also terminates the poll that is still running)
poll=""
bgwait() { "$@" >/dev/null 2>&1 </dev/null & poll=$!; wait "$poll"; local rc=$?; poll=""; return "$rc"; }
deadline=$(( $(now_s) + 120 )); ready=0
while [ "$(now_s)" -lt "$deadline" ]; do
  if bgwait limited 15 docker exec "$rehearsal" pg_isready -U postgres -h 127.0.0.1 \
     && bgwait limited 15 docker exec "$rehearsal" psql -U supabase_admin -d postgres -X -q -At -c 'select 1;'; then ready=1; break; fi
  bgwait sleep 2
done
[ "$ready" = 1 ] || fail "the throwaway container was not ready within 120 seconds (pg_isready); it is removed"
rest() { limited 120 docker exec -i "$rehearsal" psql -U supabase_admin -d postgres -X -q -At -v ON_ERROR_STOP=1; }

# ---- 8 decrypt and restore (no plain-text file: age writes to the pipe that psql reads) ----------------------------------------------------
echo "-- 8 decrypt with the throwaway private key and restore into the container${wrong_label}"
# a wrong key fails here, before anything is restored. The restore: errors are collected, not fatal, because a fresh image already holds the platform roles and schemas; every error must match the short allow-list below
if ! age -d -i "$decrypt_key" "$backup_file" > /dev/null 2> "$keydir/age.err"; then fail "age could not decrypt the backup with this key: $(head -n 1 "$keydir/age.err" | cut -c1-160)"; fi
rm -f "$keydir/age.err"
{ printf 'SET session_replication_role = replica;\n'; age -d -i "$decrypt_key" "$backup_file" || exit 1; printf 'RESET ALL;\n'; } \
  | limited 300 docker exec -i "$rehearsal" psql -U supabase_admin -d postgres -X -q -At -v ON_ERROR_STOP=0 > /dev/null 2> "$keydir/restore.err"
restore_status=("${PIPESTATUS[@]}")
for c in "${restore_status[@]}"; do [ "$c" = 0 ] || fail "the restore did not finish (decrypt, docker or psql ended with status ${restore_status[*]}; 124 means the 300 s limit)"; done
errs="$(grep 'ERROR:  ' "$keydir/restore.err" | sed 's/^.*ERROR:  //')"
allowed='^(role ".*" already exists|schema "auth" already exists|cannot drop schema auth because other objects depend on it|relation "auth\.oauth_clients" does not exist)$'
bad="$(printf '%s\n' "$errs" | grep -v '^$' | grep -Ev "$allowed" | head -n 5)"
n_errs="$(printf '%s\n' "$errs" | grep -vc '^$')"
if [ -n "$bad" ]; then printf '%s\n' "$bad" | cut -c1-200 >&2; fail "the restore raised errors outside the allow-list"; fi
echo "restore finished: $n_errs expected message(s) (roles and the auth schema already in the fresh image; the sessions foreign key to the excluded auth.oauth_clients)"
rm -f "$keydir/restore.err"

# ---- 9 deletions since the backup, run again from the copied log -------------------------------------------------------------------------
echo "-- 9 run the deletion again in the restored cluster for each user in the copied log"
users_restored_before="$(printf "select count(*) from auth.users;\n" | rest)" || fail "could not count the restored users"
present_before="$(printf "select count(*) from auth.users where id = '%s';\n" "$deleted_id" | rest)"
redeleted=0
while IFS= read -r uid; do
  [ -n "$uid" ] || continue
  [[ "$uid" =~ ^[0-9a-f-]{36}$ ]] || fail "a copied log entry is not a user id"
  out="$(printf "select ops.delete_participant('%s');\n" "$uid" | rest 2>&1)" || fail "the repeated deletion failed: $(printf '%s' "$out" | tail -n 1 | cut -c1-160)"
  [ "$out" = "deleted" ] && redeleted=$((redeleted + 1))
done < "$keydir/deletion_log.copy"

# ---- 10 checks ------------------------------------------------------------------------------------------------------------------------------
echo "-- 10 checks"
problems=0
check() { if [ "$2" = "ok" ]; then echo "PASS $1"; else echo "FAIL $1" >&2; problems=$((problems + 1)); fi; }
# roles: every role of the live cluster (not pg_*) exists in the restored one; backup_role and worker_role named; backup_role keeps bypassrls and no pg_read_all_data
live_roles="$(printf "select rolname from pg_roles where rolname !~ '^pg_' order by 1;\n" | live postgres)"
rest_roles="$(printf "select rolname from pg_roles where rolname !~ '^pg_' order by 1;\n" | rest)"
missing="$(comm -23 <(printf '%s\n' "$live_roles") <(printf '%s\n' "$rest_roles") | tr '\n' ' ')"
echo "roles in the live cluster: $(printf '%s\n' "$live_roles" | grep -c .); restored: $(printf '%s\n' "$rest_roles" | grep -c .); missing: ${missing:-none}"
[ -z "$missing" ] && check "all roles exist in the restored cluster" ok || check "all roles exist in the restored cluster (missing: $missing)" bad
for r in backup_role worker_role; do printf '%s\n' "$rest_roles" | grep -qx "$r" && check "role $r exists in the restored cluster" ok || check "role $r exists in the restored cluster" bad; done
br="$(printf "select rolbypassrls::text || ',' || exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname = 'backup_role' and r.rolname = 'pg_read_all_data')::text from pg_roles where rolname = 'backup_role';\n" | rest)"
[ "$br" = "true,false" ] && check "restored backup_role: bypassrls, not a member of pg_read_all_data" ok || check "restored backup_role: bypassrls, not a member of pg_read_all_data (got $br)" bad
# auth.users
users_restored_after="$(printf "select count(*) from auth.users;\n" | rest)"
echo "auth.users: at backup $users_at_backup; restored $users_restored_before (deleted user present: $present_before); re-deleted $redeleted; after the repeated deletion $users_restored_after"
[ "$users_restored_before" = "$users_at_backup" ] && check "restored auth.users equals the backup's count" ok || check "restored auth.users equals the backup's count" bad
[ "$users_restored_after" = "$((users_at_backup - redeleted))" ] && [ "$redeleted" = "1" ] && check "auth.users after the repeated deletion = backup count minus the re-deleted users" ok || check "auth.users after the repeated deletion = backup count minus the re-deleted users" bad
[ "$present_before" = "1" ] && check "the deleted user was in the backup (the restore brought it back)" ok || check "the deleted user was in the backup" bad
absent="$(printf "select count(*) from auth.users where id = '%s';\n" "$deleted_id" | rest)"
[ "$absent" = "0" ] && check "the deleted user is absent from the restored cluster" ok || check "the deleted user is absent from the restored cluster" bad
# every table of app, analytics and analytics_private
printf '%s\n' "$COUNTS_SQL" | rest > "$keydir/counts.restored" || fail "could not count the restored tables"
echo "table row counts (live stack after the deletion | restored cluster after the repeated deletion), schemas app, analytics, analytics_private:"
LC_ALL=C join -t'|' -a1 -a2 -e MISSING -o 0,1.2,2.2 <(LC_ALL=C sort "$keydir/counts.live") <(LC_ALL=C sort "$keydir/counts.restored") | awk -F'|' '{ printf "  %-40s %8s | %s\n", $1, $2, $3 }'
n_app="$(grep -c '^app\.' "$keydir/counts.live")"; n_an="$(grep -c '^analytics\.' "$keydir/counts.live")"; n_anp="$(grep -c '^analytics_private\.' "$keydir/counts.live")"
echo "tables compared: app $n_app, analytics $n_an, analytics_private $n_anp"
# a schema with no table to compare would make the check vacuous: all three must hold tables
if [ "$n_app" -gt 0 ] && [ "$n_an" -gt 0 ] && [ "$n_anp" -gt 0 ] && diff -q "$keydir/counts.live" "$keydir/counts.restored" >/dev/null; then
  check "every table's row count matches (app $n_app, analytics $n_an, analytics_private $n_anp tables)" ok
else check "every table's row count matches (app $n_app, analytics $n_an, analytics_private $n_anp tables)" bad; fi
[ "$problems" = "0" ] || fail "$problems check(s) failed"
status=0
exit 0
