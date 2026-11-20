#!/usr/bin/env bash
# LOCAL INCIDENT-PLAN PRACTICE DRILL (WO-0167, Release 8b; LLD 14 M6; legal/INCIDENT-RESPONSE-PLAN.md sections 4 to 8). A timed, repeatable drill on the LOCAL stack that changes nothing permanent:
#   (a) lost machine or leaked credential (plan section 7, "Worker machine stolen"): as postgres, rotate the worker_role and backup_role passwords to fresh generated values, show that a
#       connection with the old worker_role password is refused and that each new password connects, then put the worker_role value back (none, or the stored verifier when the role
#       had a password before; set-worker-password.sh must exist, as the developer's real restore path, but the drill sets passwords itself so it can keep them out of the server log) and clear backup_role's password again (WO-0163 leaves it without one);
#   (b) exposure through a policy (plan section 4, "Contain"): inside ONE transaction that is rolled back, set the app.items select policy to deny all, show a signed-in synthetic user reads no
#       rows (and did read rows before), roll back, and show with a pg_policies comparison that the policies are unchanged;
#   (c) print the plan's section 6 message outline and section 5 record fields, for the team to fill in privately. Nothing is written to a file.
# Every step prints PASS or FAIL with the time it took and has a time limit. On EVERY exit (trap: success, failure, timeout, Ctrl-C, kill) the script restores worker_role and backup_role to what
# they were before, ends any session it opened, removes the synthetic user, and checks the roles and policies are as found. No password is printed, written to a file or put on a command line: generated values live only in
# shell variables and go in on stdin or in the environment of one command, and each session that carries one first sets log_statement and pg_stat_statements.track to 'none', so they
# reach neither the database server log nor pg_stat_statements. Nothing is sent off this machine. Never --linked.
#
#   bash supabase/scripts/incident-drill.sh [DATABASE_URL]    # default: postgresql://postgres:postgres@127.0.0.1:54322/postgres
# The URL may also come from SPARTA_DRILL_DB_URL. It is REFUSED unless its host is 127.0.0.1, localhost or [::1] (no query string, no other host). The git-ignored
# supabase/scripts/set-worker-password.sh must exist and be executable, or the script exits before it changes anything (QC 15).
# Uses psql when it is installed, else `docker exec` into the local stack's database container.
# Exit 0: every step passed and the roles and policies were left as found. Exit 1: a step failed or timed out, or something was not left as found. Exit 2: refused (non-local URL, missing script,
# local stack not readable). Time limits: 60 s per database call, 30 s for set-worker-password.sh; the worst case is under 10 minutes.
set -uo pipefail
# libpq reads these and can send a connection anywhere the URL does not say: none of them reaches psql or docker
unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGSYSCONFDIR PGDATABASE PGUSER PGPASSFILE PGPASSWORD PGSSLMODE PGOPTIONS PGAPPNAME PGTARGETSESSIONATTRS PGCONNECT_TIMEOUT
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
refuse() { echo "incident-drill: refusing to run: $1" >&2; exit 2; }
limited() { local s="$1"; shift; if command -v timeout >/dev/null 2>&1; then timeout -k 5 "$s" "$@"; else perl -e 'alarm shift; exec @ARGV' "$s" "$@"; fi; }
now_ms() { perl -MTime::HiRes=time -e 'printf("%d\n", time() * 1000)'; }

url="${1:-${SPARTA_DRILL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}}"
url_re='^postgres(ql)?://[^@/?#[:space:]]*@((127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?)/([A-Za-z0-9_]+)$'
if [[ "$url" == *$'\n'* || "$url" == *$'\r'* ]] || ! [[ "$url" =~ $url_re ]]; then
  refuse "the database URL must point at 127.0.0.1, localhost or [::1] (no query string)."
fi
hostport="${BASH_REMATCH[2]}"; dbname="${BASH_REMATCH[5]}"

worker_script="supabase/scripts/set-worker-password.sh"
if [ ! -f "$worker_script" ] || [ ! -x "$worker_script" ]; then
  refuse "$worker_script (git-ignored, local only) is missing or not executable; nothing was changed. Create it from services/worker/README.md first."
