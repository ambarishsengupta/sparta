#!/usr/bin/env bash
# LOCAL-FIRST BACKUP (WO-0164, Release 8b; NFR-8; LLD 4.5, 10 Backups, 13.3). Dumps the cluster roles, then the schema and the data of the database (auth.users and storage.objects included),
# encrypts both with `age` to a PUBLIC key and writes ONLY the encrypted file into OUT_DIR. The dumps are streamed into age: no plain-text file exists at any time. A partial output
# is removed on every exit (trap: success, failure, Ctrl-C, kill). Nothing is sent anywhere. Never --linked.
#
#   bash supabase/scripts/backup.sh DB_URL AGE_RECIPIENT_FILE OUT_DIR     (the caller exports PGPASSWORD, in the environment of this one command only)
#   DB_URL            postgresql://backup_role@127.0.0.1:54322/postgres   (host 127.0.0.1, localhost or [::1] only; NO password in the URL, it would show in `ps`; it goes in PGPASSWORD)
#   AGE_RECIPIENT_FILE a file with one or more age PUBLIC keys (lines starting age1); the private key is never needed here
#   OUT_DIR           where backup-<UTC time>.sql.age is written; must not be inside this repository
# What is dumped, and with which flags (read on the day from `supabase db dump --help`, CLI 3.0.0; the CLI cannot be used for the dump itself, see below):
#   roles:  pg_dumpall --roles-only --no-role-passwords --quote-all-identifier --no-comments   (backup_role cannot read password verifiers and must not)
#   data:   pg_dump --quote-all-identifier --no-comments --clean --if-exists, with the CLI's schema exclusions for platform-internal schemas, and --exclude-table-data for the 21
#           Auth and Storage platform-feature tables that backup_role has no select on (WO-0163 migration header). --exclude-table-data is not enough: pg_dump LOCKs every table whose
#           definition it dumps, and a LOCK needs a privilege backup_role lacks on them ("permission denied for table migrations"), so their definitions and data both stay out; the image and its services own them.
# Why not `supabase db dump`: the CLI writes `--role "postgres"` into its pg_dump and pg_dumpall calls (SET ROLE postgres). backup_role is not a member of postgres and must never be
# (read-only, no pg_read_all_data), so the CLI's dump fails with "permission denied to set role". The same flags are used here without --role. pg_dump and pg_dumpall run on the host when
# installed; otherwise inside the local stack's database container (docker exec, the password passed by `-e PGPASSWORD` without a value, so it is not on any command line).
# Exit 0: the encrypted file exists and every step succeeded. Exit 1: a step failed (the partial output is removed). Exit 2: refused (non-local URL, password in URL, bad key file, bad OUT_DIR).
set -uo pipefail
# libpq reads these and can send a connection anywhere the URL does not say: none of them reaches a dump (PGPASSWORD is kept: the caller passes the password that way)
unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGSYSCONFDIR PGDATABASE PGUSER PGPASSFILE PGSSLMODE PGOPTIONS PGAPPNAME PGTARGETSESSIONATTRS PGCONNECT_TIMEOUT
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)" || exit 2
cd "$repo" || exit 2
refuse() { echo "backup: refusing to run: $1" >&2; exit 2; }
# --foreground keeps the child in OUR process group, so Ctrl-C (SIGINT to the group) reaches it and the INT trap runs; -k still sends KILL 5 s after the time limit
limited() { local s="$1"; shift; if command -v timeout >/dev/null 2>&1; then timeout --foreground -k 5 "$s" "$@"; else perl -e 'alarm shift; exec @ARGV' "$s" "$@"; fi; }

[ "$#" -eq 3 ] || refuse "usage: backup.sh DB_URL AGE_RECIPIENT_FILE OUT_DIR"
url="$1"; recipients="$2"; out_dir="$3"
url_re='^postgres(ql)?://([A-Za-z0-9_]+)@(127\.0\.0\.1|localhost|\[::1\])(:([0-9]{1,5}))?/([A-Za-z0-9_]+)$'
if [[ "$url" == *$'\n'* || "$url" == *$'\r'* ]] || ! [[ "$url" =~ $url_re ]]; then
  refuse "the database URL must be postgresql://USER@127.0.0.1:PORT/DB (host 127.0.0.1, localhost or [::1]; no password, no query string; the password goes in PGPASSWORD)."
