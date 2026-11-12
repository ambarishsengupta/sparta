// WO-0097 (Release 0): demo-data.sh and workflow/demo/start-demo.sh refuse non-local targets, hold no secret, and (live, opt-in) demo-data.sh is idempotent.
// The pure tests refuse every URL BEFORE any connection is tried. Like the seed tests it is meant to be collected through workflow/gates/db_tests.test.ts (it needs
// `import '../../supabase/scripts/demo-data.test';` there: that file is outside WO-0097's scope). The live test writes 3 accounts and the 150-user panel to the local
// database and removes them again; it runs only with SEED_LIVE=1 and a running local stack, and prints a SKIPPED line otherwise.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = process.env.SEED_SCRIPT ?? 'supabase/scripts/demo-data.sh';   // the override is for the mutation proof only
const START = 'workflow/demo/start-demo.sh';
const text = readFileSync(SCRIPT, 'utf8');
const start = readFileSync(START, 'utf8');
const guide = readFileSync('workflow/demo/DEMO-SCRIPT.md', 'utf8');
const run = (...args: string[]) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 300_000 });
const BAD = ['postgresql://postgres:x@db.example.test:5432/postgres', 'postgresql://postgres:x@127.0.0.1:54322/postgres?host=db.example.test', 'postgresql://postgres@evil.test@127.0.0.1/postgres',
  'postgresql://postgres:x@127.0.0.1.evil.test:5432/postgres', 'postgresql://postgres:x@10.0.0.5/postgres', 'postgresql://postgres:x@localhost.evil.test/postgres', 'https://127.0.0.1/postgres'];

