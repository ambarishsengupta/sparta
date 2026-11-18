#!/usr/bin/env python3
"""repo_lint: the lint for everything ESLint does not read (WO-0123, audit of 2026-11-15). Standard library only.

  python3 workflow/gates/repo_lint.py              # lint the tracked files and the new, not ignored files; exit 0 = clean, 1 = findings
  python3 workflow/gates/repo_lint.py --selftest   # prove that every rule fires on a bad sample and stays quiet on a good one

Rules (each finding prints `RLnn path: message`):
  RL01 forbidden-file     no env file, key file, database dump, model file or data table is tracked
  RL02 large-file         no tracked file over 1 MB
  RL03 hm-rows            no H&M article ids (row-level H&M data) in any tracked text file
  RL04 ignored-paths      the paths that hold secrets or licensed data are git-ignored
  RL05 python             no eval/exec, shell=True, verify=False, unsafe deserialising, bare except, or network call without a timeout
  RL06 requirements       every Python requirement is pinned with ==
  RL07 dockerfile         base images are pinned by digest and the image does not run as root
  RL08 workflows          GitHub workflows declare `permissions:` and pin actions to a commit
  RL09 shell              no pipe-to-shell download, no chmod 777, no --no-verify, no forced push in a script
  RL10 sql                no grant to anon or public, no security definer function without an empty search_path, no RLS switch-off
  RL11 work-items         a work order with a commit is not still `Todo`; every work order heading has a row in work-items.csv
  RL12 notebook-output    no notebook is committed with table or HTML outputs (that is how the H&M rows leaked)
  RL13 scope-lines        every `In scope:` line of a work order is a list scope_check.sh can read (no commentary, no brackets, no spaces in an item)
  RL14 gate-tool-errors   a gate script never captures a tool's output with its error output thrown away unless it uses the exit status

Exceptions live in workflow/gates/repo_lint.baseline.json and nowhere else:
  "allow":    permanent, each with a reason (for example the Fashion-MNIST model file that ships with the worker)
  "baseline": findings that existed when the rule was added, each with the work order that removes it
An entry that no longer matches a finding is itself an error, so the lists can only shrink.
"""
import ast
import csv
import io
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / 'workflow/gates/repo_lint.baseline.json'
MAX_BYTES = 1_000_000
BINARY_EXT = ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.onnx', '.woff', '.woff2', '.ico', '.zip', '.gz')

# ---- RL01 ----
FORBIDDEN_NAME = [
    (re.compile(r'(^|/)\.env(\.(?!example$)[^/]*)?$'), 'an env file (only *.example templates are tracked)'),
    (re.compile(r'(^|/)[^/]*local\.env$'), 'a local env file'),
    (re.compile(r'\.(pem|key|p12|pfx|keystore|jks)$|(^|/)id_(rsa|ed25519|ecdsa)[^/]*$'), 'a key or certificate file'),
    (re.compile(r'\.(sqlite3?|db|dump|bak)$|\.sql\.gz$'), 'a database file or dump'),
    (re.compile(r'\.(onnx|pt|pth|pkl|pickle|joblib|npy|npz|h5|safetensors)$'), 'a model or array file (trained files live in the private artifact location, LLD 7.8)'),
    (re.compile(r'\.(csv|tsv|parquet|feather|xlsx?)$'), 'a data table (row-level data is never committed)'),
    (re.compile(r'\.log$'), 'a log file'),
    (re.compile(r' [0-9]+(\.[^/]*)?$'), 'a cloud-sync duplicate ("name 2.ext")'),
]


def rl01(path, _text):
    return [why for pat, why in FORBIDDEN_NAME if pat.search(path)][:1]


# ---- RL03 ----
HM_ARTICLE = re.compile(r'(?<![0-9])0[1-9][0-9]{8}(?![0-9])')


def rl03(_path, text):
    ids = {i for i in HM_ARTICLE.findall(text) if not i.startswith('099')}   # 099... is reserved for invented test fixtures
    return [f'{len(ids)} H&M-style article ids (for example {sorted(ids)[0]}): row-level H&M data must not be committed (legal/HM-DEMO-DECISION.md)'] if len(ids) >= 3 else []


