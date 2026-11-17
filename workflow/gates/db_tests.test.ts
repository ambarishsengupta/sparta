// WO-0040 / CC4: (1) db_tests.sh behaves (stubbed supabase CLI), (2) the generated-seed test, (3) the live-database checks:
// SQL colour_family equals the TypeScript one on a grid, and the seeded lookups equal the taxonomy JSON. Part (3) is skipped,
// with a message, when the local Supabase stack is not running. It talks to the local database container only.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { colourFamily } from '@sparta/taxonomy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lockStack } from '../../apps/web/test-support/stack';
import taxonomy from '../../packages/taxonomy/src/taxonomy.json';
import '../../supabase/scripts/seed.test';
import '../../supabase/scripts/seed-demo-catalog.test';
import '../../supabase/scripts/seed-demo-insights.test';
import '../../supabase/scripts/demo-data.test';

// ---- db_tests.sh with a stub `supabase` that logs its calls ----
function runScript(codes: { status?: number; reset?: number; test?: number }) {
  const dir = mkdtempSync(join(tmpdir(), 'dbtests-'));
  const log = join(dir, 'calls.log');
  const exits: Record<string, number> = { status: codes.status ?? 0, db: codes.reset ?? 0, test: codes.test ?? 0 };
  writeFileSync(join(dir, 'supabase'), `#!/bin/sh\necho "$*" >> "${log}"\ncase "$1" in\n${Object.entries(exits).map(([k, v]) => `${k}) exit ${v};;`).join('\n')}\nesac\n`);
  chmodSync(join(dir, 'supabase'), 0o755);
  const r = spawnSync('bash', ['workflow/gates/db_tests.sh'], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
  let calls: string[] = [];
  try { calls = readFileSync(log, 'utf8').trim().split('\n'); } catch { /* the stub was never called */ }
  return { code: r.status, out: r.stdout + r.stderr, calls };
}

describe('workflow/gates/db_tests.sh', () => {
  it('prints SKIPPED, exits 0 and touches nothing when the stack is not running', () => {
    const r = runScript({ status: 1 });
    expect([r.code, r.out.includes('SKIPPED'), r.calls]).toEqual([0, true, ['status']]);
  });
  it('resets the local database, then runs the pgTAP suite, when the stack is running', () => {
    const r = runScript({});
    expect([r.code, r.out.includes('SKIPPED'), r.calls]).toEqual([0, false, ['status', 'db reset', 'test db']]);
  });
  it('fails with the reset status and does not run the tests when the reset fails', () => {
    const r = runScript({ reset: 7 });
    expect([r.code, r.calls]).toEqual([7, ['status', 'db reset']]);
  });
  it('fails with the status of the pgTAP run when a test fails', () => {
    expect(runScript({ test: 3 }).code).toBe(3);
  });
});

// ---- live database ----
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync('supabase/config.toml', 'utf8'))?.[1] ?? 'sparta';
const container = `supabase_db_${projectId}`;

