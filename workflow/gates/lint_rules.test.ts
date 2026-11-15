import { existsSync, readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// WO-0123: each project lint rule is shown to FIRE on a small bad sample, so a rule that is switched off, mistyped or scoped to the
// wrong folder fails here. Each sample is linted as TEXT under the path of a real file of that kind (the type-aware rules need a file the
// TypeScript project knows); the file itself is never read or written.
const eslint = new ESLint({ cwd: process.cwd() });
const rulesFor = async (filePath: string, code: string): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal: ${m.message}`);
};
const [COMPONENT, LIB, ROUTE, WEB_TEST] = ['apps/web/components/Nav.tsx', 'apps/web/lib/money.ts', 'apps/web/app/api/admin/sources/route.ts', 'apps/web/proxy.test.ts'] as const;
const [ENGINE, ENGINE_TEST, SCRIPT] = ['packages/rules/src/season.ts', 'packages/rules/src/season.test.ts', 'supabase/scripts/gen-seed.ts'] as const;
const SERVER_ONLY_VAR = ['SUPABASE', 'SECRET', 'KEY'].join('_');   // assembled: the secret scans read the bare name as a finding

const CASES: [name: string, path: string, code: string, rule: string][] = [
  ['a component reads a server-only variable', COMPONENT, `export const k = process.env.${SERVER_ONLY_VAR};\n`, 'no-restricted-syntax'],
  ['a component reads any environment variable', COMPONENT, 'export const k = process.env.NEXT_PUBLIC_DATA_BACKEND;\n', 'no-restricted-syntax'],
  ['a component reads the demo image folder variable', COMPONENT, `export const k = process.env.HM_DEMO_IMAGE_ROOT;\n`, 'no-restricted-syntax'],
  ['a configuration module reads a server-only variable', 'apps/web/lib/pilot-config.ts', `export const k = process.env.${SERVER_ONLY_VAR};\n`, 'no-restricted-syntax'],
  ['a computed environment read in the secret-key module', 'apps/web/lib/server/admin.ts', "const n = 'X'; export const k = process.env[n];\n", 'no-restricted-syntax'],
  ['a component imports the secret-key module', COMPONENT, "import { createAdminSupabase } from '../lib/server/admin';\nexport const c = createAdminSupabase;\n", '@typescript-eslint/no-restricted-imports'],
  ['a library module imports lib/server', LIB, "import { fail } from './server/api';\nexport const f = fail;\n", '@typescript-eslint/no-restricted-imports'],
  ['a component builds its own Supabase client', COMPONENT, "import { createClient } from '@supabase/supabase-js';\nexport const c = createClient;\n", '@typescript-eslint/no-restricted-imports'],
  ['a route handler builds its own Supabase client', ROUTE, "import { createClient } from '@supabase/supabase-js';\nexport const c = createClient;\n", '@typescript-eslint/no-restricted-imports'],
  ['a component calls the network directly', COMPONENT, "export const load = () => fetch('/api/x');\n", 'no-restricted-globals'],
  ['a component injects HTML', COMPONENT, 'export const P = ({ h }: { h: string }) => <div dangerouslySetInnerHTML={{ __html: h }} />;\n', 'no-restricted-syntax'],
  ['a component logs to the console', COMPONENT, "export const f = () => { console.log('x'); };\n", 'no-console'],
  ['a promise is left floating', COMPONENT, 'const work = async (): Promise<void> => {};\nexport const f = () => { work(); };\n', '@typescript-eslint/no-floating-promises'],
  ['a promise is returned without await inside try', LIB, 'const work = async (): Promise<number> => 1;\nexport async function f(): Promise<number> { try { return work(); } catch { return 0; } }\n', '@typescript-eslint/return-await'],
  ['an untyped value is used without narrowing', LIB, 'export const f = (s: string): string => { const v = JSON.parse(s); return v.name; };\n', '@typescript-eslint/no-unsafe-assignment'],
  ['an explicit any', LIB, 'export const f = (v: any): number => Number(v);\n', '@typescript-eslint/no-explicit-any'],
  ['a focused test', WEB_TEST, "import { it } from 'vitest';\nit.only('x', () => {});\n", 'no-restricted-syntax'],
  ['a skipped test', ENGINE_TEST, "import { describe } from 'vitest';\ndescribe.skip('x', () => {});\n", 'no-restricted-syntax'],
  ['the engine imports a Node module', ENGINE, "import { readFileSync } from 'node:fs';\nexport const r = readFileSync;\n", '@typescript-eslint/no-restricted-imports'],
  ['the engine calls the network', ENGINE, "export const load = () => fetch('https://example.test/');\n", 'no-restricted-globals'],
  ['the engine reads the environment', 'packages/taxonomy/src/index.ts', 'export const e = process.env;\n', 'no-restricted-globals'],
  ['dynamic code', SCRIPT, "export const r = eval('1');\n", 'no-eval'],
  ['a type-check suppression', LIB, '// @ts-ignore\nexport const n: number = 1;\n', '@typescript-eslint/ban-ts-comment'],
];

describe('the project lint rules fire (eslint.config.js, WO-0123)', () => {
  it.each(CASES)('%s', async (_name, path, code, rule) => {
    expect(await rulesFor(path, code)).toContain(rule);
  }, 60_000);

  it('every sample path is a real file', () => {
    for (const p of [COMPONENT, LIB, ROUTE, WEB_TEST, ENGINE, ENGINE_TEST, SCRIPT, 'apps/web/lib/pilot-config.ts', 'apps/web/lib/server/admin.ts', 'packages/taxonomy/src/index.ts']) expect(existsSync(p), p).toBe(true);
  });

  it('an inline eslint-disable comment switches nothing off', async () => {
    const found = await rulesFor(SCRIPT, "/* eslint-disable */\nexport const r = eval('1');\n");
    expect(found).toContain('no-eval');
  }, 60_000);

  it('the allowed places stay allowed (the rules are scoped, not blanket)', async () => {
    expect(await rulesFor('apps/web/lib/pilot-config.ts', 'export const k = process.env.NEXT_PUBLIC_CONTACT_EMAIL;\n')).toEqual([]);
    expect(await rulesFor(ROUTE, "import { fail } from '../../../../lib/server/api';\nexport const f = fail;\n")).toEqual([]);
    expect(await rulesFor(WEB_TEST, "import { describe } from 'vitest';\ndescribe.skipIf(true)('x', () => {});\n")).toEqual([]);
  }, 60_000);

  it('the baseline exists, names only known rules, and holds no boundary rule (those have no exceptions)', () => {
    expect(existsSync('eslint-suppressions.json')).toBe(true);
    const baseline = JSON.parse(readFileSync('eslint-suppressions.json', 'utf8')) as Record<string, Record<string, { count: number }>>;
    const rules = new Set(Object.values(baseline).flatMap((r) => Object.keys(r)));
    for (const never of ['no-restricted-syntax', 'no-restricted-globals', '@typescript-eslint/no-restricted-imports', 'no-eval', 'no-console', '@typescript-eslint/no-explicit-any', '@typescript-eslint/ban-ts-comment']) {
      expect(rules.has(never), never).toBe(false);
    }
    // The baseline may only shrink (work orders WO-0125 and WO-0126). Raise this number never; lower it as entries are fixed.
    const total = Object.values(baseline).flatMap((r) => Object.values(r)).reduce((n, e) => n + e.count, 0);
    expect(total).toBeLessThanOrEqual(40);
  });
});