# ---- RL04 ----
MUST_BE_IGNORED = ['.env', '.env.local', '.env.production', 'apps/web/.env', 'apps/web/.env.local', 'apps/web/.env.production', 'services/worker/.env',
                   'jobs/collector/.env', 'workflow/local.env', 'data/recommendation-engine/hm', 'data/recommendation-engine/mnist/x',
                   'data/recommendation-engine/artifacts/x', 'workflow/demo/hm/out/x', 'submissions/D2/data/x', 'packages/rules/data/pairing-prior-v1.json',
                   'packages/rules/data/unlock-candidates.json', 'services/worker/models/garment-cnn-v2.onnx', 'supabase/scripts/set-worker-password.sh']


# ---- RL05 ----
NET_CALLS = {('urllib.request', 'urlopen'), ('request', 'urlopen'), ('requests', 'get'), ('requests', 'post'), ('requests', 'put'), ('requests', 'delete'),
             ('requests', 'head'), ('requests', 'request'), ('httpx', 'get'), ('httpx', 'post'), ('httpx', 'put'), ('httpx', 'delete'), ('httpx', 'request')}


def _dotted(node):
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return '.'.join(reversed(parts))


def rl05(path, text):
    try:
        tree = ast.parse(text, filename=path)
    except SyntaxError as e:
        return [f'does not parse: {e.msg} (line {e.lineno})']
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler) and node.type is None:
            out.append(f'line {node.lineno}: bare `except:` (name the exception; a bare one also swallows KeyboardInterrupt)')
        if not isinstance(node, ast.Call):
            continue
        name = _dotted(node.func)
        kw = {k.arg: k.value for k in node.keywords if k.arg}
        is_true = lambda v: isinstance(v, ast.Constant) and v.value is True     # noqa: E731
        is_false = lambda v: isinstance(v, ast.Constant) and v.value is False   # noqa: E731
        if isinstance(node.func, ast.Name) and name in ('eval', 'exec', 'compile', '__import__'):
            out.append(f'line {node.lineno}: {name}() runs text as code')
        if name in ('os.system', 'os.popen') or (name.startswith('subprocess.') and 'shell' in kw and is_true(kw['shell'])):
            out.append(f'line {node.lineno}: {name} through a shell (pass an argument list, no shell)')
        if 'verify' in kw and is_false(kw['verify']):
            out.append(f'line {node.lineno}: verify=False switches off TLS certificate checks')
        if name in ('pickle.load', 'pickle.loads', 'marshal.loads', 'shelve.open', 'tempfile.mktemp') or (name == 'yaml.load' and 'Loader' not in kw):
            out.append(f'line {node.lineno}: {name} is unsafe on untrusted input (or racy); use a safe form')
        if name == 'torch.load' and not ('weights_only' in kw and is_true(kw['weights_only'])):
            out.append(f'line {node.lineno}: torch.load without weights_only=True can run code from the file')
        mod, _, fn = name.rpartition('.')
        if (mod, fn) in NET_CALLS and 'timeout' not in kw and not (fn == 'urlopen' and len(node.args) >= 3):
            out.append(f'line {node.lineno}: {name} without a timeout can hang for ever (rule 11)')
    return out


# ---- RL06 ----
def rl06(_path, text):
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        s = line.split('#')[0].strip()
        if not s or s.startswith(('-r ', '-c ', '--')):
            continue
        if not re.fullmatch(r'[A-Za-z0-9_.\-]+(\[[A-Za-z0-9_,\-]+\])?==[A-Za-z0-9_.!+\-]+', s):
            out.append(f'line {n}: `{s}` is not pinned with == (a floating version changes what was tested)')
    return out


