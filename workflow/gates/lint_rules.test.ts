import { execSync } from 'node:child_process';
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

const WRAPPERS = ['node-fetch', 'cross-fetch', 'ofetch', 'axios', 'ky', 'got'] as const;
const FACTORIES = ['createBrowserClient', 'createServerClient', 'createClient'] as const;

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
  ['a library module names an untyped Supabase client', LIB, "import type { SupabaseClient } from '@supabase/supabase-js';\nexport type C = Pick<SupabaseClient, 'auth' | 'schema'>;\n", 'no-restricted-syntax'],
  ['the secret-key module names an untyped Supabase client', 'apps/web/lib/server/admin.ts', "import type { SupabaseClient } from '@supabase/supabase-js';\nexport const f = (c: SupabaseClient): SupabaseClient => c;\n", 'no-restricted-syntax'],
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
  // WO-0129: one sample per new plugin. eslint-plugin-jsx-a11y 6.10.2 has no sample because npm refuses it next to ESLint 10 (docs/LINT-RULES.md).
  ['an effect reads a prop that is not in its dependency list (eslint-plugin-react-hooks)', COMPONENT, "import { useEffect, useState } from 'react';\nexport function C({ n }: { n: number }) {\n  const [v, setV] = useState(0);\n  useEffect(() => { setV(n); }, []);\n  return <i>{v}</i>;\n}\n", 'react-hooks/exhaustive-deps'],
  ['a regular expression that backtracks exponentially (eslint-plugin-regexp)', LIB, "export const words = (s: string): boolean => /^(\\w+\\s?)*$/.test(s);\n", 'regexp/no-super-linear-backtracking'],
  // WO-0153: a fetch wrapper under an app path and an engine path (one sample per package), and an untyped Supabase factory call.
  ...WRAPPERS.flatMap((pkg) => [
    [`a component imports ${pkg}`, COMPONENT, `import w from '${pkg}';\nexport const f = w;\n`, '@typescript-eslint/no-restricted-imports'],
    [`a route handler imports ${pkg}`, ROUTE, `import w from '${pkg}';\nexport const f = w;\n`, '@typescript-eslint/no-restricted-imports'],
    [`the secret-key module imports ${pkg}`, 'apps/web/lib/server/admin.ts', `import w from '${pkg}';\nexport const f = w;\n`, '@typescript-eslint/no-restricted-imports'],
    [`the engine imports ${pkg}`, ENGINE, `import w from '${pkg}';\nexport const f = w;\n`, '@typescript-eslint/no-restricted-imports'],
  ] as [string, string, string, string][]),
  ...FACTORIES.map((fn): [string, string, string, string] => [`a call of ${fn} without the Database type argument`, 'apps/web/lib/supabase/browser.ts', `export const c = ${fn}('u', 'k');\n`, 'no-restricted-syntax']),
  ['a component imports a subpath of axios', COMPONENT, "import a from 'axios/lib/core/Axios';\nexport const f = a;\n", '@typescript-eslint/no-restricted-imports'],
  ['an untyped factory call in the secret-key module', 'apps/web/lib/server/admin.ts', "export const c = createClient('u', 'k');\n", 'no-restricted-syntax'],
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

  it('a client that names the database passes, and no module may hold an untyped one (WO-0150 emptied the list of exceptions; it may not grow)', async () => {
    const typed = "import type { SupabaseClient } from '@supabase/supabase-js';\nimport type { Database } from './supabase/database.types';\nexport type C = Pick<SupabaseClient<Database>, 'auth' | 'schema'>;\n";
    expect(await rulesFor(LIB, typed)).toEqual([]);
    const untyped = "import type { SupabaseClient } from '@supabase/supabase-js';\nexport type C = Pick<SupabaseClient, 'auth'>;\n";
    const config = readFileSync('eslint.config.js', 'utf8');
    // the list of exceptions is empty: ESLint's computed configuration of EVERY tracked web-app source file (tests and test-support aside)
    // holds the untyped-client selector at error, so an exception added for any module, in any wording, fails here
    const SELECTOR = "TSTypeReference[typeName.name='SupabaseClient']:not([typeArguments])";
    const sources = execSync("git ls-files 'apps/web/**/*.ts' 'apps/web/**/*.tsx'", { encoding: 'utf8' }).split('\n')
      .filter((f) => f && !/\.test\.tsx?$/.test(f) && !f.startsWith('apps/web/test-support/'));
    expect(sources.length).toBeGreaterThan(100);
    const without: string[] = [];
    for (const f of sources) {
      const rule: unknown = (await eslint.calculateConfigForFile(f) as { rules?: Record<string, unknown> } | undefined)?.rules?.['no-restricted-syntax'];
      const on = Array.isArray(rule) && (rule[0] === 2 || rule[0] === 'error') && rule.slice(1).some((o: unknown) => typeof o === 'object' && o !== null && (o as { selector?: unknown }).selector === SELECTOR);
      if (!on) without.push(f);
    }
    expect(without).toEqual([]);
    expect(config).toContain(SELECTOR);
    // the three modules WO-0150 typed refuse an untyped client like every other library module
    for (const p of ['apps/web/lib/supabase/repository.ts', 'apps/web/lib/supabase/backend.ts', 'apps/web/lib/server/admin-catalog.ts']) {
      expect(existsSync(p), p).toBe(true);
      expect(await rulesFor(p, untyped), p).toContain('no-restricted-syntax');
      expect(readFileSync(p, 'utf8').replace(/^import .*$/gm, ''), p).not.toMatch(/SupabaseClient(?!<)/); // the import line names the type; every use must name the database
    }
    // a test file may build loose clients
    expect(await rulesFor(WEB_TEST, untyped)).toEqual([]);
  }, 120_000);

  it('a typed factory call passes; a fetch wrapper is refused in every app and engine source file; the factory selector is on in every app source file (WO-0153)', async () => {
    const typed = "import { createBrowserClient } from '@supabase/ssr';\nimport type { Database } from './database.types';\nexport const c = createBrowserClient<Database>('u', 'k');\n";
    expect(await rulesFor('apps/web/lib/supabase/browser.ts', typed)).toEqual([]);
    // ESLint's computed configuration of every tracked source file (tests and test-support aside): the factory selector at error in the
    // web app, and the wrapper names in the import restriction of the web app and of the engine packages (no file without it)
    const SELECTOR = "CallExpression[callee.name=/^(createBrowserClient|createServerClient|createClient)$/]:not([typeArguments])";
    const tracked = (glob: string[]): string[] => execSync(`git ls-files ${glob.map((g) => `'${g}'`).join(' ')}`, { encoding: 'utf8' }).split('\n')
      .filter((f) => f && !/\.test\.tsx?$/.test(f) && !f.startsWith('apps/web/test-support/') && !f.includes('/fixtures/'));
    const web = tracked(['apps/web/**/*.ts', 'apps/web/**/*.tsx']);
    const engine = tracked(['packages/*/src/*.ts', 'packages/*/src/**/*.ts']);
    expect(web.length).toBeGreaterThan(100);
    expect(engine.length).toBeGreaterThan(5);
    const rulesOf = async (f: string): Promise<Record<string, unknown>> => (await eslint.calculateConfigForFile(f) as { rules?: Record<string, unknown> } | undefined)?.rules ?? {};
    const isError = (r: unknown): r is unknown[] => Array.isArray(r) && (r[0] === 2 || r[0] === 'error');
    const noSelector: string[] = [];
    const noWrappers: string[] = [];
    const wrappersListed = (r: unknown): boolean => {
      if (!isError(r)) return false;
      const opts = r.slice(1) as { paths?: (string | { name: string })[]; patterns?: { group?: string[] }[] }[];
      const paths = opts.flatMap((o) => (o.paths ?? []).map((x) => (typeof x === 'string' ? x : x.name)));
      const groups = opts.flatMap((o) => (o.patterns ?? []).flatMap((p) => p.group ?? []));
      return WRAPPERS.every((w) => paths.includes(w) && groups.includes(`${w}/*`));   // the six exact paths and the six subpath patterns
    };
    for (const f of [...web, ...engine]) {
      const rules = await rulesOf(f);
      if (f.startsWith('apps/web/')) {
        const rule = rules['no-restricted-syntax'];
        if (!(isError(rule) && rule.slice(1).some((o) => typeof o === 'object' && o !== null && (o as { selector?: unknown }).selector === SELECTOR))) noSelector.push(f);
      }
      if (!wrappersListed(rules['@typescript-eslint/no-restricted-imports'])) noWrappers.push(f);
    }
    expect(noSelector).toEqual([]);
    expect(noWrappers).toEqual([]);
    expect(readFileSync('eslint.config.js', 'utf8')).toContain(SELECTOR);
    // exact names only: a local module or another package whose name holds a wrapper name is not refused
    expect(await rulesFor(COMPONENT, "import k from './got';\nexport const f = k;\n")).not.toContain('@typescript-eslint/no-restricted-imports');
    expect(await rulesFor(COMPONENT, "import k from 'kysely';\nexport const f = k;\n")).not.toContain('@typescript-eslint/no-restricted-imports');
    expect(await rulesFor(WEB_TEST, "import axios from 'axios';\nexport const f = axios;\n")).toEqual([]);
    // a test file may build loose clients and import anything
    expect(await rulesFor(WEB_TEST, "import { createClient } from '@supabase/supabase-js';\nexport const c = createClient('u', 'k');\n")).toEqual([]);
  }, 180_000);

  it('the baseline exists, names only the new plugins\' rules, and holds no boundary rule (those have no exceptions)', () => {
    expect(existsSync('eslint-suppressions.json')).toBe(true);
    const baseline = JSON.parse(readFileSync('eslint-suppressions.json', 'utf8')) as Record<string, Record<string, { count: number }>>;
    const rules = new Set(Object.values(baseline).flatMap((r) => Object.keys(r)));
    for (const never of ['no-restricted-syntax', 'no-restricted-globals', '@typescript-eslint/no-restricted-imports', 'no-eval', 'no-console', '@typescript-eslint/no-explicit-any', '@typescript-eslint/ban-ts-comment']) {
      expect(rules.has(never), never).toBe(false);
    }
    // WO-0129: only the rules of eslint-plugin-react-hooks and eslint-plugin-regexp are baselined (WO-0125 and WO-0126 emptied every older rule).
    for (const rule of rules) expect(rule, rule).toMatch(/^(react-hooks|regexp)\//);
  });

  it('the baseline may only shrink: its counts per rule are exact (lower a number when a finding is fixed; never raise one)', () => {
    const baseline = JSON.parse(readFileSync('eslint-suppressions.json', 'utf8')) as Record<string, Record<string, { count: number }>>;
    const perRule: Record<string, number> = {};
    for (const entry of Object.values(baseline)) for (const [rule, { count }] of Object.entries(entry)) perRule[rule] = (perRule[rule] ?? 0) + count;
    // Counted on 2026-11-17 when WO-0129 added the two plugins (npx eslint . --suppress-all): 177 findings in 68 files.
    expect(perRule).toEqual({
      'react-hooks/exhaustive-deps': 3,
    'react-hooks/refs': 6,
    'react-hooks/set-state-in-effect': 8,
    'regexp/match-any': 3,
    'regexp/negation': 1,
    'regexp/no-contradiction-with-assertion': 10,
    'regexp/no-dupe-characters-character-class': 4,
    'regexp/no-dupe-disjunctions': 2,
    'regexp/no-empty-alternative': 1,
    'regexp/no-obscure-range': 4,
    'regexp/no-super-linear-backtracking': 14,
    'regexp/no-unused-capturing-group': 67,
    'regexp/no-useless-character-class': 2,
    'regexp/no-useless-flag': 1,
    'regexp/no-useless-non-capturing-group': 1,
    'regexp/prefer-d': 22,
    'regexp/prefer-w': 11,
    'regexp/use-ignore-case': 17
    });
    expect(Object.values(perRule).reduce((n, c) => n + c, 0)).toBe(177);
    expect(Object.keys(baseline)).toHaveLength(68);
  });
});