fi
db_user="${BASH_REMATCH[2]}"; db_host="${BASH_REMATCH[3]}"; db_port="${BASH_REMATCH[5]:-5432}"; db_name="${BASH_REMATCH[6]}"
db_host="${db_host#[}"; db_host="${db_host%]}"
[ -f "$recipients" ] && [ -r "$recipients" ] || refuse "the recipient file is missing or unreadable."
grep -q '^age1' "$recipients" || refuse "the recipient file holds no age public key (a line starting age1)."
if grep -q 'AGE-SECRET-KEY' "$recipients"; then refuse "the recipient file holds a PRIVATE key; give only the public key."; fi
# inside_repo <path>: true when the path, or its nearest existing ancestor, IS the repository or lies below it. Compared by identity (-ef), not by text: on a case-insensitive
# volume (APFS) the same folder can be typed in another case, and a text prefix test would let it through.
inside_repo() {
  local d="$1"
  while :; do
    [ -e "$d" ] && [ "$d" -ef "$repo" ] && return 0
    case "$d" in /|.) [ "$d" = "." ] && { [ "$PWD" -ef "$repo" ] && return 0; }; return 1 ;; esac
    d="$(dirname "$d")"
  done
}
if inside_repo "$out_dir"; then refuse "OUT_DIR must be outside this repository."; fi
mkdir -p "$out_dir" || refuse "cannot create OUT_DIR."
out_dir="$(cd "$out_dir" && pwd -P)" || refuse "cannot enter OUT_DIR."
if inside_repo "$out_dir"; then refuse "OUT_DIR must be outside this repository."; fi

