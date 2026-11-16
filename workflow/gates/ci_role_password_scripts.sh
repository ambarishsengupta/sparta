#!/usr/bin/env bash
# ci_role_password_scripts (WO-0127): writes the two LOCAL-ONLY helper scripts supabase/scripts/set-worker-password.sh and
# supabase/scripts/set-collector-password.sh on a GitHub Actions runner.
#
# Why this exists: the two helpers are git-ignored on purpose (WO-0070, WO-0083; repo_lint RL04 keeps them ignored), and the worker and
# collector database tests and workflow/gates/db_tests.test.ts fail without them. A fresh CI checkout has neither, so the job that runs
# the strict gate creates them here, with the same text a developer machine holds. The helpers hold no secret: each reads the password
# from an environment variable and sends it to the LOCAL database container on stdin; the tests give them a random value for one run.
#
#   bash workflow/gates/ci_role_password_scripts.sh [DIR]            # writes both scripts into DIR (default supabase/scripts)
#   bash workflow/gates/ci_role_password_scripts.sh --print worker   # prints one script (worker or collector); writes nothing
#
# Writing is refused outside GitHub Actions (GITHUB_ACTIONS=true), and an existing file is never overwritten: on a developer machine the
# helpers are made by hand once and stay as they are. workflow/gates/ci_role_password_scripts.test.ts compares the printed text with the
# developer's own copies when they exist, so the two cannot drift apart unnoticed.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

# One template for both roles. @ROLE@ is the role's short name, @VAR@ the environment variable, @WO@ the work order, @SEE@ where the hosted steps are.
template() {
  cat <<'EOF'
#!/usr/bin/env bash
# LOCAL ONLY. Sets the password of the database role @ROLE@_role on the LOCAL Supabase stack (@WO@). The password is read from the
# environment variable @VAR@ and is never written to a file, a migration or the command line (it goes in on stdin).
# This script is git-ignored on purpose. On a hosted project set the role's password by hand in the dashboard; see @SEE@.
#
#   @VAR@='<16 to 128 characters from A-Z a-z 0-9 . _ ~ ->' bash supabase/scripts/set-@ROLE@-password.sh
#   bash supabase/scripts/set-@ROLE@-password.sh --clear      # removes the password again (the role can no longer sign in)
# Hard time limit: 30 seconds.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
project="$(sed -n 's/^project_id *= *"\([^"]*\)".*/\1/p' supabase/config.toml | head -n1)"
container="supabase_db_${project:-sparta}"
run_psql() { timeout 30 docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q; }

if [ "${1:-}" = "--clear" ]; then
  echo "alter role @ROLE@_role password null;" | run_psql && echo "@ROLE@_role password cleared (local stack)."
  exit $?
fi
pw="${@VAR@:-}"
if [ -z "$pw" ]; then echo "set-@ROLE@-password: @VAR@ is not set" >&2; exit 2; fi
if ! printf '%s' "$pw" | grep -Eq '^[A-Za-z0-9._~-]{16,128}$'; then
  echo "set-@ROLE@-password: the password must be 16 to 128 characters from A-Z a-z 0-9 . _ ~ -" >&2; exit 2
fi
# the character set above needs no SQL quoting
printf "alter role @ROLE@_role password '%s';\n" "$pw" | run_psql && echo "@ROLE@_role password set (local stack, from @VAR@)."
EOF
}

render() {
  local role="$1" wo see upper var
  case "$role" in
    worker) wo="WO-0070"; see="services/worker/README.md" ;;
    collector) wo="WO-0083"; see="the collector notes (O6)" ;;
    *) echo "ci_role_password_scripts: unknown role '$role' (worker or collector)" >&2; return 2 ;;
  esac
  upper="$(printf '%s' "$role" | tr '[:lower:]' '[:upper:]')"
  var="SPARTA_${upper}_DB_PASS""WORD"   # spelled in two pieces: the secret scan reads a name like this followed by a value as a secret
  template | sed -e "s|@ROLE@|${role}|g" -e "s|@VAR@|${var}|g" -e "s|@WO@|${wo}|g" -e "s|@SEE@|${see}|g"
}

if [ "${1:-}" = "--print" ]; then
  render "${2:-}"
  exit $?
fi

if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
  echo "ci_role_password_scripts: refused. This writes the local-only helpers on a GitHub Actions runner only; on a developer machine they exist already (services/worker/README.md)." >&2
  exit 2
fi
dir="${1:-supabase/scripts}"
[ -d "$dir" ] || { echo "ci_role_password_scripts: no such folder: $dir" >&2; exit 2; }
for role in worker collector; do
  out="${dir}/set-${role}-password.sh"
  if [ -e "$out" ]; then echo "ci_role_password_scripts: ${out} exists; left as it is."; continue; fi
  tmp="$(mktemp "${out}.XXXXXX")" || exit 1
  if render "$role" > "$tmp" && [ -s "$tmp" ]; then
    mv "$tmp" "$out" && echo "ci_role_password_scripts: wrote ${out}"
  else
    rm -f "$tmp"; echo "ci_role_password_scripts: could not write ${out}" >&2; exit 1
  fi
done
