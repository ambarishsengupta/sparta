#!/usr/bin/env python3
"""Create the Sparta GitHub project: labels, milestones (Release 0 / Release 1), issues for every work item, a Projects v2 board with
Release / Slice / Role fields, and (only with --invite) the three members' repository roles.
Default is a DRY RUN that prints what it would do. It never logs in for you: run `gh auth login` and `gh auth refresh -s project` first.
Usage:  python3 workflow/github/setup_github_project.py                 # dry run, prints the plan and writes work-items.csv
        python3 workflow/github/setup_github_project.py --apply         # create labels, milestones, issues, project
        python3 workflow/github/setup_github_project.py --apply --invite  # also invite the members (sends GitHub emails)
Env: SPARTA_REPO (default ambarishsengupta/sparta), SPARTA_PROJECT_OWNER (default: repo owner),
     GH_AMBARISH, GH_PRASHANTH, GH_ARPAN (GitHub usernames; required only for --invite and for assignees)."""
import csv, json, os, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPO = os.environ.get('SPARTA_REPO', 'ambarishsengupta/sparta')
OWNER = os.environ.get('SPARTA_PROJECT_OWNER', REPO.split('/')[0])
APPLY, INVITE = '--apply' in sys.argv, '--invite' in sys.argv

# Roles from BRD section 4 (stakeholders): product owner, solution architect (reviews HLD/LLD), style specialist (taxonomy, rules, weights, G9 review).
MEMBERS = [
    ('Ambarish Sengupta', 'GH_AMBARISH', 'Product owner', 'admin'),
    ('C. Prashanth', 'GH_PRASHANTH', 'Solution architect', 'write'),
    ('Arpan Shah', 'GH_ARPAN', 'Style specialist', 'triage'),
]
ROLES = ['Product owner', 'Solution architect', 'Style specialist', 'Delivery agents']
RELEASES = ['Release 0 (stakeholder demo)', 'Release 1 (MVP)']
NOT_DONE = {'WO-0084': 'In progress', 'WO-0085': 'Todo', 'WO-0086': 'Todo', 'WO-0087': 'Todo', 'WO-0088': 'Todo',
            'WO-0089': 'Todo', 'WO-0090': 'Todo', 'WO-0091': 'Todo', 'WO-0097': 'Todo'}
RELEASE1_WOS = {'WO-0089', 'WO-0090', 'WO-0091'}  # receipt reading moved to Release 1 on 2026-11-07
SLICE_OF_FILE = {'R0': 'R0', 'R1': 'R1', 'R2': 'R2a', 'R2b': 'R2b', 'R2c': 'R2c', 'R3': 'R3', 'R4': 'R4', 'R5': 'R5a', 'R5b': 'R5b', 'Demo': 'Demo'}

