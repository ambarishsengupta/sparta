#!/usr/bin/env python3
"""Release-map gate (G1, G6).

Checks that every FR id in docs/FDD.md, every NFR id (NFR-1 to NFR-8) and every BR id
in docs/BRD.md (all priorities) appears in exactly one release's Traces cell in
docs/MVP-AGENT-WORKFLOW.md section 7, that no Traces cell names an id the documents do not
define, and that every FDD section 16 event is owned by exactly one release.

Usage:
  python3 workflow/gates/release_map.py
  python3 workflow/gates/release_map.py --selftest-drop FR-12

--selftest-drop ID removes ID from the in-memory release map and must then report it
missing (exit 1). Standard library only. Exit 0 only when there is no problem.
"""
import collections
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as fh:
        return fh.read()


def key(i):
    m = re.match(r'([A-Z]+)-(\d+)([a-z]?)$', i)
    return (m.group(1), int(m.group(2)), m.group(3))


def section(text, start, end):
    a = text.index(start)
    b = text.index(end, a + len(start)) if end else len(text)
    return text[a:b]


def parse_defined(fdd, brd):
    # FR definitions are the table rows before the acceptance section (which repeats the ids).
    defs = fdd[:fdd.index('## 17. Acceptance')]
    fr = sorted(set(re.findall(r'^\| (FR-\d+[a-z]?) \|', defs, re.M)), key=key)
    nfr = sorted(set(re.findall(r'^\| (NFR-\d+) \|', fdd, re.M)), key=key)
    br = sorted(set(re.findall(r'^\| (BR-\d+) \|', brd, re.M)), key=key)
    must = sorted(set(re.findall(r'^\| (BR-\d+) \|.*\| Must[^|]*\|\s*$', brd, re.M)), key=key)
    ev_sec = section(fdd, '## 16. Analytics', '## 17. Acceptance')
    ev_text = ev_sec.split('Examples:')[1].split('Sign-ups')[0]
    events = [e for e in re.findall(r'`([a-z_]+)`', ev_text) if e not in ('engine_config', 'unlock')]
    return fr, nfr, br, must, events


def parse_traces(wf):
    sec = section(wf, '## 7. Release plan', '\n## 8.')
    traces = {}
    for line in sec.split('\n'):
        if line.startswith('| **R'):
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            traces[re.match(r'\*\*(R\d+)', cells[0]).group(1)] = cells[2]
    return traces


def expand(cell, all_ids):
    cell = re.sub(r'FDD 16 events:.*', '', cell)  # event names are listed last
    out = []
    pat = r'((?:FR|NFR|BR)-\d+[a-z]?)(?: to ((?:FR|NFR|BR)-\d+[a-z]?))?'
    for a, b in re.findall(pat, cell):
        if not b:
            out.append(a)
            continue
        lst = [i for i in all_ids if i.startswith(a.split('-')[0] + '-')]
        if a not in lst or b not in lst:
            out.append(a)
            out.append(b)  # an endpoint that is not defined is reported as unknown
            continue
        out += lst[lst.index(a):lst.index(b) + 1]
    return out


def main(argv):
    drop = None
    if argv[:1] == ['--selftest-drop']:
        if len(argv) != 2:
            print('usage: release_map.py [--selftest-drop ID]', file=sys.stderr)
            return 2
        drop = argv[1]
    elif argv:
        print('usage: release_map.py [--selftest-drop ID]', file=sys.stderr)
        return 2

    fdd, brd, wf = read('docs/FDD.md'), read('docs/BRD.md'), read('docs/MVP-AGENT-WORKFLOW.md')
    fr, nfr, br, must, events = parse_defined(fdd, brd)
    all_ids = fr + nfr + br
    traces = parse_traces(wf)

    owner = collections.defaultdict(list)
    for rel, cell in traces.items():
        for i in expand(cell, all_ids):
            owner[i].append(rel)

    if drop is not None:
        if drop not in all_ids:
            print(f'selftest: {drop} is not a defined id', file=sys.stderr)
            return 2
        owner.pop(drop, None)  # remove from the in-memory map only

    problems = []
    for i in all_ids:
        n = len(owner.get(i, []))
        if n == 0:
            problems.append(f'MISSING {i}: in no release')
        elif n > 1:
            problems.append(f'DUPLICATE {i}: in releases {", ".join(owner[i])}')
    for i in sorted(owner, key=key):
        if i not in all_ids:
            problems.append(f'UNKNOWN {i}: traced by {", ".join(owner[i])} but defined in no document')

    ev_owner = collections.defaultdict(list)
    for rel, cell in traces.items():
        if 'FDD 16 events:' in cell:
            tail = cell.split('FDD 16 events:')[1].split(';')[0]
            for e in re.findall(r'`([^`]+)`', tail):
                ev_owner[e].append(rel)
    for e in events:
        if not ev_owner.get(e):
            problems.append(f'EVENT UNOWNED {e}')
    for e, rels in ev_owner.items():
        if len(rels) != 1:
            problems.append(f'EVENT DUPLICATE {e}: in releases {", ".join(rels)}')
        if e.split('[')[0] not in events:
            problems.append(f'EVENT UNKNOWN {e}: not an FDD 16 event')

    print(f'defined: {len(fr)} FR, {len(nfr)} NFR, {len(br)} BR ({len(must)} Must); '
          f'releases parsed: {", ".join(sorted(traces))}; FDD 16 events: {len(events)}')
    for p in problems:
        print(p)
    if problems:
        print(f'release_map: FAIL ({len(problems)} problem(s))')
        return 1
    print('release_map: PASS')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