describe('supabase/scripts/demo-data.sh', () => {
  it.each(BAD)('refuses %s in every mode (exit 2, before any connection)', (url) => {
    for (const mode of [[], ['--counts'], ['--remove']]) {
      const r = run(...mode, url);
      expect([r.status, r.stderr.includes('refusing to run')]).toEqual([2, true]);
    }
  });

  it('refuses a non-local auth API too, and calls both existing seeds instead of re-implementing them', () => {
    expect(text).toMatch(/\^https\?:\/\/\(127\\\.0\\\.0\\\.1\|localhost\|\\\[::1\\\]\)/);
    expect(text).toContain('seed-demo-catalog.sh');
    expect(text).toContain('seed-demo-insights.sh');
    expect((text.match(/seed-demo-insights\.sh --(counts|remove)/g) ?? []).length).toBe(2);
  });

  it('holds no secret: passwords come from openssl at run time, reach curl on stdin only, are printed once, and are never written to a file', () => {
    expect(text).toContain('openssl rand');
    expect(text).toContain('curl -K -');
    expect(text).not.toMatch(/sb_secret|sb_publishable|eyJ[A-Za-z0-9]{20}|password\s*=\s*["'][A-Za-z0-9]{6}/i);
    expect(text).not.toMatch(/>>?\s*["']?[^\s"']*(credential|\.txt|\.env)|\bcurl\b[^\n]*(-d|--data|-H|--header)\s/);   // no redirect into a credentials file, no secret on curl's command line
    expect(text).not.toMatch(/echo[^\n]*\$sk|printf[^\n]*\$sk[^\n]*\bpsql\b/);
    expect((text.match(/for c in "\$\{creds\[@\]\}"/g) ?? []).length).toBe(1);   // the only place a password is printed
  });

  it('holds only invented data: example.test addresses, invented brands, the SYNTHETIC label, no H&M reference', () => {
    expect(text).toMatch(/SYNTHETIC/);
    expect(text).not.toMatch(new RegExp(['H\\s*&\\s*M', 'Henn' + 'es', 'hm\\.' + 'com'].join('|'), 'i'));
    for (const e of ['demo-rich@example.test', 'demo-thin@example.test', 'demo-new@example.test', 'vendor-demo@example.test']) expect(text).toContain(e);
    const emails = [...text.matchAll(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/g)].map((m) => m[0]).filter((e) => !e.includes('//'));
    expect(emails.filter((e) => !e.endsWith('@example.test') && !e.endsWith('@(127.0.0.1')).length).toBeLessThanOrEqual(2);   // postgres@... in the usage comment and URL forms only
  });

  it('is idempotent by construction (fixed ids, conflict handling), updates the existing vendor profile and removes what it made', () => {
    expect((text.match(/on conflict \(id\) do nothing/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(text).toContain("md5('demo-data:' || g.email || ':' || g.i)::uuid");
    expect(text).toMatch(/admin PUT "\/auth\/v1\/admin\/users\/\$id"/);   // the vendor profile is updated, never created a second time
    expect(text).toContain("update auth.users set encrypted_password = null where email = 'vendor-demo@example.test'");
    expect(readFileSync('supabase/config.toml', 'utf8')).not.toContain('demo-data');
  });
});

describe('workflow/demo/start-demo.sh', () => {
  it('has a hard timeout of 2 hours, reads the keys from the status command into the environment, has no log-text greps and no pattern kills', () => {
    expect(start).toContain('timeout 7200');
    expect(start).toContain('supabase status -o env');
    expect(start).toMatch(/envs=\(NEXT_PUBLIC_DATA_BACKEND=local\)/);
    expect(start).not.toMatch(/grep[^\n]*\$logf|pgrep|pkill|killall|echo[^\n]*\$(sk|pk)\b|>\s*["']?[^\s"']*\.env/);
    expect(start).toMatch(/curl -s -o \/dev\/null --max-time 3/);   // readiness is the exit status of a request
  });
  it('refuses an unknown option without building, and --stop with nothing running is a no-op', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'startdemo-'));
    const env = { ...process.env, TMPDIR: tmp };
    const bad = spawnSync('bash', [START, '--bogus'], { encoding: 'utf8', env, timeout: 20_000 });
    expect([bad.status, bad.stderr.includes('usage')]).toEqual([1, true]);
    const stop = spawnSync('bash', [START, '--stop'], { encoding: 'utf8', env, timeout: 20_000 });
    expect([stop.status, stop.stdout.includes('nothing to stop')]).toEqual([0, true]);
  });
});

describe('workflow/demo/DEMO-SCRIPT.md', () => {
  it('names both modes, the exact start order, the reset command and every known limit', () => {
    for (const s of ['start-demo.sh --no-login', 'start-demo.sh --stop', 'demo-data.sh --remove', 'supabase start', 'bash supabase/scripts/demo-data.sh', 'Known limits', '0.8953',
      'receipts', 'penetration test', 'synthetic', 'worker', 'Leave the pilot', 'Export my data', 'Start from popular items']) expect(guide.toLowerCase()).toContain(s.toLowerCase());
    expect(guide).not.toMatch(/sb_secret|eyJ[A-Za-z0-9]{20}/);
  });
});

const project = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync('supabase/config.toml', 'utf8'))?.[1] ?? 'sparta';
const live = process.env.SEED_LIVE === '1' && spawnSync('docker', ['exec', `supabase_db_${project}`, 'psql', '-U', 'postgres', '-Atc', 'select 1'], { encoding: 'utf8' }).status === 0;
if (!live) console.warn('SKIPPED: the live idempotence check of demo-data.sh needs SEED_LIVE=1 and the local Supabase stack.');

describe.skipIf(!live)('demo-data.sh against the local stack', () => {
  it('two runs leave identical row counts (3 consumers, 72 items, consent, one vendor profile, 40 catalogue items), passwords are printed once, and --remove clears all', () => {
    // cube_rows is left out of the comparison: the first run aggregates before the three accounts exist, later runs include them (the panel counts stay the same)
    const counts = () => run('--counts').stdout.trim().replace(/ cube_rows=\d+/, '');
    const first = run();
    expect(first.status).toBe(0);
    const pw = [...first.stdout.matchAll(/^ {2}(\S+@example\.test) {2}([A-Za-z0-9]{16,})$/gm)];
    expect(pw.map((m) => m[1])).toEqual(['demo-rich@example.test', 'demo-thin@example.test', 'demo-new@example.test', 'vendor-demo@example.test']);
    const before = counts();
    const second = run();
    try {
      expect(second.status).toBe(0);
      expect(counts()).toBe(before);
      expect(before).toMatch(/^consumers=3 items=72 purchases=\d+ wishlist=4 consent=3 invitations=3 vendor_users=1 catalogue=40\npanel=150 /);
      expect(second.stdout + second.stderr).not.toContain(pw[0][2]);   // the first run's password is not repeated anywhere
    } finally {
      expect(run('--remove').status).toBe(0);
    }
    expect(run('--counts').stdout.trim()).toMatch(/^consumers=0 items=0 purchases=0 wishlist=0 consent=0 invitations=0 vendor_users=0 catalogue=0\npanel=0 /);
  }, 600_000);
});
