import { describe, expect, it } from 'vitest';
import { importersOf, refs, specifiers } from './imports';

// WO-0074 item 3: synthetic source strings, one per import form. Quotes are written as @ (single), § (double) and ¤ (back-tick) and swapped in by `src`,
// so this file does not contain the forms itself and source.test.ts does not count it as an importer.
const src = (t: string) => t.replace(/@/g, '\'').replace(/§/g, '"').replace(/¤/g, '`');
const SERVER = /(^|\/)admin$/;

describe('specifiers: every way a module can be pulled in', () => {
  it.each([
    ['a single-quoted import', 'import { a } from @../lib/server/admin@;'],
    ['a double-quoted import', 'import { a } from §../lib/server/admin§;'],
    ['a default import', 'import a from §../lib/server/admin§'],
    ['a namespace import', 'import * as a from §../lib/server/admin§'],
    ['a type import', 'import type { A } from @../lib/server/admin@'],
    ['an import split over lines', 'import {\n  a,\n  b,\n} from\n  §../lib/server/admin§;'],
    ['a side-effect import', 'import §../lib/server/admin§;'],
    ['a side-effect import, single quotes', 'import @../lib/server/admin@'],
    ['a dynamic import, single quotes', 'const m = await import(@../lib/server/admin@);'],
    ['a dynamic import, double quotes', 'const m = await import(§../lib/server/admin§);'],
    ['a dynamic import with spaces', 'const m = await import(  §../lib/server/admin§  );'],
    ['a dynamic import, template without placeholders', 'const m = await import(¤../lib/server/admin¤);'],
    ['a require, single quotes', 'const m = require(@../lib/server/admin@);'],
    ['a require, double quotes', 'const m = require(§../lib/server/admin§);'],
    ['a require, template without placeholders', 'const m = require(¤../lib/server/admin¤);'],
    ['an export-from, single quotes', 'export { a } from @../lib/server/admin@;'],
    ['an export-from, double quotes', 'export { a } from §../lib/server/admin§;'],
    ['an export-star', 'export * from §../lib/server/admin§;'],
    ['an export-star as a name', 'export * as admin from §../lib/server/admin§;'],
    ['an export type-from', 'export type { A } from §../lib/server/admin§;'],
    ['an export-from over several lines', 'export {\n  a,\n  b,\n}\n  from\n  @../lib/server/admin@;'],
  ])('finds %s', (_n, text) => { expect(specifiers(src(text))).toEqual(['../lib/server/admin']); });

  it('tells a re-export from an import', () => {
    expect(refs(src('export { a } from §x§; import b from §y§; export * from @z@;')).map((r) => `${r.spec}:${r.reexport}`).sort()).toEqual(['x:true', 'y:false', 'z:true']);
  });
  it('a multi-line export-from is a re-export, and so is a multi-line export type or star-as', () => {
    for (const t of ['export {\n  a,\n  b,\n}\n  from\n  @x@;', 'export type {\n  A,\n} from @x@;', 'export *\n  as ns from §x§;']) expect(refs(src(t))).toEqual([{ spec: 'x', reexport: true }]);
  });
  it('finds several forms in one file', () => {
    expect(specifiers(src('import a from @a@;\nimport §b§;\nconst c = require(§c§);\nconst d = await import(@d@);\nexport * from §e§;')).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('does not take a computed dynamic import as a string (nothing to pin: the test for it is that the module name cannot be read)', () => {
    expect(specifiers(src('const m = await import(name); const n = require(base + @x@); const t = await import(¤./${name}¤);'))).toEqual([]);
  });
  it('does not mistake other words for imports', () => {
    expect(specifiers(src('const important = 1; const reimport = (x) => x; reimport(@a@); const from = 3; const data = { from: @b@ };'))).toEqual([]);
  });
});

describe('importersOf: direct importers and re-export chains', () => {
  const files = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, src(v)]));
  it.each([
    ['single quotes', 'import { a } from @../lib/server/admin@;'], ['double quotes', 'import { a } from §../lib/server/admin§;'],
    ['dynamic import', 'const m = await import(@../lib/server/admin@);'], ['dynamic import, double quotes', 'const m = await import(§../lib/server/admin§);'],
    ['require', 'const m = require(§../lib/server/admin§);'], ['export from', 'export { a } from §../lib/server/admin§;'], ['export star', 'export * from @../lib/server/admin@;'],
  ])('a component that uses %s is an importer', (_n, text) => {
    expect(importersOf(files({ 'components/a.tsx': text, 'components/b.tsx': 'import x from @./a@;' }), SERVER)).toContain('components/a.tsx');
  });
  it('a file that imports something else is not', () => {
    expect(importersOf(files({ 'components/a.tsx': 'import { a } from @../lib/server/other@; const adminish = require(§./administrator§);' }), SERVER)).toEqual([]);
  });
  it('a file importing a module that re-exports the admin module is an importer too (one hop)', () => {
    const r = importersOf(files({
      'lib/relay.ts': 'export { createAdminSupabase } from §./server/admin§;',
      'components/a.tsx': 'import { createAdminSupabase } from @../lib/relay@;',
      'components/clean.tsx': 'import { x } from @../lib/other@;',
    }), SERVER);
    expect(r).toEqual(['components/a.tsx', 'lib/relay.ts']);
  });
  it('a chain of re-exports of any length is followed, with every quote form and with export * and index files', () => {
    const r = importersOf(files({
      'lib/one.ts': 'export * from §./server/admin§;',
      'lib/two.ts': 'export { createAdminSupabase as make } from @./one@;',
      'lib/three/index.ts': 'export * as deep from §../two§;',
      'lib/four.ts': 'export { make } from ¤./three¤;',
      'components/a.tsx': 'const m = await import(§../lib/four§);',
      'components/b.tsx': 'const m = require(@../lib/two@);',
      'components/c.tsx': 'import { x } from §../lib/unrelated§;',
      'lib/unrelated.ts': 'export const x = 1;',
    }), SERVER);
    expect(r).toEqual(['components/a.tsx', 'components/b.tsx', 'lib/four.ts', 'lib/one.ts', 'lib/three/index.ts', 'lib/two.ts']);
  });
  it('a plain import (not a re-export) of an importer does not make the importing file an importer', () => {
    const r = importersOf(files({ 'lib/user.ts': 'import { createAdminSupabase } from @./server/admin@; export const f = () => createAdminSupabase();', 'components/a.tsx': 'import { f } from @../lib/user@;' }), SERVER);
    expect(r).toEqual(['lib/user.ts']);
  });
  it('extensions in the specifier do not hide a chain', () => {
    const r = importersOf(files({ 'lib/relay.ts': 'export * from @./server/admin@;', 'components/a.tsx': 'import { x } from @../lib/relay.ts@;' }), SERVER);
    expect(r).toContain('components/a.tsx');
  });
});
