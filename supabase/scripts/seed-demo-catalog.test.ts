// WO-0083 (R6b): the demo catalogue script refuses non-local databases, holds only synthetic data, and no migration holds a password (CC5, CC13).
// Pure test: every URL below is refused BEFORE any connection is tried, so nothing is contacted and no database is needed. It is collected
// through workflow/gates/db_tests.test.ts like seed.test.ts (vitest.config.ts only includes workflow/gates/**, packages/*/src/** and apps/web/**).
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SCRIPT = process.env.SEED_SCRIPT ?? 'supabase/scripts/seed-demo-catalog.sh';   // the override is for the mutation proof only
const text = readFileSync(SCRIPT, 'utf8');
const run = (url: string) => spawnSync('bash', [SCRIPT, url], { encoding: 'utf8', timeout: 20_000 });

describe('supabase/scripts/seed-demo-catalog.sh', () => {
  it.each([
    'postgresql://postgres:x@db.example.test:5432/postgres',
    'postgresql://postgres:x@127.0.0.1:54322/postgres?host=db.example.test',
    'postgresql://postgres@evil.test@127.0.0.1/postgres',
    'postgresql://postgres:x@127.0.0.1.evil.test:5432/postgres',
    'postgresql://postgres:x@10.0.0.5/postgres',
    'postgresql://postgres:x@localhost.evil.test/postgres',
    'https://127.0.0.1/postgres',
  ])('refuses %s (exit 2, before any connection)', (url) => {
    const r = run(url);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('refusing to run');
  });

  it('seeds one source that is never allowed, at http://127.0.0.1/, flagged as the demo source and as synthetic', () => {
    expect(text).toContain("'demo', 'http://127.0.0.1/', false");
    expect(text).toMatch(/SYNTHETIC DEMO DATA/);
    expect(text).toMatch(/allowed.{0,20}false/);
  });

  it('holds no real brand data, no H&M reference and no password or key', () => {
    expect(text).not.toMatch(new RegExp(['H\\s*&\\s*M', 'Henn' + 'es', 'hm\\.' + 'com'].join('|'), 'i'));   // pieces, so this file does not hold the strings it forbids
    expect(text).not.toMatch(/password\s*=\s*['"]?[A-Za-z0-9]|sb_secret|service_role/i);
    for (const brand of ['Zorvane', 'Quillibrook', 'Pemberlow', 'Wexmarrow', 'Ostrelle', 'Brindlewick', 'Fenwrath', 'Tallowmere']) expect(text).toContain(`'${brand}'`);
  });

  it('is idempotent by construction (upsert on the unique key) and never part of config.toml seeding', () => {
    expect(text).toContain('on conflict (source_id, vendor_id, sku) do update');
    expect(readFileSync('supabase/config.toml', 'utf8')).not.toContain('seed-demo-catalog');
  });

  it('no migration sets a password for a role, and the collector password script is git-ignored', () => {
    for (const f of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql'))) {
      expect(readFileSync(`supabase/migrations/${f}`, 'utf8'), f).not.toMatch(/\bpassword\s+'/i);
    }
    expect(readFileSync('.gitignore', 'utf8')).toContain('supabase/scripts/set-collector-password.sh');
  });
});
