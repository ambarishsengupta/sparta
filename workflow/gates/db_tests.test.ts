// WO-0040 / CC4: (1) db_tests.sh behaves (stubbed supabase CLI), (2) the generated-seed test, (3) the live-database checks:
// SQL colour_family equals the TypeScript one on a grid, and the seeded lookups equal the taxonomy JSON. Part (3) is skipped,
// with a message, when the local Supabase stack is not running. It talks to the local database container only.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { colourFamily } from '@sparta/taxonomy';
import { describe, expect, it } from 'vitest';
import taxonomy from '../../packages/taxonomy/src/taxonomy.json';
import '../../supabase/scripts/seed.test';

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