def items():
    out = []
    for f in sorted((ROOT / 'workflow/work-orders').glob('*.md')):
        for m in re.finditer(r'^# Work Order (WO-\d{4}): (.+)$', f.read_text(), re.M):
            wid, title = m.group(1), m.group(2).strip()
            if f.stem == 'R6':
                n = int(wid[3:]); slice_ = 'R6a' if n in (80, 81, 82, 92) else 'R6b' if n in (83, 84, 85) else 'R6c' if n in (86, 87, 88) else 'R6d'
            else:
                slice_ = SLICE_OF_FILE.get(f.stem, f.stem)
            rel = RELEASES[1] if wid in RELEASE1_WOS else RELEASES[0]
            out.append(dict(id=wid, title=f'{wid}: {title}', slice=slice_, release=rel, role='Delivery agents', status=NOT_DONE.get(wid, 'Done'),
                            body=f'Work order {wid} in `workflow/work-orders/{f.name}`. Evidence in `workflow/evidence/`.'))
    extra = [  # (id, title, slice, release, role, status, body)
        ('X-R7', 'R7 Aggregation and vendor portal (to be specced)', 'R7', 0, 'Delivery agents', 'Todo', 'Aggregation run, k and rounding, suppression, vendor functions, dashboard, feeds, vendor agreement (workflow section 7, FR-70 to FR-95).'),
        ('X-CHECK0', 'Release 0 checkpoint: stakeholder demo walk-through', 'Demo', 0, 'Product owner', 'Todo', 'Run workflow/demo/DEMO-SCRIPT.md end to end with the team before showing stakeholders.'),
        ('X-WO82B', 'WO-0082 receipt parts: attach files, DELETE /api/receipts/[id], export with files', 'R6a', 1, 'Delivery agents', 'Todo', 'Moved from Release 0 on 2026-11-07. See workflow/work-orders/R6.md.'),
        ('X-R8', 'R8 Hardening and pilot open', 'R8', 1, 'Delivery agents', 'Todo', 'End-to-end and accessibility passes, restore rehearsal, load check, email delivery check, pilot open (workflow section 7).'),
        ('X-PEN', 'Penetration test of secret-key routes (/api/worker/signed-urls, /api/account/purge-storage, /api/receipts, /api/admin) (O5)', 'R8', 1, 'Solution architect', 'Todo', 'Two review passes could not run the live attack pass; needs a proper penetration test before hosted deployment.'),
        ('X-SEC', 'Dedicated security review of sensitive work orders (WO-0070 to WO-0083, 0086 to 0091)', 'R8', 1, 'Delivery agents', 'Todo', 'Deferred from Release 0 by the owner.'),
        ('X-OI5', 'Decision OI-5: may H&M-trained models be used in the pilot and published?', 'R4', 1, 'Product owner', 'Todo', 'Garment v2, pairing prior and unlock candidates stay OFF until decided (gate G7).'),
        ('X-G9', 'Style review G9: 50 suggestions from 5 wardrobes, about 80% acceptable', 'R3', 1, 'Style specialist', 'Todo', 'Human review required by the workflow; signs the weight file.'),
        ('X-LOI9', '100-photo team evaluation of the garment guess (LOI-9)', 'R5b', 1, 'Delivery agents', 'Todo', 'GARMENT_GUESS_ENABLED stays false until done.'),
        ('X-O1', 'Decide real catalogue sources and whether page collection is acceptable (O1, O2)', 'R6c', 1, 'Product owner', 'Todo', 'Data Sourcing Policy section 4 checklist per source.'),
        ('X-O3', 'Choose the exchange-rate provider and give fx_role a login (O3)', 'R6a', 1, 'Product owner', 'Todo', 'Conversion shows only where rates were inserted by hand until then.'),
        ('X-O4', 'Review OCR engine and model licences (PaddleOCR) against GPL-3.0 (O4)', 'R6d', 1, 'Solution architect', 'Todo', 'LLD LOI-3.'),
        ('X-O6', 'Create the first admin account and collect.yml secret (O6)', 'R6c', 1, 'Product owner', 'Todo', 'Agents never create accounts or enter secrets.'),
        ('X-PWD', 'Decide the password-change-with-stolen-session residual risk before hosting (MAJOR-1)', 'R2c', 1, 'Solution architect', 'Todo', 'secure_password_change is on; a stolen session can still change the password.'),
        ('X-DOCS', 'Review doc-sync updates to HLD/LLD (WebP vs JPEG, polling vs Realtime, Python 3.13, HMAC vs bearer token, GTIN length, export format)', 'R6a', 1, 'Solution architect', 'Todo', 'Collected in workflow/retros and the R6 spec "Document points".'),
    ]
    for wid, title, sl, rel, role, status, body in extra:
        out.append(dict(id=wid, title=title, slice=sl, release=RELEASES[rel], role=role, status=status, body=body))
    return out

def gh(*args, check=True):
    r = subprocess.run(['gh', *args], capture_output=True, text=True)
    if check and r.returncode: sys.exit(f'gh {" ".join(args[:3])} failed: {r.stderr.strip()[:300]}')
    return r.stdout.strip()

