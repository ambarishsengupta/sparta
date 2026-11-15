// WO-0097 (Release 0): demo-data.sh and workflow/demo/start-demo.sh refuse non-local targets, hold no secret, and (live, opt-in) demo-data.sh is idempotent.
// The pure tests refuse every URL BEFORE any connection is tried. Like the seed tests it is meant to be collected through workflow/gates/db_tests.test.ts (it needs
// `import '../../supabase/scripts/demo-data.test';` there: that file is outside WO-0097's scope). The live test writes 3 accounts and the 150-user panel to the local
// database and removes them again; it runs only with SEED_LIVE=1 and a running local stack, and prints a SKIPPED line otherwise.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
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
    for (const mode of [[], ['--counts'], ['--remove'], ['--hm'], ['--hm', '--counts'], ['--remove', '--hm']]) {   // WO-0122: --hm is refused as early as the rest
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

  it('holds only invented data of its own: example.test addresses, invented brands, the SYNTHETIC label; H&M appears only for the --hm catalogue items and stores, with no article id, customer or transaction', () => {
    expect(text).toMatch(/SYNTHETIC/);
    expect(text).not.toMatch(new RegExp(['Henn' + 'es', 'hm\\.' + 'com', 'Zar' + 'a', 'Uni' + 'qlo'].join('|'), 'i'));   // WO-0122: H&M itself is the vendor, so only that name may appear
    expect(text).not.toMatch(/\b0[1-9][0-9]{8}\b|transactions|customers/i);
    const code = text.split('\n').filter((l) => !/^\s*(#|--)/.test(l)).map((l) => l.replace(/\s#\s.*$/, '')).join('\n');
    expect(code.replace(/'H&M( Online)?'/g, '')).not.toMatch(/H\s*&\s*M/);   // in code only the exact strings 'H&M' and 'H&M Online' (comments are free text)
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

describe('demo-data.sh --hm (WO-0122)', () => {
  it('loads the existing loader into the local database only after both seeds, from the catalogue source it made, and removes that source with the consumers', () => {
    expect(text).toContain('workflow/demo/hm/load_hm_demo_catalog.py --db-url "$url"');
    expect(text.indexOf('bash supabase/scripts/seed-demo-insights.sh "$url"')).toBeLessThan(text.indexOf('"$py" -B workflow/demo/hm/load_hm_demo_catalog.py'));
    expect(text).toContain("delete from catalog.sources where name = 'hm-demo' and site_url = 'http://127.0.0.1/'");   // in every --remove, with or without --hm
    expect(text.indexOf('delete from auth.users where email in')).toBeLessThan(text.indexOf("delete from catalog.sources where name = 'hm-demo'"));   // items first, then the source
  });
  it('makes catalogue-origin items from the H&M articles with the same sizes, conditions and ids as the synthetic ones, and adds purchases of them', () => {
    expect(text).toContain("where s.name = 'hm-demo' and ci.status = 'active' and ci.category = g.category");
    expect(text).toContain("case when g.cid is not null then 'catalogue' else 'manual' end");
    expect(text).toContain('md5(\'demo-data:\' || g.email || \':\' || g.i)::uuid');   // the same fixed ids: a re-run adds nothing
    expect(text).toContain("(array['S', 'M', 'M', 'L', 'L', 'XL'])[g.i % 6 + 1]");
    expect(text).toContain('(g.i * 37 + g.k * 11) % 85');
    expect(text).toContain("(array['H&M', 'H&M Online'])");
    expect(text).toContain('left join lateral');
    expect(text).toMatch(/hm_catalogue=.*hm_items=/s);
  });
  it('refuses a seed of the other kind before changing anything: exit 3, a message naming --remove, nothing deleted', () => {
    expect(text).toContain('still hold the PLAIN demo wardrobe');
    expect(text).toContain('still hold the --hm wardrobe');
    expect((text.match(/Nothing was changed\. Run: bash supabase\/scripts\/demo-data\.sh --remove/g) ?? []).length).toBe(2);
    expect((text.match(/>&2; exit 3/g) ?? []).length).toBe(2);
    const seeded = "md5('demo-data:' || e || ':' || n)::uuid";   // the check's id expression; the seeding insert uses the same one with g.email and g.i
    expect(text).toContain(seeded);
    expect(text).toContain("md5('demo-data:' || g.email || ':' || g.i)::uuid");
    const check = text.slice(text.indexOf('a seed of the other kind'), text.indexOf('read -r plain_items'));
    expect(check).toContain("s.name = 'hm-demo'");
    expect(check).toContain('left join catalog.sources s');
    expect(check).not.toMatch(/origin/);   // the kind is the article's source, never the item's origin
    expect(text.indexOf('exit 3')).toBeLessThan(text.indexOf('bash supabase/scripts/seed-demo-catalog.sh "$url"'));   // before any seed runs
    expect(text.slice(text.indexOf('a seed of the other kind'), text.indexOf('seed-demo-catalog.sh "$url"'))).not.toMatch(/\bdelete\b/i);
  });
  it('without --hm the wardrobe query takes no article (the lateral join is off with :hm = 1 false)', () => {
    expect(text).toContain('on :hm = 1)');
    expect(text).toContain('\\set hm $hm');
    expect(text).not.toMatch(/hm=\$\{?[A-Za-z]|"\$hm"[^\n]*(psql|run_psql)/);   // the flag reaches psql only as a number set by the script itself
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
  it('--hm sets the photograph folder for the server process only (never the build), writes the article list only to the git-ignored folder, and checks that first (WO-0122)', () => {
    expect(start).toMatch(/hmenv=\("HM_DEMO_IMAGE_ROOT=\$root"\)/);
    expect(start).toMatch(/next start/);
    expect(start.indexOf('hmenv=(')).toBeGreaterThan(start.indexOf('envs=(NEXT_PUBLIC_DATA_BACKEND=local)'));
    expect(start).toMatch(/exec env "\$\{envs\[@\]\}" \$\{hmenv\[@\]\+"\$\{hmenv\[@\]\}"\} timeout 7200/);   // the server command has it
    expect(start).not.toMatch(/envs\+=\([^)]*HM_DEMO_IMAGE_ROOT|npm run build[^\n]*hmenv/);   // the build command does not
    expect(start.match(/HM_DEMO_IMAGE_ROOT/g)?.length).toBe(2);   // the comment and the one assignment
    expect(start.indexOf('git check-ignore -q workflow/demo/hm/out/hm-demo.json')).toBeLessThan(start.indexOf('load_hm_demo_catalog.py --json 200'));
    expect(start).toContain('NEXT_PUBLIC_HM_DEMO_ARTICLES=$(cat workflow/demo/hm/out/hm-demo.json)');
    expect(start).not.toMatch(/hm-demo\.json[^\n]*(cp |mv |git add)|git add/);
    expect(spawnSync('git', ['check-ignore', '-q', 'workflow/demo/hm/out/hm-demo.json']).status).toBe(0);
    expect(spawnSync('git', ['ls-files', 'workflow/demo/hm/out']).stdout.toString()).toBe('');
  });
  it('--hm without a H&M folder stops before building, and both options are accepted in any order', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'startdemo-'));
    const env = { ...process.env, TMPDIR: tmp, SPARTA_DATA_ROOT_HM: join(tmp, 'nothing') };
    for (const args of [['--hm', '--no-login'], ['--no-login', '--hm']]) {
      const r = spawnSync('bash', [START, ...args], { encoding: 'utf8', env, timeout: 20_000 });
      expect([r.status, r.stderr.includes('--hm needs SPARTA_DATA_ROOT_HM'), r.stdout.includes('building')]).toEqual([1, true, false]);
    }
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
    // WO-0122: the H&M section
    for (const s of ['demo-data.sh --hm', 'start-demo.sh --hm', 'start-demo.sh --no-login --hm', 'fresh private window', 'max-age=3600', 'HM_DEMO_IMAGE_ROOT', 'served locally for this demo only', 'invented consumers',
      'your own anonymised, rounded view of what the pilot\'s wardrobes contain and what people want', 'ownership by category, colour, size and brand']) expect(guide).toContain(s);
    expect(guide).not.toMatch(/third[- ]party|onboard(ing)? (other )?vendors|product feed|feed upload/i);
    expect(guide).not.toMatch(/\b0[1-9][0-9]{8}\b/);
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
      expect(before).toMatch(/^consumers=3 items=72 purchases=\d+ wishlist=4 consent=3 invitations=3 vendor_users=1 catalogue=40 hm_catalogue=0 hm_items=0\npanel=150 /);
      expect(second.stdout + second.stderr).not.toContain(pw[0][2]);   // the first run's password is not repeated anywhere
    } finally {
      expect(run('--remove').status).toBe(0);
    }
    expect(run('--counts').stdout.trim()).toMatch(/^consumers=0 items=0 purchases=0 wishlist=0 consent=0 invitations=0 vendor_users=0 catalogue=0 hm_catalogue=0 hm_items=0\npanel=0 /);
  }, 600_000);
});

// WO-0122: the same with --hm, which needs the local H&M folder (SPARTA_DATA_ROOT_HM in the environment or workflow/local.env); the rows are removed again.
const hmRoot = process.env.SPARTA_DATA_ROOT_HM ?? /^SPARTA_DATA_ROOT_HM=(.+)$/m.exec(existsSync('workflow/local.env') ? readFileSync('workflow/local.env', 'utf8') : '')?.[1];
const hmLive = live && hmRoot !== undefined && existsSync(join(hmRoot, 'articles.csv'));
if (live && !hmLive) console.warn('SKIPPED: the live check of demo-data.sh --hm needs the local H&M folder (SPARTA_DATA_ROOT_HM).');

describe.skipIf(!hmLive)('demo-data.sh --hm against the local stack', () => {
  it('two runs leave identical counts (72 items all made from catalogue articles, 1,500 articles, H&M the leading brand), and --remove clears everything', () => {
    const counts = () => run('--hm', '--counts').stdout.trim().replace(/ cube_rows=\d+/, '');
    expect(run('--hm').status).toBe(0);
    const before = counts();
    try {
      expect(run('--hm').status).toBe(0);
      expect(counts()).toBe(before);
      expect(before).toMatch(/^consumers=3 items=72 purchases=(\d+) wishlist=4 consent=3 invitations=3 vendor_users=1 catalogue=40 hm_catalogue=1500 hm_items=72\npanel=150 /);
      const q = (sql: string) => spawnSync('docker', ['exec', '-i', `supabase_db_${project}`, 'psql', '-U', 'postgres', '-Atc', sql], { encoding: 'utf8' }).stdout.trim();
      expect(q("select count(*) from app.items i join auth.users u on u.id = i.user_id where u.email like 'demo-%' and (i.origin <> 'catalogue' or i.brand <> 'H&M' or i.catalog_item_id is null)")).toBe('0');
      expect(q("select name from catalog.vendors")).toBe('H&M');
      expect(q("select brand from app.items where user_id in (select id from auth.users where email like 'panel-%') group by brand order by count(*) desc limit 1")).toBe('H&M');
    } finally {
      expect(run('--remove').status).toBe(0);
    }
    expect(run('--counts').stdout.trim()).toMatch(/hm_catalogue=0 hm_items=0\npanel=0 /);
  }, 900_000);
  it('items a presenter adds by hand, of any origin, do not change the verdict', () => {
    const q = (sql: string) => spawnSync('docker', ['exec', '-i', `supabase_db_${project}`, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql], { encoding: 'utf8' });
    const add = (extra: string) => q(`insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin${extra ? ', catalog_item_id' : ''})
      select u.id, 'Presenter item', 'Tops', 'T-shirt', 1, 2, 3, '${extra ? 'catalogue' : 'manual'}'${extra ? `, (select ci.id from catalog.catalog_items ci join catalog.sources s on s.id = ci.source_id where s.name = 'demo' limit 1)` : ''} from auth.users u where u.email = 'demo-rich@example.test'`);
    try {
      expect(run().status).toBe(0);
      expect(add('catalogue').status).toBe(0);   // DEMO-SCRIPT step 9: a synthetic catalogue item, origin catalogue
      expect(run().status).toBe(0);
      const hm = run('--hm');
      expect([hm.status, hm.stderr.includes('PLAIN demo wardrobe'), hm.stderr.includes('(72 seeded')]).toEqual([3, true, true]);
      expect(run('--remove').status).toBe(0);
      expect(run('--counts').stdout).toMatch(/consumers=0 items=0 /);   // the extra item went with its account
      expect(run('--hm').status).toBe(0);
      expect(add('').status).toBe(0);
      expect(run('--hm').status).toBe(0);
      const plain = run();
      expect([plain.status, plain.stderr.includes('still hold the --hm wardrobe'), plain.stderr.includes('(72 seeded')]).toEqual([3, true, true]);
    } finally {
      expect(run('--remove').status).toBe(0);
    }
  }, 900_000);
  it('a plain seed followed by --hm (and the reverse) exits 3 with the message and changes nothing', () => {
    try {
      expect(run().status).toBe(0);
      const before = run('--counts').stdout.trim().replace(/ cube_rows=\d+/, '');
      const hm = run('--hm');
      expect([hm.status, hm.stderr.includes('PLAIN demo wardrobe'), hm.stderr.includes('demo-data.sh --remove'), hm.stdout.includes('Demo accounts are ready')]).toEqual([3, true, true, false]);
      expect(run('--counts').stdout.trim().replace(/ cube_rows=\d+/, '')).toBe(before);
      expect(run('--remove').status).toBe(0);
      expect(run('--hm').status).toBe(0);
      const plain = run();
      expect([plain.status, plain.stderr.includes('still hold the --hm wardrobe')]).toEqual([3, true]);
    } finally {
      expect(run('--remove').status).toBe(0);
    }
  }, 900_000);
});