# ---- RL07 ----
def rl07(_path, text):
    out = []
    froms = re.findall(r'^\s*FROM\s+(\S+)', text, re.M | re.I)
    for image in froms:
        if image.lower() != 'scratch' and '@sha256:' not in image:
            out.append(f'base image `{image}` is not pinned by digest (name@sha256:...)')
    users = re.findall(r'^\s*USER\s+(\S+)', text, re.M | re.I)
    if froms and (not users or users[-1] in ('root', '0')):
        out.append('the image runs as root (add a USER line with an unprivileged user)')
    return out


# ---- RL08 ----
def rl08(_path, text):
    out = []
    if not re.search(r'^permissions:', text, re.M):
        out.append('no top-level `permissions:` (the default token can write to the repository; start from `contents: read`)')
    for m in re.finditer(r'^\s*-?\s*uses:\s*(\S+)', text, re.M):
        ref = m.group(1)
        if not ref.startswith('./') and not re.search(r'@[0-9a-f]{40}$', ref):
            out.append(f'action `{ref}` is not pinned to a commit (use the 40-character commit id; a tag can be moved)')
    if re.search(r'pull_request_target', text):
        out.append('`pull_request_target` runs with secrets on code from a fork')
    return out


# ---- RL09 ----
SHELL_BAD = [
    (re.compile(r'(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z|da)?sh\b'), 'a download piped into a shell'),
    (re.compile(r'chmod\s+(-R\s+)?0?777\b'), 'chmod 777'),
    (re.compile(r'git\s+(commit|push|merge)\b[^\n]*--no-verify'), 'git with --no-verify'),
    (re.compile(r'git\s+push\b[^\n#]*(\s--force(?!-with-lease)|\s-f\b)'), 'a forced push'),
    (re.compile(r'supabase\s+(db\s+(reset|push)|migration\s+repair)\b[^\n#]*--(linked|db-url)'), 'a database command aimed at a hosted project'),
]


def rl09(_path, text):
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith('#'):
            continue
        out += [f'line {n}: {why}' for pat, why in SHELL_BAD if pat.search(line)]
    return out


# ---- RL10 ----
SQL_BAD = [
    (re.compile(r'\b(disable|no\s+force)\s+row\s+level\s+security\b', re.I), 'row-level security switched off'),
    (re.compile(r'\b(bypassrls|superuser|createrole)\b', re.I), 'a role with bypassrls, superuser or createrole'),
    (re.compile(r'security_invoker\s*=\s*(false|off|0)\b', re.I), 'a view that runs with its owner\'s rights'),
]
# The one bypassrls role the design requires (backup_role, LLD 4.5 and 13.3, WO-0163): its exact create statement with only these
# attributes may say bypassrls; any other role, or backup_role with any other attribute (superuser, createrole, ...), still fails.
BACKUP_ROLE_OK = re.compile(r'\bcreate\s+role\s+backup_role\s+with(?:\s+(?:login|nosuperuser|nocreatedb|nocreaterole|noinherit|noreplication|bypassrls|connection\s+limit\s+\d+))+\s*;', re.I)
FUNC_START = re.compile(r'\bcreate\s+(?:or\s+replace\s+)?function\s+([A-Za-z_][\w.]*)', re.I)
DOLLAR = re.compile(r'\$[A-Za-z_]*\$')


def _strip_sql_comments(text):
    return re.sub(r'--[^\n]*', '', text)