fi
plan="legal/INCIDENT-RESPONSE-PLAN.md"
[ -f "$plan" ] || refuse "$plan is missing; nothing was changed."

project="$(sed -n 's/^project_id *= *"\([^"]*\)".*/\1/p' supabase/config.toml | head -n1)"
container="supabase_db_${project:-sparta}"
app="incident-drill-$$"   # application_name of every session of this run, so the run can end any that is left
step_secs=60

# run_pg <seconds> <role> <secret> [psql args]: stdin is the SQL. role "-" is the admin (postgres, from the URL or the container); any other role connects over TCP so its password is checked
run_pg() {
  local secs="$1" role="$2"
  local secret="${3}"
  shift 3
  local opts="-c statement_timeout=$(( (secs - 5) * 1000 )) -c lock_timeout=20000"   # the server gives up a little before the client is killed, so no query is left running
  if command -v psql >/dev/null 2>&1; then
    if [ "$role" = "-" ]; then
      PGAPPNAME="$app" PGOPTIONS="$opts" limited "$secs" psql "$url" -X -q -At -v ON_ERROR_STOP=1 "$@" -f -
    else
      (
        PGPASSWORD="${secret}"
        export PGPASSWORD
        PGAPPNAME="$app"; PGOPTIONS="$opts"; export PGAPPNAME PGOPTIONS
        limited "$secs" psql "postgresql://$role@$hostport/$dbname" -X -q -At -v ON_ERROR_STOP=1 "$@" -f -
      )
    fi
  elif [ "$role" = "-" ]; then
    limited "$secs" docker exec -i -e "PGAPPNAME=$app" -e "PGOPTIONS=$opts" "$container" psql -U postgres -d "$dbname" -X -q -At -v ON_ERROR_STOP=1 "$@" -f -
  else
    # inside the container 127.0.0.1 is trusted, so the role connects to the container's own address, where pg_hba asks for the password
    (
      PGPASSWORD="${secret}"
      export PGPASSWORD
      limited "$secs" docker exec -i -e PGPASSWORD -e "PGAPPNAME=$app" -e "PGOPTIONS=$opts" "$container" \
        sh -c 'psql -h "$(hostname -i | cut -d" " -f1)" -U "$0" -d "$1" -X -q -At -v ON_ERROR_STOP=1 "${@:2}" -f -' "$role" "$dbname" "$@"
    )
  fi
}
admin() { run_pg "$step_secs" - "" "$@"; }
gen() { od -An -N16 -tx1 /dev/urandom | tr -d ' \n'; }   # 32 hex characters: inside the character set set-worker-password.sh accepts, so no SQL quoting is needed

STATE_SQL="-- q:state
select 'w=' || coalesce((select rolpassword from pg_authid where rolname = 'worker_role'), '')
  || '|b=' || coalesce((select rolpassword from pg_authid where rolname = 'backup_role'), '')
  || '|p=' || coalesce((select md5(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ';' order by policyname)) from pg_policies where schemaname = 'app' and tablename = 'items'), '')
  || '|u=' || (select count(*) from auth.users where email like 'incident-drill%@example.test');"
POLICIES_SQL="-- q:policies
select policyname || ' ' || cmd || ' using: ' || coalesce(qual, '-') || ' check: ' || coalesce(with_check, '-') from pg_policies where schemaname = 'app' and tablename = 'items' order by policyname;"
read_state() { printf '%s\n' "$STATE_SQL" | admin; }
w_of() { local s="${1#w=}"; printf '%s' "${s%%|b=*}"; }
b_of() { local s="${1#*|b=}"; printf '%s' "${s%%|p=*}"; }
rest_of() { printf '%s' "${1#*|p=}"; }   # policies and leftover users: no secret in it
word() { if [ -n "$1" ]; then echo "set"; else echo "none"; fi; }

# ---- what was there before: the verifiers stay in variables and are never printed ----
if ! before="$(read_state 2>&1)" || [[ "$before" != w=*'|b='*'|p='*'|u='* ]]; then
  echo "incident-drill: could not read the local database (is the local Supabase stack running?): $(printf '%s' "$before" | tail -n 1 | cut -c1-200)" >&2; exit 2
fi
orig_w="$(w_of "$before")"; orig_b="$(b_of "$before")"; orig_rest="$(rest_of "$before")"
if ! pol_before="$(printf '%s\n' "$POLICIES_SQL" | admin 2>&1)" || [ -z "$pol_before" ]; then
  echo "incident-drill: could not read the app.items policies." >&2; exit 2
fi
if [ "${orig_rest##*|u=}" != "0" ]; then refuse "a synthetic user of an earlier drill is still present (incident-drill@example.test); remove it first."; fi

status=1
changed=0
cleaned=0
old_w=""; new_w=""; new_b=""

# Every session that carries a password turns statement logging and pg_stat_statements tracking off first: the local database logs DDL (log_statement = ddl), so an
# `alter role ... password` would otherwise land in the container log and in pg_stat_statements. (set-worker-password.sh cannot do that, so the drill sets and restores the
# passwords itself; the script stays a precondition: it is the developer's real restore path, QC 15.)
LOGOFF="set log_statement = 'none'; set pg_stat_statements.track = 'none';"
restore_role() {   # restore_role <role> <verifier>: put the stored value back, or clear it when the role had none
  local role="$1" verifier="$2"
  if [ -n "$verifier" ]; then printf -- "-- q:restore_%s\n%s\nalter role %s password '%s';\n" "$role" "$LOGOFF" "$role" "$verifier"
  else printf -- "-- q:restore_%s\n%s\nalter role %s password null;\n" "$role" "$LOGOFF" "$role"; fi | admin >/dev/null
}

cleanup() {
  local rc=$status after pol_after
  trap '' INT TERM   # a second Ctrl-C or kill must not interrupt the restore
  trap - EXIT
  if [ "$cleaned" = 0 ]; then
    cleaned=1
    if [ "$changed" = 1 ]; then
      restore_role worker_role "$orig_w" || { echo "incident-drill: FAILED to restore worker_role (run set-worker-password.sh by hand)." >&2; rc=1; }
      restore_role backup_role "$orig_b" || { echo "incident-drill: FAILED to restore backup_role (run: alter role backup_role password null)." >&2; rc=1; }
    fi
    printf -- "-- q:kill\nselect pg_terminate_backend(pid) from pg_stat_activity where application_name = :'app' and pid <> pg_backend_pid();\n" | admin -v "app=$app" >/dev/null 2>&1 || true
    printf -- "-- q:remove_user\ndelete from auth.users where email like 'incident-drill%%@example.test';\n" | admin >/dev/null 2>&1 || true
    if after="$(read_state 2>&1)" && pol_after="$(printf '%s\n' "$POLICIES_SQL" | admin 2>&1)" \
       && [ "$(w_of "$after")" = "$orig_w" ] && [ "$(b_of "$after")" = "$orig_b" ] && [ "$(rest_of "$after")" = "$orig_rest" ] && [ "$pol_after" = "$pol_before" ]; then
      echo "restored: worker_role password $(word "$orig_w") as found, backup_role password $(word "$orig_b") as found, app.items policies unchanged, no synthetic user left"
    else
      echo "incident-drill: FAIL: the local database was NOT left as found (worker_role, backup_role, policies or synthetic user)." >&2; rc=1
    fi
  fi
  if [ "$rc" = 0 ]; then echo "incident-drill: PASS"; else echo "incident-drill: FAIL (exit $rc)" >&2; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'status=1; exit 1' INT TERM

# run_step <name> <function>: prints PASS or FAIL with the time it took; the first FAIL ends the drill (the trap restores everything)
run_step() {
  local name="$1" fn="$2" t0 t1 msg
  t0="$(now_ms)"
  if msg="$("$fn" 2>&1)"; then rc=0; else rc=1; fi
  t1="$(now_ms)"
  [ -n "$msg" ] && printf '%s\n' "$msg" | sed 's/^/      /'
  if [ "$rc" = 0 ]; then printf 'PASS %s (%s ms)\n' "$name" "$((t1 - t0))"; else printf 'FAIL %s (%s ms)\n' "$name" "$((t1 - t0))" >&2; exit 1; fi
}

# ---- (a) lost machine or leaked credential (plan section 7, "Worker machine stolen") ----
# The step functions run in a subshell (for the message capture): they only read the generated values, which the main shell sets before the first step.
a1_rotate() {
  echo "plan section 4 step 2 (Contain), lost machine: rotate the worker_role and backup_role database passwords"
  # the stand-in for the stolen machine's credential: a generated value is set first, then the incident rotates it
  printf -- "-- q:stand_in\n%s\nalter role worker_role password '%s';\n" "$LOGOFF" "$old_w" | admin >/dev/null || { echo "could not set the stand-in credential"; return 1; }
  printf -- "-- q:rotate\n%s\nalter role worker_role password '%s';\nalter role backup_role password '%s';\n" "$LOGOFF" "$new_w" "$new_b" | admin >/dev/null || { echo "could not rotate the passwords"; return 1; }
  echo "worker_role and backup_role passwords rotated to fresh generated values"
}
conn() {   # conn <tag> <role> <secret>: select current_user over TCP with that password
  printf -- "-- q:%s\nselect current_user;\n" "$1" | run_pg 30 "$2" "$3" 2>&1
}
a2_old_refused() {
  local out
  if out="$(conn conn_old_worker worker_role "$old_w")"; then echo "the OLD worker_role password still connects"; return 1; fi
  if printf '%s' "$out" | grep -qi 'password authentication failed'; then echo "connection with the old worker_role password refused (password authentication failed)"; else
    echo "the old password was not refused for the expected reason: $(printf '%s' "$out" | tail -n 1 | cut -c1-200)"; return 1; fi
}
a3_new_worker() {
  local out; out="$(conn conn_new_worker worker_role "$new_w")" || { echo "the new worker_role password does not connect: $(printf '%s' "$out" | tail -n 1 | cut -c1-200)"; return 1; }
  [ "$out" = "worker_role" ] || { echo "connected as '$out', expected worker_role"; return 1; }
  echo "connection with the new worker_role password succeeded"
}
a4_new_backup() {
  local out; out="$(conn conn_new_backup backup_role "$new_b")" || { echo "the new backup_role password does not connect: $(printf '%s' "$out" | tail -n 1 | cut -c1-200)"; return 1; }
  [ "$out" = "backup_role" ] || { echo "connected as '$out', expected backup_role"; return 1; }
  echo "connection with the new backup_role password succeeded"
}
a5_restore() {
  local s
  restore_role worker_role "$orig_w" || { echo "could not restore worker_role"; return 1; }
  restore_role backup_role "$orig_b" || { echo "could not restore backup_role"; return 1; }
  s="$(read_state)" || { echo "could not read the state"; return 1; }
  [ "$(w_of "$s")" = "$orig_w" ] && [ "$(b_of "$s")" = "$orig_b" ] || { echo "worker_role or backup_role is not as found"; return 1; }
  if [ -n "$orig_b" ]; then echo "backup_role password restored to the value found"; else echo "backup_role password cleared again (WO-0163 leaves it without one)"; fi
  if [ -n "$orig_w" ]; then echo "worker_role restored to the value found"; else echo "worker_role restored: no password, as found (set-worker-password.sh --clear)"; fi
  # the old and new passwords are dead
  if conn conn_after_restore worker_role "$new_w" >/dev/null; then echo "the rotated worker_role password still connects after the restore"; return 1; fi
}

# ---- (b) exposure through a policy (plan section 4, "Contain"): one transaction, rolled back ----
b1_policy() {
  local out base deny intx
  out="$(cat <<'SQL' | admin
-- q:policy_drill
begin;
insert into auth.users (id, email) values (md5('incident-drill:user')::uuid, 'incident-drill@example.test');
update app.profiles set country = 'IN', hemisphere = 'north', age_confirmed = true where id = md5('incident-drill:user')::uuid;
insert into app.consent_records (user_id, notice_version) select md5('incident-drill:user')::uuid, value from ops.settings where key = 'current_notice_version';
insert into app.document_acceptances (user_id, document, version)
  select md5('incident-drill:user')::uuid, d.doc, (select value from ops.settings where key = d.key)
  from (values ('terms', 'current_terms_version'), ('privacy_policy', 'current_privacy_version')) d(doc, key);
insert into app.items (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin)
  select md5('incident-drill:item:' || g)::uuid, md5('incident-drill:user')::uuid, 'Drill item ' || g, category, code, 17, 17, 17, 'manual'
  from (select category, code from catalog.lk_sub_type where active order by category, sort, code limit 1) s cross join generate_series(1, 3) g;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('incident-drill:user')::uuid::text, 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', md5('incident-drill:user')::uuid::text, true);
select 'BASE|' || count(*) from app.items;
reset role;
alter policy items_select on app.items using (false);
set local role authenticated;
select 'DENY|' || count(*) from app.items;
reset role;
select 'INTX|' || count(*) from pg_policies where schemaname = 'app' and tablename = 'items' and policyname = 'items_select' and qual = 'false';
rollback;
SQL
)" || { echo "the policy drill failed: $(printf '%s' "$out" | tail -n 1 | cut -c1-200)"; return 1; }
  base="$(printf '%s\n' "$out" | sed -n 's/^BASE|//p')"; deny="$(printf '%s\n' "$out" | sed -n 's/^DENY|//p')"; intx="$(printf '%s\n' "$out" | sed -n 's/^INTX|//p')"
  [[ "$base" =~ ^[0-9]+$ && "$base" -ge 1 ]] || { echo "the synthetic user read no rows BEFORE the policy was closed (base=$base), so the test proves nothing"; return 1; }
  [ "$intx" = "1" ] || { echo "the policy was not set to deny all inside the transaction"; return 1; }
  [ "$deny" = "0" ] || { echo "the synthetic user still read $deny rows with the policy set to deny all"; return 1; }
  echo "signed-in synthetic user read $base rows; with items_select set to 'using (false)' it read $deny; transaction rolled back"
}
b2_unchanged() {
  local s pol_now u
  pol_now="$(printf '%s\n' "$POLICIES_SQL" | admin)" || { echo "could not read the policies"; return 1; }
  if [ "$pol_now" != "$pol_before" ]; then echo "app.items policies DIFFER after the rollback:"; diff <(printf '%s\n' "$pol_before") <(printf '%s\n' "$pol_now"); return 1; fi
  s="$(read_state)" || { echo "could not read the state"; return 1; }
  [ "${s##*|u=}" = "0" ] || { echo "the synthetic user was not rolled back"; return 1; }
  echo "app.items policies identical before and after (pg_policies comparison, $(printf '%s\n' "$pol_now" | wc -l | tr -d ' ') policies, no difference); no synthetic user left"
}

# ---- (c) the message outline and the record fields, for the team to fill in privately ----
c_outline() {
  local sec5 sec6
  sec5="$(sed -n '/^## 5\. Record/,/^## 6\./p' "$plan" | sed '1d;$d')"
  sec6="$(sed -n '/^## 6\. Message/,/^## 7\./p' "$plan" | sed '1d;$d')"
  { [ -n "$sec5" ] && [ -n "$sec6" ]; } || { echo "sections 5 and 6 were not found in $plan"; return 1; }
  echo "Fill these in PRIVATELY, outside the repository (plan section 5). Never put personal data in the log."
  echo "--- section 5: record fields ---"
  printf '%s\n' "$sec5"
  printf '%s\n' "  [ ] date and time found   [ ] who found it   [ ] severity   [ ] what happened" "  [ ] data and people affected   [ ] actions and times   [ ] notices sent   [ ] review (within 7 days)"
  echo "--- section 6: message to affected participants (outline) ---"
  printf '%s\n' "$sec6"
}

echo "incident-drill: LOCAL stack only; nothing is written to a file, nothing leaves this machine"
old_w="$(gen)"; new_w="$(gen)"; new_b="$(gen)"
changed=1   # from here the trap restores both roles (it is harmless when nothing was changed yet)
run_step "a1 rotate worker_role and backup_role passwords" a1_rotate
run_step "a2 old worker_role password is refused" a2_old_refused
run_step "a3 new worker_role password connects" a3_new_worker
run_step "a4 new backup_role password connects" a4_new_backup
run_step "a5 restore worker_role, clear backup_role" a5_restore
run_step "b1 deny-all policy in one transaction hides the rows" b1_policy
run_step "b2 rollback leaves app.items policies unchanged" b2_unchanged
run_step "c  message outline and record fields" c_outline
status=0
exit 0