/** Run SQL (or pipe a script) in the local database container; rows come back as arrays of strings. */
function sql(query: string, input?: string): string[][] {
  const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', ...(input === undefined ? ['-c', query] : [])];
  const r = spawnSync('docker', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim() === '' ? [] : r.stdout.trim().split('\n').map((l) => l.split('|'));
}

const running = spawnSync('supabase', ['status'], { encoding: 'utf8' }).status === 0
  && spawnSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-Atc', 'select 1'], { encoding: 'utf8' }).status === 0;
if (!running) console.warn('SKIPPED: the live database checks in db_tests.test.ts need the local Supabase stack (run `supabase start`).');

describe.skipIf(!running)('local database agrees with the TypeScript taxonomy', () => {
  it('catalog.colour_family equals colourFamily on a grid of at least 5,000 RGB points (every family equal)', () => {
    const rows = sql(`with a as (select generate_series(0, 255, 15) as v), b as (select generate_series(7, 255, 15) as v)
      select x.v, y.v, z.v, catalog.colour_family(x.v, y.v, z.v) from a x, a y, a z
      union all select x.v, y.v, z.v, catalog.colour_family(x.v, y.v, z.v) from b x, b y, b z`);
    expect(rows.length).toBeGreaterThanOrEqual(5000);
    const mismatches = rows.map(([r, g, b, fam]) => [r, g, b, fam, colourFamily(Number(r), Number(g), Number(b))])
      .filter(([, , , sqlFam, tsFam]) => sqlFam !== tsFam).map(([r, g, b, s, t]) => `rgb(${r},${g},${b}): sql ${s}, ts ${t}`);
    expect(mismatches.slice(0, 10)).toEqual([]);
    expect(new Set(rows.map((r) => r[3])).size).toBeGreaterThanOrEqual(15); // the grid really reaches the families
  }, 120_000);

  it('the swatches (ids in seed order) equal taxonomy.json', () => {
    const expected = taxonomy.colourFamilies.flatMap((f) => f.swatches.map((hex) => [f.family, hex])).map(([family, hex], i) => [String(i + 1), family, hex]);
    expect(sql('select id, family, hex from catalog.colour_family_ref order by id')).toEqual(expected);
  });

  const simple: [string, string[]][] = [
    ['lk_category', taxonomy.categories.map((c) => c.name)], ['lk_colour_family', taxonomy.colourFamilies.map((c) => c.family)],
    ['lk_fit', taxonomy.fit], ['lk_material', taxonomy.material], ['lk_pattern', taxonomy.pattern],
    ['lk_season', taxonomy.seasons], ['lk_occasion', taxonomy.occasions],
    ['lk_size_system', taxonomy.sizeSystems.map((s) => s.code)], ['lk_condition_band', taxonomy.conditionBands.map((b) => b.code)],
  ];
  it.each(simple)('%s has exactly the taxonomy codes in the taxonomy order', (table, codes) => {
    expect(sql(`select code, sort, active from catalog.${table} order by sort`)).toEqual(codes.map((c, i) => [c, String(i + 1), 't']));
  });

  it('lk_sub_type has every sub-type under its own category, in order', () => {
    const key = (r: string[]) => `${r[0]}|${String(r[2]).padStart(3, '0')}`; // same order on both sides, whatever the collation
    const expected = taxonomy.categories.flatMap((c) => c.subTypes.map((s, i) => [c.name, s, String(i + 1)]));
    expect(sql('select category, code, sort from catalog.lk_sub_type').sort((a, b) => key(a).localeCompare(key(b))))
      .toEqual(expected.sort((a, b) => key(a).localeCompare(key(b))));
  });

  it('lk_size_system labels and condition band score ranges equal the taxonomy', () => {
    expect(sql('select code, label from catalog.lk_size_system order by sort')).toEqual(taxonomy.sizeSystems.map((s) => [s.code, s.label]));
    expect(sql('select code, min_score, max_score from catalog.lk_condition_band order by sort'))
      .toEqual(taxonomy.conditionBands.map((b) => [b.code, String(b.min), String(b.max)]));
  });

  it('re-running the generated seed changes nothing (idempotent)', () => {
    const fingerprint = `select (select count(*) from catalog.lk_sub_type), (select count(*) from catalog.colour_family_ref),
      md5((select string_agg(r::text, ',' order by id) from catalog.colour_family_ref r)),
      md5((select string_agg(r::text, ',' order by category, code) from catalog.lk_sub_type r))`;
    const before = sql(fingerprint);
    for (let i = 0; i < 2; i++) sql('', readFileSync('supabase/seed/lookups.sql', 'utf8'));
    expect(sql(fingerprint)).toEqual(before);
  });
});

// ---- WO-0070 (R5b): no password in a migration; the local password script; the claim race with real worker_role connections ----
describe('migrations never carry a database password (WO-0070)', () => {
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'));
  it.each(files)('%s sets no role password', (f) => {
    const text = readFileSync(`supabase/migrations/${f}`, 'utf8');
    expect(/(create|alter)\s+(role|user)[^;]*\bpassword\b/is.test(text)).toBe(false);
    expect(/\bpassword\s*(=|')\s*'[^']{6,}'/i.test(text.replace(/--.*$/gm, ''))).toBe(false);
  });
  it('the worker_role migration says where the password comes from', () => {
    expect(readFileSync('supabase/migrations/20261106110100_wo0070_worker_role.sql', 'utf8')).toContain('set-worker-password.sh');
  });
});

/** Run a script in a real psql session (a separate backend) in the database container; hard time limit, killed on expiry. */
function session(input: string, opts: { user?: string; timeoutMs?: number; env?: Record<string, string> } = {}): Promise<{ code: number | null; out: string; err: string; ms: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const envArgs = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    const user = opts.user ?? 'postgres';
    const args = ['exec', '-i', ...envArgs, container, 'psql', ...(user === 'postgres' ? [] : ['-h', '127.0.0.1']), '-U', user, '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1'];
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 40_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err, ms: Date.now() - t0 }); });
    child.stdin.end(input);
  });
}