def main():
    its = items()
    csv_path = ROOT / 'workflow/github/work-items.csv'
    with csv_path.open('w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=['id', 'title', 'slice', 'release', 'role', 'status']); w.writeheader()
        for i in its: w.writerow({k: i[k] for k in w.fieldnames})
    done = sum(i['status'] == 'Done' for i in its)
    print(f'{len(its)} work items ({done} done); Release 0: {sum(i["release"] == RELEASES[0] for i in its)}, Release 1: {sum(i["release"] == RELEASES[1] for i in its)}. Wrote {csv_path.relative_to(ROOT)}')
    print(f'repo {REPO}, project owner {OWNER}. Members: ' + '; '.join(f'{n} = {r} (repo {p})' for n, _, r, p in MEMBERS))
    if not APPLY:
        print('DRY RUN: nothing created. Re-run with --apply after `gh auth login` and `gh auth refresh -s project`.'); return
    labels = {'release-0': '0E8A16', 'release-1': '1D76DB', 'owner-decision': 'D93F0B', 'done': 'BFD4F2'} | {f'slice:{s}': 'EDEDED' for s in sorted({i['slice'] for i in its})} | {f'role:{r.lower().replace(" ", "-")}': 'FBCA04' for r in ROLES}
    for name, color in labels.items(): gh('label', 'create', name, '--repo', REPO, '--color', color, '--force')
    existing = {m['title'] for m in json.loads(gh('api', f'repos/{REPO}/milestones?state=all&per_page=100') or '[]')}
    for t in RELEASES:
        if t not in existing: gh('api', f'repos/{REPO}/milestones', '-f', f'title={t}')
    have = {i['title']: i for i in json.loads(gh('issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '500', '--json', 'title,number,url') or '[]')}
    proj = json.loads(gh('project', 'create', '--owner', OWNER, '--title', 'Sparta', '--format', 'json'))
    num, pid = str(proj['number']), proj['id']
    for name, opts in (('Release', RELEASES), ('Slice', sorted({i['slice'] for i in its})), ('Role', ROLES)):
        gh('project', 'field-create', num, '--owner', OWNER, '--name', name, '--data-type', 'SINGLE_SELECT', '--single-select-options', ','.join(opts))
    fields = {f['name']: f for f in json.loads(gh('project', 'field-list', num, '--owner', OWNER, '--format', 'json'))['fields']}
    opt = lambda f, v: next(o['id'] for o in fields[f]['options'] if o['name'] == v)
    for i in its:
        if i['title'] in have: url = have[i['title']]['url']
        else:
            lab = ['release-0' if i['release'] == RELEASES[0] else 'release-1', f"slice:{i['slice']}", f"role:{i['role'].lower().replace(' ', '-')}"] + (['owner-decision'] if i['id'].startswith('X-O') or i['id'] in ('X-PWD', 'X-G9') else [])
            url = gh('issue', 'create', '--repo', REPO, '--title', i['title'], '--body', i['body'] + f"\n\nRelease: {i['release']}. Slice: {i['slice']}. Role: {i['role']}.", '--label', ','.join(lab), '--milestone', i['release'])
            if i['status'] == 'Done': gh('issue', 'close', url, '--reason', 'completed')
        item = json.loads(gh('project', 'item-add', num, '--owner', OWNER, '--url', url, '--format', 'json'))['id']
        for f, v in (('Release', i['release']), ('Slice', i['slice']), ('Role', i['role']), ('Status', i['status'])):
            gh('project', 'item-edit', '--id', item, '--project-id', pid, '--field-id', fields[f]['id'], '--single-select-option-id', opt(f, v))
    print(f'Created project #{num} for {OWNER} with {len(its)} items.')
    if INVITE:
        for name, env, role, perm in MEMBERS:
            user = os.environ.get(env)
            if not user: print(f'skipped {name}: set {env}'); continue
            if perm != 'admin': gh('api', '-X', 'PUT', f'repos/{REPO}/collaborators/{user}', '-f', f'permission={perm}')
            print(f'{name} ({user}): {role}, repo permission {perm}')

main()
