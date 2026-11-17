#!/usr/bin/env python3
"""Keep the Sparta GitHub project (board + issues) in step with the build. Idempotent and small; never creates a second project.
  python3 workflow/github/sync_github_project.py WO-0084=Done WO-0085="In Progress"      # set Status (Todo | In Progress | Done) by id
  python3 workflow/github/sync_github_project.py --add "WO-0098|title|R7|Release 0 (stakeholder demo)|Delivery agents|Todo"   # new item
  python3 workflow/github/sync_github_project.py --dry-run ...                              # print only
Ids are the work-order ids or the X-... ids in work-items.csv. Updates work-items.csv too. Env: SPARTA_REPO, SPARTA_PROJECT_OWNER."""
import csv, json, os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CSV = ROOT / 'workflow/github/work-items.csv'
REPO = os.environ.get('SPARTA_REPO', 'ambarishsengupta/sparta')
OWNER = os.environ.get('SPARTA_PROJECT_OWNER', REPO.split('/')[0])
DRY = '--dry-run' in sys.argv

def gh(*a):
    r = subprocess.run(['gh', *a], capture_output=True, text=True)
    if r.returncode: sys.exit(f'gh {" ".join(a[:3])} failed: {r.stderr.strip()[:300]}')
    return r.stdout.strip()

def main():
    args = [a for a in sys.argv[1:] if a != '--dry-run']
    rels = {}
    while '--release' in args:  # --release WO-0107=Release 1 (MVP): move an item to another release (board field, label, milestone and the CSV)
        i = args.index('--release'); k, v = args[i + 1].split('=', 1); rels[k] = v; del args[i:i + 2]
    rows = list(csv.DictReader(CSV.open()))
    adds = [args[i + 1] for i, a in enumerate(args) if a == '--add']
    sets = dict(a.split('=', 1) for a in args if '=' in a and not a.startswith('--') and a not in adds)
    for spec in adds:
        wid, title, sl, rel, role, status = spec.split('|')
        rows.append(dict(id=wid, title=f'{wid}: {title}' if wid.startswith('WO-') else title, slice=sl, release=rel, role=role, status=status))
        sets.setdefault(wid, status); print(f'add {wid}')
    byid = {r['id']: r for r in rows}
    if not DRY:
        proj = next(p for p in json.loads(gh('project', 'list', '--owner', OWNER, '--format', 'json'))['projects'] if p['title'] == 'Sparta')
        num, pid = str(proj['number']), proj['id']
        fields = {f['name']: f for f in json.loads(gh('project', 'field-list', num, '--owner', OWNER, '--format', 'json'))['fields']}
        def opt(f, v):  # the board option for a value; a sub-release slice with no option of its own (R7a) falls back to its slice (R7)
            names = {o['name']: o['id'] for o in fields[f]['options']}
            if v in names: return names[v]
            if f == 'Slice' and v[:-1] in names: return names[v[:-1]]
            sys.exit(f'no {f} option {v!r}')
        issues = {i['title']: i for i in json.loads(gh('issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '500', '--json', 'title,number,url,state'))}
        items = {i['content'].get('url'): i['id'] for i in json.loads(gh('project', 'item-list', num, '--owner', OWNER, '--limit', '500', '--format', 'json'))['items'] if i.get('content')}
    for wid, rel in rels.items():
        sets.setdefault(wid, byid[wid]['status']); byid[wid]['release'] = rel
    for wid, status in sets.items():
        row = byid.get(wid) or sys.exit(f'unknown id {wid}')
        row['status'] = status
        print(f'{wid} -> {status}')
        if DRY: continue
        iss = issues.get(row['title'])
        if iss is None:
            labs = ['release-0' if row['release'].startswith('Release 0') else 'release-1', f"slice:{row['slice']}", f"role:{row['role'].lower().replace(' ', '-')}"]
            url = gh('issue', 'create', '--repo', REPO, '--title', row['title'], '--body', f"Work item {wid}. Release: {row['release']}. Slice: {row['slice']}. Role: {row['role']}.", '--label', ','.join(labs), '--milestone', row['release'])
        else: url = iss['url']
        if url not in items:
            items[url] = json.loads(gh('project', 'item-add', num, '--owner', OWNER, '--url', url, '--format', 'json'))['id']
            for f, v in (('Release', row['release']), ('Slice', row['slice']), ('Role', row['role'])):
                try: gh('project', 'item-edit', '--id', items[url], '--project-id', pid, '--field-id', fields[f]['id'], '--single-select-option-id', opt(f, v))
                except SystemExit: print(f'  note: {f} option {v!r} is not on the board yet; set it by hand')
        if wid in rels:
            gh('project', 'item-edit', '--id', items[url], '--project-id', pid, '--field-id', fields['Release']['id'], '--single-select-option-id', opt('Release', rels[wid]))
            old, new = ('release-0', 'release-1') if rels[wid].startswith('Release 1') else ('release-1', 'release-0')
            gh('issue', 'edit', url, '--add-label', new, '--remove-label', old, '--milestone', rels[wid])
        gh('project', 'item-edit', '--id', items[url], '--project-id', pid, '--field-id', fields['Status']['id'], '--single-select-option-id', opt('Status', status))
        if status == 'Done' and (iss is None or iss['state'] != 'CLOSED'): gh('issue', 'close', url, '--reason', 'completed')
        if status != 'Done' and iss is not None and iss['state'] == 'CLOSED': gh('issue', 'reopen', url)
    with CSV.open('w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=['id', 'title', 'slice', 'release', 'role', 'status']); w.writeheader(); w.writerows(rows)

main()