const passwordVariable = 'SPARTA_WORKER_DB_PASSWORD';
describe.skipIf(!running)('worker_role: the local password script and the atomic claim (WO-0070)', () => {
  // These tests assert an empty job queue and the real-stack photo tests insert jobs: take the same lock as every integration suite (found in the WO-0073 report).
  let release: () => void = () => {};
  beforeAll(async () => { release = await lockStack(); }, 120_000);
  afterAll(() => release());
  const raceUser = '5b5b5b5b-0070-4070-8070-000000000070';
  const cleanup = () => sql(`delete from auth.users where id = '${raceUser}'`);
  const mkJobs = (n: number) => sql(`insert into auth.users (id, email) values ('${raceUser}', 'race@example.test') on conflict do nothing;
    insert into app.jobs (user_id, type, input) select '${raceUser}', 'photo', jsonb_build_object('path', '${raceUser}/' || g || '.webp') from generate_series(1, ${n}) g`, undefined);
  const claimScript = (sleepSeconds: number) => `begin;\nselect 'claimed:' || id from app.claim_job();\nselect 'at:' || extract(epoch from clock_timestamp());\nselect pg_sleep(${sleepSeconds});\ncommit;\n`;
  /** The seconds between the first and the last claim to return: a claim that waits for another session's row lock shows up as the length of that lock. */
  const claimSpread = (outs: string[]) => { const t = outs.flatMap((o) => o.split('\n').filter((l) => l.startsWith('at:')).map((l) => Number(l.slice(3)))); return Math.max(...t) - Math.min(...t); };
  const claimedIds = (outs: string[]) => outs.flatMap((o) => o.split('\n').filter((l) => l.startsWith('claimed:')).map((l) => Number(l.slice(8))));

  it('the script refuses a missing or weak password and sets and clears a real one (never printed, never in a file)', () => {
    const run = (env: Record<string, string>, ...args: string[]) => spawnSync('bash', ['supabase/scripts/set-worker-password.sh', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env }, timeout: 60_000 });
    const withValue = (value: string) => ({ [passwordVariable]: value });   // test values only: a short one, an injection attempt, a random one
    expect(run({}).status).toBe(2);
    expect(run(withValue('short')).status).toBe(2);
    expect(run(withValue("abcdefghijklmnop'; drop table x; --")).status).toBe(2);
    const generated = randomBytes(16).toString('hex');
    const ok = run(withValue(generated));
    try {
      expect(ok.status).toBe(0);
      expect(ok.stdout + ok.stderr).not.toContain(generated);
      expect(sql("select rolpassword is not null and rolpassword like 'SCRAM-SHA-256$%' from pg_authid where rolname = 'worker_role'")).toEqual([['t']]);
    } finally {
      expect(run({}, '--clear').status).toBe(0);
    }
    expect(sql("select rolpassword is null from pg_authid where rolname = 'worker_role'")).toEqual([['t']]);
  }, 120_000);

  it('a real worker_role login: reads jobs, cannot read other tables, cannot become another role', async () => {
    const r = await session("select current_user || '|' || session_user;\nselect 'jobs:' || count(*) from app.jobs;\n", { user: 'worker_role' });
    expect(r.out).toContain('worker_role|worker_role');
    expect(r.out).toMatch(/jobs:\d+/);
    for (const q of ['select 1 from app.items', 'select 1 from app.profiles', 'select 1 from auth.users', 'select 1 from storage.objects', 'set role postgres', 'set role service_role', 'set role authenticated']) {
      const x = await session(`${q};\n`, { user: 'worker_role' });
      expect([q, x.code === 0 ? 'allowed' : 'refused', x.err.includes('permission denied')]).toEqual([q, 'refused', true]);
    }
  }, 120_000);

  it('two real connections claiming at the same time never get the same job (2 jobs, 2 sessions)', async () => {
    cleanup();
    try {
      expect(sql("select count(*) from app.jobs where status = 'queued'")).toEqual([['0']]);
      mkJobs(2);
      const [a, b] = await Promise.all([session(claimScript(4), { user: 'worker_role' }), session(claimScript(4), { user: 'worker_role' })]);
      expect([a.code, b.code]).toEqual([0, 0]);
      const ids = claimedIds([a.out, b.out]);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
      expect(claimSpread([a.out, b.out])).toBeLessThan(2);   // skip locked: the second claim does not wait for the first session's lock (4 s)
      expect(sql(`select status, attempts from app.jobs where user_id = '${raceUser}' order by id`)).toEqual([['running', '1'], ['running', '1']]);
    } finally { cleanup(); }
  }, 120_000);

  it('two real connections, one job: exactly one claims it and the other gets nothing and is not made to wait', async () => {
    cleanup();
    try {
      expect(sql("select count(*) from app.jobs where status = 'queued'")).toEqual([['0']]);
      mkJobs(1);
      const [a, b] = await Promise.all([session(claimScript(4), { user: 'worker_role' }), session(claimScript(4), { user: 'worker_role' })]);
      expect([a.code, b.code]).toEqual([0, 0]);
      expect(claimedIds([a.out, b.out])).toHaveLength(1);
      expect(claimSpread([a.out, b.out])).toBeLessThan(2);   // the loser is told 'nothing' at once instead of waiting for the winner's lock (4 s)
      expect(sql(`select status, attempts from app.jobs where user_id = '${raceUser}'`)).toEqual([['running', '1']]);
    } finally { cleanup(); }
  }, 120_000);

  it('five real connections (the connection limit of the role), five jobs: five different jobs, each claimed once', async () => {
    cleanup();
    try {
      expect(sql("select count(*) from app.jobs where status = 'queued'")).toEqual([['0']]);
      mkJobs(5);
      const results = await Promise.all(Array.from({ length: 5 }, () => session(claimScript(4), { user: 'worker_role' })));
      expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0]);
      const ids = claimedIds(results.map((r) => r.out));
      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);
      expect(claimSpread(results.map((r) => r.out))).toBeLessThan(2);
      expect(sql(`select count(*) filter (where attempts = 1), count(*) from app.jobs where user_id = '${raceUser}' and status = 'running'`)).toEqual([['5', '5']]);
    } finally { cleanup(); }
  }, 180_000);
});
