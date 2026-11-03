#!/usr/bin/env bash
# BR-43 gate: no secrets in the repository.
#
# Usage:  bash workflow/gates/secret_scan.sh [DIR]     scan tracked + untracked non-ignored files (default: repo root)
#         bash workflow/gates/secret_scan.sh --selftest
#
# Exit 0 = nothing found. Exit 1 = findings, listed as file:line (rule, redacted prefix); the secret
# value is NEVER printed. Excluded: package-lock.json, node_modules, .git, binary files. The
# VAR=value rule also skips *.example files and Markdown/docs files, which only DESCRIBE variable names;
# the token-shaped rules (keys, JWTs, tokens) apply to every scanned file, docs included.
set -uo pipefail

scan() {
  local dir="$1"
  [ -d "$dir" ] || { echo "secret_scan: not a directory: $dir" >&2; return 2; }
  python3 - "$dir" <<'PY'
import os, re, subprocess, sys

root = os.path.abspath(sys.argv[1])

def file_list():
    try:
        top = subprocess.run(['git', '-C', root, 'rev-parse', '--show-toplevel'], capture_output=True, text=True, check=True).stdout.strip()
        if os.path.realpath(top) == os.path.realpath(root):
            out = subprocess.run(['git', '-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
                                 capture_output=True, check=True).stdout
            return sorted(set(p for p in out.decode('utf-8', 'surrogateescape').split('\0') if p))
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    found = []
    for d, dirs, names in os.walk(root):
        dirs[:] = [x for x in dirs if x not in ('.git', 'node_modules')]
        for n in names:
            found.append(os.path.relpath(os.path.join(d, n), root))
    return sorted(found)

# Pattern sources are split so this script does not match its own rules.
RULES = [
    ('private-key-header', re.compile('-----' + 'BEGIN .*PRIVATE KEY' + '-----')),
    ('aws-access-key', re.compile('AK' + 'IA[0-9A-Z]{16}')),
    ('sk-key', re.compile('sk' + '-[A-Za-z0-9]{20,}')),
    ('jwt-service-key', re.compile('ey' + r'J[A-Za-z0-9_-]{30,}\.ey' + 'J')),
    ('github-token', re.compile('gh' + 'p_[A-Za-z0-9]{30,}')),
]
ASSIGN = re.compile(r'(?<![A-Za-z0-9])[A-Za-z0-9_]*(?:SERVICE_ROLE|SECRET|PASSWORD|TOKEN)[A-Z0-9_]*\s*[=:]\s*(\S.*)$')
PLACEHOLDER = re.compile(
    r'^(?:<.*|\$\{.*\}?|\$\(.*|\$[A-Za-z_].*|\{\{.*|%.*%|\.{2,}|\*+|x{3,}|X{3,}|-+|'
    r'(?:your|my|example|sample|dummy|fake|test|changeme|change-me|replace|placeholder|redacted|todo|tbd|null|none|undefined|true|false|unset|empty|secret|password|token)\b.*|'
    r'process\.env.*|import\.meta.*|os\.environ.*|secrets\..*|env\..*|vars\..*)$', re.I)

def is_placeholder(raw):
    v = raw.strip().rstrip(',;').strip()
    v = v.strip('"\'`').strip()
    if v == '' or PLACEHOLDER.match(v):
        return True
    # a value with no letters and digits at all (e.g. punctuation only) carries no secret
    return not re.search(r'[A-Za-z0-9]', v)

def skip_file(p):
    base = os.path.basename(p)
    parts = p.split('/')
    return base == 'package-lock.json' or 'node_modules' in parts or '.git' in parts

def assign_exempt(p):
    low = p.lower()
    return low.endswith('.example') or '.example.' in os.path.basename(low) or low.endswith(('.md', '.mdx')) or low.startswith('docs/')

findings = []
for rel in file_list():
    if skip_file(rel):
        continue
    path = os.path.join(root, rel)
    if not os.path.isfile(path) or os.path.islink(path):
        continue
    try:
        data = open(path, 'rb').read()
    except OSError:
        continue
    if b'\0' in data[:8192]:
        continue
    text = data.decode('utf-8', 'replace')
    for n, line in enumerate(text.split('\n'), 1):
        for name, rx in RULES:
            m = rx.search(line)
            if m:
                shown = name if name == 'private-key-header' else m.group(0)[:4] + '...[redacted]'
                findings.append((rel, n, name, shown))
        if not assign_exempt(rel):
            m = ASSIGN.search(line)
            if m and not is_placeholder(m.group(1)):
                findings.append((rel, n, 'secret-assignment', m.group(1).strip().strip('"\'`')[:2] + '...[redacted]'))

if findings:
    print('secret_scan: FAIL, possible secrets found (values are redacted):', file=sys.stderr)
    for rel, n, name, shown in findings:
        print(f'  {rel}:{n}  {name}  {shown}', file=sys.stderr)
    sys.exit(1)
print(f'secret_scan: PASS (no secrets found in {len(file_list())} candidate files)')
PY
}

selftest() {
  local script rc=0 tmp out
  script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  tmp="$(mktemp -d)"

  # Fake secrets are assembled at run time so this file holds no literal secret.
  local aws="AK""IA""ABCDEFGHIJKLMNOP"
  local sk="sk""-abcdefghijklmnopqrstuvwxyz0123"
  local jwt="ey""JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef.ey""JzdWIiOiIxMjM0NTY3ODkwIn0"
  local ghp="gh""p_abcdefghijklmnopqrstuvwxyz0123456789"
  local pem="-----""BEGIN RSA PRIVATE KEY""-----"
  local var="SUPABASE_SERVICE""_ROLE_KEY"
  local assign="${var}=realvalue12345"

  # 1) a dir with a fake secret, untracked in a fresh git repo: must exit 1 and never echo the value
  local i=0 label val
  for val in "$aws" "$sk" "$jwt" "$ghp" "$pem" "$assign"; do
    i=$((i + 1))
    rm -rf "$tmp/dirty"; mkdir -p "$tmp/dirty"
    ( cd "$tmp/dirty" && git init -q . && printf 'line one\nconfig %s\n' "$val" > leak.txt )
    out="$(bash "$script" "$tmp/dirty" 2>&1)"; local code=$?
    if [ "$code" -ne 1 ]; then echo "selftest FAIL: fake secret #$i exited $code, expected 1"; rc=1
    elif printf '%s' "$out" | grep -qF -- "${val#*=}"; then echo "selftest FAIL: fake secret #$i was printed in full"; rc=1
    elif ! printf '%s' "$out" | grep -q 'leak.txt:2'; then echo "selftest FAIL: fake secret #$i not reported as file:line"; rc=1
    else echo "selftest ok: fake secret #$i exits 1 and is redacted (leak.txt:2)"; fi
  done

  # 2) a clean dir, including allowed look-alikes (*.example values, placeholders, docs naming variables): exit 0
  rm -rf "$tmp/clean"; mkdir -p "$tmp/clean/docs"
  ( cd "$tmp/clean" && git init -q . \
    && printf '%s=realvalue12345\n' "$var" > .env.example \
    && printf '%s=\nAPI_TOKEN=<your-token>\nDB_PASSWORD=${DB_PASSWORD}\n' "$var" > settings.env \
    && printf 'Set %s=abc123 in your shell.\n' "$var" > docs/setup.md \
    && printf 'hello\n' > a.txt )
  out="$(bash "$script" "$tmp/clean" 2>&1)"; local cc=$?
  if [ "$cc" -ne 0 ]; then echo "selftest FAIL: clean dir exited $cc, expected 0"; printf '%s\n' "$out"; rc=1
  else echo "selftest ok: clean dir exits 0"; fi

  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "secret_scan selftest: PASS"
  return "$rc"
}

if [ "${1:-}" = "--selftest" ]; then selftest; exit $?; fi
if [ "$#" -gt 1 ]; then echo "usage: secret_scan.sh [DIR] | --selftest" >&2; exit 2; fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scan "${1:-$ROOT}"
exit $?