def rl10(_path, text):
    out = []
    sql = _strip_sql_comments(text)
    bare = re.sub(r"'(?:[^']|'')*'", lambda m: "''" + chr(10) * m.group(0).count(chr(10)), sql)   # string literals emptied, line numbers kept
    bare = BACKUP_ROLE_OK.sub(lambda m: re.sub(r'bypassrls', ' ' * 9, m.group(0), flags=re.I), bare)   # the allowed backup_role statement, same length
    for pat, why in SQL_BAD:
        for m in pat.finditer(bare):
            out.append(f'line {bare.count(chr(10), 0, m.start()) + 1}: {why}')
    for m in re.finditer(r'\bgrant\b[^;]*?\bto\s+([^;]+);', sql, re.I | re.S):
        grantees = {g.strip().lower() for g in re.split(r'[,\s]+', m.group(1).split("'")[0]) if g.strip()}   # a grant built with format() ends at its quote
        stmt = ' '.join(m.group(0).split())
        if grantees & {'anon', 'public'}:
            out.append(f'grant to anon or public: `{stmt[:110]}`')
        if re.match(r'grant\s+all\b', stmt, re.I) and grantees != {'service_role'}:
            out.append(f'`grant all` to a role other than service_role (grant the named privileges only): `{stmt[:110]}`')
    for m in FUNC_START.finditer(sql):
        first = DOLLAR.search(sql, m.end())
        if not first:
            continue
        close = sql.find(first.group(0), first.end())
        end = sql.find(';', close if close >= 0 else first.end())
        outside = sql[m.start():first.start()] + (sql[close + len(first.group(0)):end if end >= 0 else len(sql)] if close >= 0 else '')
        if re.search(r'\bsecurity\s+definer\b', outside, re.I) and not re.search(r"\bset\s+search_path\s*(=|to)\s*''", outside, re.I):
            out.append(f'function {m.group(1)}: security definer without `set search_path = \'\'`')
    return out


# ---- RL12 ----
def rl12(_path, text):
    try:
        nb = json.loads(text)
    except ValueError:
        return ['is not valid JSON']
    bad = 0
    for cell in nb.get('cells', []):
        for o in cell.get('outputs', []):
            data = o.get('data', {})
            html = ''.join(data.get('text/html', [])) if isinstance(data.get('text/html'), list) else str(data.get('text/html', ''))
            if '<table' in html or 'application/vnd.dataframe' in data:
                bad += 1
    return [f'{bad} cell output(s) hold a rendered table: clear outputs before committing (tables are how row-level data leaks)'] if bad else []


# ---- RL13 ----
# The same reading as workflow/gates/scope_check.sh: the items are separated by commas or semicolons, and an item with a bracket or with
# whitespace in it is a parse error there (exit 2), which fails the gate of that work order at its very last stage. Found three times in
# the run of 15 and 16 November 2026 (WO-0128 "(one new migration)", WO-0126 "app/(auth)/...", WO-0130), each only when a gate ran.
def rl13(_path, text):
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        if not line.startswith('In scope:'):
            continue
        for item in re.split(r'[,;]', line[len('In scope:'):].strip()):
            item = item.strip()
            if item == '':
                out.append(f'line {n}: an empty item in the In scope line (a stray comma or semicolon)')
            elif re.search(r'[()]', item):
                out.append(f'line {n}: `{item}`: a bracket in an In scope item. Put commentary on the Note: line; write each bracket of a route-group folder such as (auth) as ? (app/?auth?/**)')
            elif re.search(r'\s', item):
                out.append(f'line {n}: `{item}`: whitespace in an In scope item. One path or glob per item; put the words on the Note: line')
    return out


# ---- RL14 ----
# A gate stage that runs a tool as  out="$(tool ... 2>/dev/null)"  and then reads `out` cannot tell a tool that found nothing from a tool
# that crashed: both give no output. db_lint.sh did this and would have reported PASS on a broken linter (found by the WO-0128 check).
# Allowed: the same line uses the exit status (`|| ...`, `$?`, or the capture is the condition of an `if`).
CAPTURE_NO_STDERR = re.compile(r'\$\([^()]*2>\s*/dev/null[^()]*\)')


def rl14(_path, text):
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        code = line.split(' #', 1)[0]
        if code.lstrip().startswith('#') or not CAPTURE_NO_STDERR.search(code):
            continue
        if '||' in code or '$?' in code or re.match(r'\s*(if|elif|while|until)\b', code):
            continue
        out.append(f'line {n}: a tool\'s output is captured with its error output thrown away and its exit status unused: a crashed tool then reads as a clean one. Keep the errors (2>"$err") and fail on a non-zero status')
    return out


