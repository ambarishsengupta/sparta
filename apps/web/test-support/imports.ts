import { posix } from 'node:path';

/** Test support (WO-0074): which modules does a source text pull in? Used by source.test.ts to pin who may import the server-only modules.
 * Covers `import x from 'm'`, `import 'm'`, `import type ... from 'm'`, `export ... from 'm'` and `export * from 'm'` (single line or split over lines),
 * dynamic `import('m')`, and `require('m')`, each with single quotes, double quotes, or a back-tick string without `${}`. A match inside a comment or string
 * is counted too: this is a pin, so a false alarm is acceptable and a miss is not. */
export interface Ref { spec: string; reexport: boolean }
/** A quoted string whose opening quote is capture group `n` (the spec is group n + 1); a back-tick string with `$` in it is not "template-less" and is skipped. */
const q = (n: number) => `(['"\`])((?:(?!\\${n})[^\\\\\\n$]|\\\\.)+?)\\${n}`;
const FROM = new RegExp(`\\b(export\\b[^;'"\`]*?)?\\bfrom\\s*${q(2)}`, 'g');
const SIDE = new RegExp(`\\bimport\\s*${q(1)}`, 'g');                           // import 'm'
const CALL = new RegExp(`\\b(?:import|require)\\s*\\(\\s*${q(1)}\\s*\\)`, 'g');   // import('m'), require('m')

export function refs(source: string): Ref[] {
  const out: Ref[] = [];
  for (const m of source.matchAll(FROM)) out.push({ spec: m[3]!, reexport: m[1] !== undefined && /^export\b/.test(m[1]) });
  for (const m of source.matchAll(SIDE)) out.push({ spec: m[2]!, reexport: false });
  for (const m of source.matchAll(CALL)) out.push({ spec: m[2]!, reexport: false });
  return out;
}
export const specifiers = (source: string): string[] => refs(source).map((r) => r.spec);

const bare = (p: string) => p.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '').replace(/\/index$/, '');
const resolve = (from: string, spec: string) => (spec.startsWith('.') ? bare(posix.normalize(posix.join(posix.dirname(from), spec))) : null);

/** The files (keys of `sources`, paths relative to one root) that import a module whose specifier matches `target`, directly or through a chain of
 * modules that re-export it (`export { x } from './a'` where `./a` re-exports the target, and so on). A re-exporting module is itself a direct importer. */
export function importersOf(sources: Record<string, string>, target: RegExp): string[] {
  const parsed = Object.entries(sources).map(([file, text]) => ({ file, refs: refs(text) }));
  const tainted = new Set<string>();   // files (without extension) that re-export the target, directly or through another tainted file
  for (let changed = true; changed;) {
    changed = false;
    for (const { file, refs: rs } of parsed) {
      if (tainted.has(bare(file))) continue;
      if (rs.some((r) => r.reexport && (target.test(r.spec) || tainted.has(resolve(file, r.spec) ?? '')))) { tainted.add(bare(file)); changed = true; }
    }
  }
  return parsed.filter(({ file, refs: rs }) => rs.some((r) => target.test(r.spec) || tainted.has(resolve(file, r.spec) ?? ''))).map((p) => p.file).sort();
}
