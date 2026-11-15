// WO-0102 (R7a): the demo insights script refuses non-local databases, holds only synthetic data, and (live, opt-in) is idempotent (CC6, CC14).
// The pure tests refuse every URL BEFORE any connection is tried, so nothing is contacted. Like seed-demo-catalog.test.ts it is meant to be collected through
// workflow/gates/db_tests.test.ts (vitest.config.ts only includes workflow/gates/**, packages/*/src/** and apps/web/**). The live test writes 150 demo users into the
// local database, so it runs only with SEED_LIVE=1 and a running local stack, and removes them again; it prints a SKIPPED line otherwise.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SCRIPT = process.env.SEED_SCRIPT ?? 'supabase/scripts/seed-demo-insights.sh';   // the override is for the mutation proof only
const text = readFileSync(SCRIPT, 'utf8');
const run = (...args: string[]) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 120_000 });
const BAD = ['postgresql://postgres:x@db.example.test:5432/postgres', 'postgresql://postgres:x@127.0.0.1:54322/postgres?host=db.example.test', 'postgresql://postgres@evil.test@127.0.0.1/postgres',
  'postgresql://postgres:x@127.0.0.1.evil.test:5432/postgres', 'postgresql://postgres:x@10.0.0.5/postgres', 'postgresql://postgres:x@localhost.evil.test/postgres', 'https://127.0.0.1/postgres'];

describe('supabase/scripts/seed-demo-insights.sh', () => {
  it.each(BAD)('refuses %s in every mode (exit 2, before any connection)', (url) => {
    for (const mode of [[], ['--counts'], ['--remove']]) {
      const r = run(...mode, url);
      expect([r.status, r.stderr.includes('refusing to run')]).toEqual([2, true]);
    }
  });

  it('holds only invented consumer data: example.test addresses, five invented brands and H&M as the one vendor and leading brand, the SYNTHETIC label, no other retailer, no H&M row, no password or key', () => {
    expect(text).toMatch(/SYNTHETIC/);
    expect(text).not.toMatch(new RegExp(['Henn' + 'es', 'hm\\.' + 'com', 'Zar' + 'a', 'Uni' + 'qlo', 'Northwind'].join('|'), 'i'));   // pieces, so this file does not hold the strings it forbids; H&M itself is the vendor (WO-0122)
    expect([...text.matchAll(/H\s*&\s*M/g)].length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\b0[1-9][0-9]{8}\b|catalog_items|transactions|customers/i);   // no H&M article id, catalogue, transaction or customer row is read
    expect(text).not.toMatch(/password\s*[=:]\s*['"]?[A-Za-z0-9]|sb_secret|crypt\(|encrypted_password\s*=/i);
    const emails = [...text.matchAll(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/g)].map((m) => m[0]).filter((e) => !e.includes('//'));   // the URL pattern in the refusal check has user@host
    expect(emails.filter((e) => !e.endsWith('@example.test') && !e.endsWith('@(127.0.0.1')).length).toBeLessThanOrEqual(2);   // postgres@... in the usage comment and URL forms only
    for (const e of ['panel-', 'vendor-demo@example.test', 'demo-admin@example.test']) expect(text).toContain(e);
    for (const brand of ['Zor Vane', 'Marlow Thistle', 'Pellam Ridge', 'Corvin Hale', 'Brindle Quay']) expect(text).toContain(`'${brand}'`);
    expect(text).toContain("'H&M'");
    expect(text).not.toContain('Aster Loom');
    expect(text).toContain("values ('demo-h-and-m', 'H&M', 1), ('demo-zor-vane'");   // H&M is sort 1, the brand the item rule gives the largest share (4 in 10)
    expect((text.match(/name = 'H&M'/g) ?? []).length).toBe(4);   // the vendor row is found by that name in --counts (3) and --remove (1); the insert names it once more
  });

  it('is idempotent by construction (fixed ids, conflict handling), runs a real aggregation, reviews with a direct update, and is never part of config.toml seeding', () => {
    expect((text.match(/on conflict/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(text).toContain('analytics.run_aggregation()');
    expect(text).toContain('analytics.build_report(current_date)');
    expect(text).toMatch(/update ops\.reports set reviewed_by = v_admin, reviewed_at = now\(\)/);
    expect(text).toContain("select value from ops.settings where key = 'current_vendor_agreement_version'");
    expect(readFileSync('supabase/config.toml', 'utf8')).not.toContain('seed-demo-insights');
  });
});

const project = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync('supabase/config.toml', 'utf8'))?.[1] ?? 'sparta';
const live = process.env.SEED_LIVE === '1' && spawnSync('docker', ['exec', `supabase_db_${project}`, 'psql', '-U', 'postgres', '-Atc', 'select 1'], { encoding: 'utf8' }).status === 0;
if (!live) console.warn('SKIPPED: the live idempotence check of seed-demo-insights.sh needs SEED_LIVE=1 and the local Supabase stack.');

describe.skipIf(!live)('seed-demo-insights.sh against the local stack', () => {
  it('two runs leave identical row counts (150 panel users, one vendor, one member, one acceptance, one reviewed report), and --remove clears them', () => {
    expect(run().status).toBe(0);
    const first = run('--counts').stdout.trim();
    expect(run().status).toBe(0);
    const second = run('--counts').stdout.trim();
    try {
      expect(second).toBe(first);
      expect(first).toMatch(/^panel=150 items=\d+ wishlist=\d+ purchases=\d+ brands=6 vendors=1 members=1 acceptances=1 admins=1 reports=1 cube_rows=[1-9]\d*$/);
    } finally {
      expect(run('--remove').status).toBe(0);
    }
    expect(run('--counts').stdout.trim()).toMatch(/^panel=0 items=0 wishlist=0 purchases=0 brands=0 vendors=0 members=0 acceptances=0 admins=0 reports=0 /);
  }, 300_000);
});