def kind_rules(path):
    """Which per-file rules read this path (RL01 and RL03 read every file)."""
    name = path.rsplit('/', 1)[-1]
    rules = []
    if path.endswith('.py'):
        rules.append(('RL05', rl05))
    if re.fullmatch(r'requirements[\w.\-]*\.txt', name):
        rules.append(('RL06', rl06))
    if name == 'Dockerfile' or name.startswith('Dockerfile.'):
        rules.append(('RL07', rl07))
    if path.startswith('.github/workflows/') and name.endswith(('.yml', '.yaml')):
        rules.append(('RL08', rl08))
    if path.endswith('.sh'):
        rules.append(('RL09', rl09))
    if path.startswith('supabase/migrations/') and path.endswith('.sql'):
        rules.append(('RL10', rl10))
    if path.endswith('.ipynb'):
        rules.append(('RL12', rl12))
    if re.fullmatch(r'workflow/work-orders/[^/]+\.md', path):
        rules.append(('RL13', rl13))
    if re.fullmatch(r'workflow/gates/[^/]+\.sh', path):
        rules.append(('RL14', rl14))
    return rules


def git(*args):
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, timeout=60)


def rl11():
    out = []
    csv_path = ROOT / 'workflow/github/work-items.csv'
    if not csv_path.exists():
        return out
    rows = {r['id']: r for r in csv.DictReader(io.StringIO(csv_path.read_text(encoding='utf-8')))}
    headed = set()
    for f in sorted((ROOT / 'workflow/work-orders').glob('*.md')):
        headed |= set(re.findall(r'^# Work Order (WO-\d{4})\b', f.read_text(encoding='utf-8'), re.M))
    for wid in sorted(headed - set(rows)):
        out.append(('workflow/github/work-items.csv', f'{wid} has a work order but no row (add it with workflow/github/sync_github_project.py --add)'))
    log = git('log', '--format=%s', 'HEAD')
    done = set(re.findall(r'\b(WO-\d{4}):', log.stdout)) if log.returncode == 0 else set()
    for wid in sorted(done & set(rows)):
        if rows[wid]['status'] == 'Todo':
            out.append(('workflow/github/work-items.csv', f'{wid} has a commit but its status is Todo (set it with workflow/github/sync_github_project.py {wid}=Done)'))
    return out


def collect():
    """Every finding as (rule, path, message)."""
    found = []
    # tracked files AND new files that are not ignored: a file is linted before its first commit, not after
    listed = git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
    if listed.returncode != 0:
        print('repo_lint: cannot list tracked files (is this a git checkout?)')
        sys.exit(2)
    for path in [p for p in listed.stdout.split('\0') if p]:
        full = ROOT / path
        if not full.is_file():
            continue
        found += [('RL01', path, why) for why in rl01(path, '')]
        size = full.stat().st_size
        if size > MAX_BYTES:
            found.append(('RL02', path, f'{size:,} bytes (limit {MAX_BYTES:,}): large files belong outside the repository'))
        if path.lower().endswith(BINARY_EXT):
            continue
        try:
            text = full.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError):
            continue
        found += [('RL03', path, msg) for msg in rl03(path, text)]
        for rule, fn in kind_rules(path):
            found += [(rule, path, msg) for msg in fn(path, text)]
    for p in MUST_BE_IGNORED:
        if git('check-ignore', '-q', p).returncode != 0:
            found.append(('RL04', '.gitignore', f'`{p}` is not ignored: a secret or licensed file saved there could be committed'))
    found += [('RL11', path, msg) for path, msg in rl11()]
    return found


