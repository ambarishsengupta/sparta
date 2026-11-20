#!/usr/bin/env bash
# LOCAL EMAIL-DELIVERY CHECK (WO-0166, Release 8b; LLD 14 M6). Against the local mail catcher (Mailpit, run by `supabase start`) it proves, with SYNTHETIC @example.test addresses only:
#   sign-up verification (invited address signs up through the publishable key, the mail is found within 30 s, its link is followed, the account is confirmed), password reset (mail found,
#   link followed, a new generated password set, sign-in with it), and that an uninvited address is refused with the FR-8 message and gets no email. It prints one PASS line each and a
#   NOT COVERED line for the export email (not built; QC 11b). The users, invitations and caught messages it creates are removed on EVERY exit (trap, and `finally` in email-check.ts).
#
#   bash supabase/scripts/email-check.sh [DATABASE_URL]    # default: the DB_URL of `supabase status`
# The URL may also come from SPARTA_EMAIL_DB_URL. It is REFUSED unless its host is 127.0.0.1, localhost or [::1] (no query string, no other host). The mail catcher, API and database URLs and the
# publishable key are read from `supabase status -o json`; each URL is refused too unless it is local. The secret key is never used or printed. Nothing is sent off this machine. Never --linked.
# Exit 0: the three checks passed and the invitation count, user count and sign-up counter are equal before and after. Exit 1: a check failed, a wait (30 s) timed out, or the database was not
# left as found. Exit 2: refused (non-local URL, missing setting). Time limits: 60 s each for `supabase status`, the two snapshots, the clean-up and the audit count, 240 s for the check itself (plus 5 s kill grace per step), so the worst case is about 570 s.
set -uo pipefail
# libpq reads these and can send a connection anywhere the URL does not say: none of them reaches psql or docker
unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGSYSCONFDIR PGDATABASE PGUSER PGPASSFILE PGPASSWORD PGSSLMODE PGOPTIONS PGAPPNAME PGTARGETSESSIONATTRS PGCONNECT_TIMEOUT
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
refuse() { echo "email-check: refusing to run: $1" >&2; exit 2; }
db_re='^postgres(ql)?://[^@/?#[:space:]]*@(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?/[A-Za-z0-9_]+$'
http_re='^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?$'
bad_line() { [[ "$1" == *$'\n'* || "$1" == *$'\r'* ]]; }
limited() { local s="$1"; shift; if command -v timeout >/dev/null 2>&1; then timeout -k 5 "$s" "$@"; else perl -e 'alarm shift; exec @ARGV' "$s" "$@"; fi; }

given="${1:-${SPARTA_EMAIL_DB_URL:-}}"
if [ -n "$given" ] && { bad_line "$given" || ! [[ "$given" =~ $db_re ]]; }; then
  refuse "the database URL must point at 127.0.0.1, localhost or [::1] (no query string)."
fi

status_json="$(limited 60 supabase status -o json 2>/dev/null)" || refuse "could not read \`supabase status\` (is the local Supabase stack running?)."
jget() { printf '%s\n' "$status_json" | sed -n "s/.*\"$1\" *: *\"\\([^\"]*\\)\".*/\\1/p" | head -n1; }
api_url="$(jget API_URL)"; mail_url="$(jget MAILPIT_URL)"; key="$(jget PUBLISHABLE_KEY)"; db_url="${given:-$(jget DB_URL)}"
[ -n "$mail_url" ] || refuse "\`supabase status\` gave no mail catcher URL (MAILPIT_URL)."
if [ -z "$api_url" ] || [ -z "$key" ] || [ -z "$db_url" ]; then refuse "\`supabase status\` gave no API URL, publishable key or database URL."; fi
for u in "$api_url" "$mail_url"; do
  if bad_line "$u" || ! [[ "$u" =~ $http_re ]]; then refuse "the API and mail catcher URLs must point at 127.0.0.1, localhost or [::1]."; fi
done
if bad_line "$db_url" || ! [[ "$db_url" =~ $db_re ]]; then refuse "the database URL must point at 127.0.0.1, localhost or [::1] (no query string)."; fi

export EMAIL_CHECK_API_URL="$api_url" EMAIL_CHECK_MAILPIT_URL="$mail_url" EMAIL_CHECK_PUBLISHABLE_KEY="$key" EMAIL_CHECK_DB_URL="$db_url"
EMAIL_CHECK_RUN_ID="$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"; export EMAIL_CHECK_RUN_ID
tsx="node_modules/.bin/tsx"; [ -x "$tsx" ] || refuse "node_modules/.bin/tsx is missing (run npm install)."
runts() { limited "$1" "$tsx" supabase/scripts/email-check.ts "${@:2}"; }

if ! before="$(runts 60 --snapshot 2>&1)" || [ -z "$before" ]; then
  echo "email-check: could not read the local database: $(printf '%s' "$before" | tail -n 2 | cut -c1-300)" >&2; exit 2
fi

status=1
cleaned=0
cleanup() {
  local rc=$status
  trap - EXIT INT TERM
  if [ "$cleaned" = 0 ]; then
    cleaned=1
    runts 60 --cleanup || { echo "email-check: FAILED to remove everything it created (run id $EMAIL_CHECK_RUN_ID)." >&2; rc=1; }
    if after="$(runts 60 --snapshot 2>&1)" && [ "$after" = "$before" ]; then
      echo "before/after check: invitations, users and the sign-up counter are EQUAL"
      echo "  before: $before"
      echo "  after:  $after"
    else
      echo "email-check: FAIL: the local database was NOT left as found." >&2
      echo "  before: $before" >&2; echo "  after:  ${after:-unreadable}" >&2; rc=1
    fi
  fi
  runts 60 --audit-note || echo "email-check: could not count the Auth audit-log rows for the synthetic addresses." >&2   # information only: it never changes the exit status or the equality check above
  if [ "$rc" = 0 ]; then echo "email-check: PASS"; else echo "email-check: FAIL (exit $rc)" >&2; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'status=1; exit 1' INT TERM

if runts 240; then status=0; else status=1; fi
exit "$status"
