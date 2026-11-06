#!/usr/bin/env bash
# web_containment.sh (WO-0074): the gate stage that RUNS the build-output containment check, which build-output.test.ts otherwise skips when
# apps/web/.next does not exist. It builds the web app with a dummy secret-looking key and a dummy worker token in the build environment, runs
# apps/web/lib/server/build-output.test.ts against that build with SPARTA_REQUIRE_BUILD=1 (a missing build is then a test FAILURE), and deletes
# apps/web/.next afterwards, pass or fail. The dummy values are random per run and exist only in this process's environment. The stage prints
# SKIPPED (exit 0) only when Node, npm or the web workspace is unavailable.
# Every child has a hard timeout (rule 11): BUILD_TIMEOUT / TEST_TIMEOUT seconds. Nothing is left running when this script ends.
set -uo pipefail

WEB="${WEB_WORKSPACE:-apps/web}"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1 || [ ! -f "${WEB}/package.json" ]; then
  echo "web_containment: SKIPPED (node, npm or the web workspace '${WEB}' is not available)"
  exit 0
fi

ROOT="$(cd "${BASH_SOURCE[0]%/*}/../.." && pwd)"
cd "$ROOT" || exit 2
BUILD_TIMEOUT="${BUILD_TIMEOUT:-900}"
TEST_TIMEOUT="${TEST_TIMEOUT:-300}"

# Run a command with a hard time limit (GNU timeout, Homebrew's gtimeout, or perl's alarm); stdin is closed.
limited() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout -k 10 "$secs" "$@" </dev/null
  elif command -v gtimeout >/dev/null 2>&1; then gtimeout -k 10 "$secs" "$@" </dev/null
  else perl -e 'alarm shift; exec @ARGV' "$secs" "$@" </dev/null
  fi
}

cleanup() { rm -rf "${ROOT}/${WEB}/.next"; }
trap cleanup EXIT
cleanup   # a build left by an earlier command is replaced by this one

# Random dummy values, assembled here so this script holds no key-shaped text. Same shape as the real ones (prefix, long tail).
rand_a="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")"
rand_b="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")"
rand_c="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")"
prefix_a=sb; prefix_b=secret; prefix_c=publishable
dummy_key="${prefix_a}_${prefix_b}_${rand_a}"
dummy_worker="${rand_b}"
dummy_public="${prefix_a}_${prefix_c}_${rand_c}"

echo "web_containment: building ${WEB} with a dummy secret key and worker token in the environment"
build_log="${TMPDIR:-/tmp}/web_containment_build.$$.log"
build() {   # a subshell: the dummy values are exported for the build only
  export SUPABASE_SECRET_KEY="${dummy_key}"
  export WORKER_API_TOKEN="${dummy_worker}"
  export NEXT_PUBLIC_DATA_BACKEND=supabase
  export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
  export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="${dummy_public}"
  limited "$BUILD_TIMEOUT" npm run build -w "${WEB}"
}
if ! (build) >"$build_log" 2>&1; then
  echo "web_containment: the build failed or timed out; last lines of its log:"
  tail -n 25 "$build_log"
  rm -f "$build_log"
  exit 1
fi
rm -f "$build_log"

echo "web_containment: running the containment test against that build"
containment() {
  export SPARTA_REQUIRE_BUILD=1
  export SPARTA_CONTAINMENT_KEY="${dummy_key}"
  export SPARTA_CONTAINMENT_WORKER="${dummy_worker}"
  limited "$TEST_TIMEOUT" npx vitest run "${WEB}/lib/server/build-output.test.ts"
}
(containment)
status=$?
cleanup
if [ "$status" -ne 0 ]; then echo "web_containment: FAILED (exit ${status})"; exit 1; fi
echo "web_containment: the built bundles contain no secret key, worker token or key value; .next removed"
exit 0