def apply_exceptions(found):
    """Drop findings covered by the baseline file. An entry covers every finding of its rule in its path. Unused entries are errors."""
    try:
        data = json.loads(BASELINE.read_text(encoding='utf-8')) if BASELINE.exists() else {}
    except ValueError as e:
        return found + [('RL00', str(BASELINE.relative_to(ROOT)), f'not valid JSON: {e}')], 0
    entries, problems = [], []
    for section, needs in (('allow', 'reason'), ('baseline', 'work_order')):
        for e in data.get(section, []):
            if not isinstance(e, dict) or not e.get('rule') or not e.get('path') or not e.get(needs) or not e.get('reason'):
                problems.append(('RL00', 'workflow/gates/repo_lint.baseline.json', f'{section} entry {json.dumps(e)[:90]} needs rule, path, reason' + (' and work_order' if section == 'baseline' else '')))
            else:
                entries.append((e['rule'], e['path']))
    used, kept = set(), []
    for rule, path, msg in found:
        if (rule, path) in entries:
            used.add((rule, path))
        else:
            kept.append((rule, path, msg))
    for rule, path in entries:
        if (rule, path) not in used:
            problems.append(('RL00', 'workflow/gates/repo_lint.baseline.json', f'the entry for {rule} {path} matches nothing any more: delete it'))
    return kept + problems, len(used)