final=""
countdir=""
cleanup() {
  local rc=$?
  trap '' INT TERM
  trap - EXIT
  [ -n "$countdir" ] && rm -rf "$countdir"
  # a partial encrypted file is never left behind (there is no plain-text file to remove: the dumps are streamed into age)
  [ "$rc" -ne 0 ] && [ -n "$final" ] && rm -f "$final.part"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

umask 077
# a folder that holds two files with ONE number each (the plain-text bytes of each dump that went into age), never any dump text
countdir="$(mktemp -d "${TMPDIR:-/tmp}/sparta-backup-count.XXXXXX")" || { echo "backup: cannot make the count folder" >&2; exit 1; }
# One floor per dump, each counted on its own stream (a big roles dump must not hide an empty schema dump). Both are 1000 bytes: a dump that exits 0 but prints nothing gives 0, and a real one is far above.
#   roles_min = 1000: a roles-only dump of the bare Supabase cluster is about 8 KB (20 roles with their attributes and memberships); even one role's lines are well over 1000, so under it the dump is cut off.
#   data_min  = 1000: pg_dump's preamble alone is about 500 bytes, and this database holds 7 analytics tables, about 40 app, catalog and ops tables and auth.users, whose definitions run to hundreds of KB; a dump under
#                     1000 bytes holds no table definitions, so it came back empty or cut off (a failing pg_dump is caught by its exit status; this floor catches the one that exits 0 and prints nothing).
roles_min=1000
data_min=1000
project="$(sed -n 's/^project_id *= *"\([^"]*\)".*/\1/p' supabase/config.toml 2>/dev/null | head -n1)"
container="supabase_db_${project:-sparta}"

# pgtool <tool> [args]: pg_dump or pg_dumpall as db_user. Host binary when there is one, else inside the local database container (127.0.0.1 is trusted there, so the role connects to the
# container's own address, where pg_hba asks for the password). PGPASSWORD is inherited by name only.
pgtool() {
  local tool="$1"; shift
  if command -v "$tool" >/dev/null 2>&1; then
    limited 600 "$tool" -h "$db_host" -p "$db_port" -U "$db_user" "$@"
  else
    limited 600 docker exec -e PGPASSWORD "$container" \
      sh -c 'tool="$1"; user="$2"; shift 2; exec "$tool" -h "$(hostname -i | cut -d" " -f1)" -p 5432 -U "$user" "$@"' sh "$tool" "$db_user" "$@"
  fi
}

# the 21 platform-feature tables (WO-0163 migration header): Supabase owns them, backup_role has no select, they hold no pilot data
excluded=(
  auth.oauth_authorizations auth.oauth_clients auth.oauth_consents auth.oauth_client_states auth.custom_oauth_providers auth.webauthn_credentials auth.webauthn_challenges
  auth.scim_users auth.scim_tokens auth.mfa_recovery_code_sets auth.mfa_recovery_codes
  storage.iceberg_namespaces storage.iceberg_tables storage.buckets_analytics storage.lifecycle_abandoned_artifacts storage.bucket_lifecycle_states storage.migrations
  storage.s3_multipart_uploads storage.s3_multipart_uploads_parts storage.buckets_vectors storage.vector_indexes
)
# FINDING (WO-0163 gap): auth.refresh_tokens_id_seq is owned by Supabase and carries no select grant for backup_role (postgres has no grant option), so pg_dump stops at it. The table and its
# sequence are left out too: refresh tokens are short-lived session state (people sign in again after a restore), not pilot data.
excluded+=(auth.refresh_tokens auth.refresh_tokens_id_seq)
data_args=(--quote-all-identifier --no-comments --clean --if-exists -d "$db_name")
for t in "${excluded[@]}"; do data_args+=(--exclude-table "$t"); done
# platform-internal schemas the Supabase CLI leaves out of its dump (it keeps auth and storage for the data); their objects come from the image and its services
for s in 'information_schema' 'pg_*' graphql graphql_public pgsodium pgsodium_masks pgtle repack tiger tiger_data 'timescaledb_*' '_timescaledb_*' topology vault etl extensions pgbouncer realtime \
         _analytics _realtime _supavisor cron net supabase_functions dbdev pgmq; do data_args+=(--exclude-schema "$s"); done

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$out_dir/backup-$stamp.sql.age"

# One stream, roles first (a restore reads it top to bottom): both dumps go straight into age, so NO plain-text dump is ever written to disk. pipefail plus the status of every element
# decide the outcome; a failed dump leaves a partial ciphertext that the trap removes.
echo "backup: roles (pg_dumpall --roles-only --no-role-passwords), then schema and data (pg_dump, 21 platform-feature tables excluded), streamed into age"
(
  # each dump is counted on its own (its own wc -c file), so the floor of one cannot be met by the bytes of the other
  pgtool pg_dumpall --roles-only --no-role-passwords --quote-all-identifier --no-comments -l "$db_name" | tee >(wc -c > "$countdir/roles")
  rs=("${PIPESTATUS[@]}"); [ "${rs[0]}" = 0 ] && [ "${rs[1]}" = 0 ] || { echo "backup: the roles dump failed" >&2; exit 1; }
  pgtool pg_dump "${data_args[@]}" | tee >(wc -c > "$countdir/data")
  ds=("${PIPESTATUS[@]}"); [ "${ds[0]}" = 0 ] && [ "${ds[1]}" = 0 ] || { echo "backup: the schema and data dump failed" >&2; exit 1; }
) | limited 900 age -R "$recipients" -o "$final.part"
st=("${PIPESTATUS[@]}")
for c in "${st[@]}"; do [ "$c" = 0 ] || { echo "backup: the dump or the encryption failed (status ${st[*]})" >&2; exit 1; }; done
# the counters finish just after the pipeline; wait for both numbers (at most 10 s)
for _ in $(seq 1 100); do [ -s "$countdir/roles" ] && [ -s "$countdir/data" ] && break; sleep 0.1; done
roles_bytes="$(tr -d ' \n' < "$countdir/roles" 2>/dev/null)"
data_bytes="$(tr -d ' \n' < "$countdir/data" 2>/dev/null)"
[[ "$roles_bytes" =~ ^[0-9]+$ ]] && [ "$roles_bytes" -ge "$roles_min" ] || { echo "backup: the roles dump held ${roles_bytes:-no} bytes (minimum $roles_min): an empty or cut-off dump is not a backup" >&2; exit 1; }
[[ "$data_bytes" =~ ^[0-9]+$ ]] && [ "$data_bytes" -ge "$data_min" ] || { echo "backup: the schema and data dump held ${data_bytes:-no} bytes (minimum $data_min): an empty or cut-off dump is not a backup" >&2; exit 1; }
[ -s "$final.part" ] || { echo "backup: the encrypted file is empty" >&2; exit 1; }
mv "$final.part" "$final" || { echo "backup: cannot place the encrypted file" >&2; exit 1; }
echo "backup: wrote $final ($(wc -c < "$final" | tr -d ' ') bytes, encrypted; no plain-text file ever written)"
exit 0