SAMPLES = [
    ('RL01', rl01, 'apps/web/.env.production', '', 'apps/web/.env.example', ''),
    ('RL01', rl01, 'data/customers.csv', '', 'data/README.md', ''),
    ('RL01', rl01, 'package 2.json', '', 'package.json', ''),
    # the firing sample is built here, so this file holds no real-looking article id of its own
    ('RL03', rl03, 'x.md', ' '.join('0' + str(d) * 9 for d in (5, 6, 7)), 'x.md', '0990000001 0990000002 0990000003 2026111200'),
    ('RL05', rl05, 'x.py', 'import subprocess\nsubprocess.run("ls", shell=True)\n', 'x.py', 'import subprocess\nsubprocess.run(["ls"], timeout=5)\nnet.eval()\n'),
    ('RL05', rl05, 'x.py', 'try:\n    pass\nexcept:\n    pass\n', 'x.py', 'try:\n    pass\nexcept ValueError:\n    pass\n'),
    ('RL05', rl05, 'x.py', 'import httpx\nhttpx.get(u, verify=False, timeout=3)\n', 'x.py', 'import httpx\nhttpx.get(u, timeout=3)\n'),
    ('RL05', rl05, 'x.py', 'import urllib.request\nurllib.request.urlopen(u)\n', 'x.py', 'import urllib.request\nurllib.request.urlopen(u, timeout=3)\n'),
    ('RL05', rl05, 'x.py', 'import torch\ntorch.load(p)\n', 'x.py', 'import torch\ntorch.load(p, weights_only=True)\n'),
    ('RL06', rl06, 'requirements.txt', 'pandas>=2.0\n', 'requirements.txt', '# pins\n-r base.txt\npandas==3.1.1\npsycopg[binary]==3.3.8\n'),
    ('RL07', rl07, 'Dockerfile', 'FROM python:3.13-slim\nUSER worker\n', 'Dockerfile', 'FROM python:3.13-slim@sha256:' + 'a' * 64 + '\nUSER worker\n'),
    ('RL07', rl07, 'Dockerfile', 'FROM x@sha256:' + 'a' * 64 + '\n', 'Dockerfile', 'FROM x@sha256:' + 'a' * 64 + '\nUSER app\n'),
    ('RL08', rl08, 'ci.yml', 'on: push\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n', 'ci.yml', 'on: push\npermissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@' + 'b' * 40 + '\n'),
    ('RL09', rl09, 'x.sh', 'curl -s https://example.test/i.sh | bash\n', 'x.sh', '# curl x | bash is forbidden\ncurl -s -o /dev/null http://127.0.0.1:1/\n'),
    ('RL09', rl09, 'x.sh', 'git push --force origin main\n', 'x.sh', 'git push --force-with-lease origin wo/WO-0001\n'),
    ('RL10', rl10, 'm.sql', 'grant execute on function app.f() to anon;\n', 'm.sql', 'grant execute on function app.f() to authenticated;\n'),
    ('RL10', rl10, 'm.sql', 'create role other_role with login bypassrls;\n', 'm.sql', 'create role backup_role with login nosuperuser nocreatedb nocreaterole noinherit bypassrls noreplication connection limit 2;\n'),
    ('RL10', rl10, 'm.sql', 'create role backup_role with login superuser bypassrls;\n', 'm.sql', 'create role backup_role with login noinherit bypassrls;\n'),
    ('RL10', rl10, 'm.sql', "create function app.f() returns int language sql security definer as $$ select 1 $$;\n", 'm.sql', "create function app.f() returns int language sql security definer set search_path = '' as $$ select 1 $$;\ncreate function app.g() returns int language sql as $f$ select 1 $f$;\n"),
    ('RL10', rl10, 'm.sql', 'alter table app.items disable row level security;\n', 'm.sql', "-- never disable row level security\nalter table app.items enable row level security;\ncomment on role w is 'not a superuser';\n"),
    ('RL10', rl10, 'm.sql', 'grant all on app.items to authenticated;\n', 'm.sql', 'grant all on app.items to service_role;\ngrant select on app.items to authenticated;\n'),
    ('RL12', rl12, 'x.ipynb', json.dumps({'cells': [{'outputs': [{'data': {'text/html': ['<table><tr><td>1</td></tr></table>']}}]}]}), 'x.ipynb', json.dumps({'cells': [{'outputs': []}]})),
    ('RL13', rl13, 'workflow/work-orders/X.md', 'In scope: supabase/migrations/** (one new migration), docs/x.md\n', 'workflow/work-orders/X.md', 'In scope: supabase/migrations/**, apps/web/app/*/sign-up/page.tsx; docs/x.md\nNote: one new migration (see above).\n'),
    ('RL13', rl13, 'workflow/work-orders/X.md', 'In scope: workflow/gates/release_map.py and its data\n', 'workflow/work-orders/X.md', 'Instructions: read the files (all of them), then build.\nIn scope: apps/web/app/api/admin/sources/[id]/takedown/route.ts\n'),
    ('RL13', rl13, 'workflow/work-orders/X.md', 'In scope: a.ts,, b.ts\n', 'workflow/work-orders/X.md', 'In scope: a.ts, b.ts\n'),
    ('RL14', rl14, 'workflow/gates/x.sh', 'out="$(limited supabase db lint --level warning 2>/dev/null </dev/null)"\n', 'workflow/gates/x.sh', 'out="$(limited supabase db lint --level warning 2>"$err" </dev/null)"; rc=$?\n'),
    ('RL14', rl14, 'workflow/gates/x.sh', 'n="$(tool --count 2> /dev/null)"\necho "$n"\n', 'workflow/gates/x.sh', 'got="$(bash "$script" --parse-only "$wo" 2>/dev/null)"; got_rc=$?\nif ! v="$(tool 2>/dev/null)"; then exit 1; fi\nst="$(tool 2>/dev/null)" || exit 1\nsupabase status >/dev/null 2>&1\n# out="$(tool 2>/dev/null)"\n'),
]


def selftest():
    bad = 0
    for rule, fn, bad_path, bad_text, good_path, good_text in SAMPLES:
        if not fn(bad_path, bad_text):
            bad += 1
            print(f'selftest FAIL: {rule} did not fire on {bad_path!r}: {bad_text[:60]!r}')
        if fn(good_path, good_text):
            bad += 1
            print(f'selftest FAIL: {rule} fired on the good sample {good_path!r}: {fn(good_path, good_text)}')
    rules_tested = {s[0] for s in SAMPLES}
    print(f'repo_lint selftest: {len(SAMPLES)} samples over {len(rules_tested)} rules, {bad} failure(s)')
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        return selftest()
    found, covered = apply_exceptions(collect())
    for rule, path, msg in sorted(found):
        print(f'{rule} {path}: {msg}')
    if found:
        print(f'repo_lint: FAIL ({len(found)} finding(s); {covered} path(s) covered by the baseline file)')
        return 1
    print(f'repo_lint: PASS ({covered} path(s) covered by workflow/gates/repo_lint.baseline.json)')
    return 0


if __name__ == '__main__':
    os.environ.setdefault('PYTHONDONTWRITEBYTECODE', '1')
    sys.exit(main())
