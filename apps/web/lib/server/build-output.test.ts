import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { discover } from '../../test-support/stack';

// WO-0071: the built CLIENT bundle (`.next/static`, everything served to browsers) holds none of the secret-key words, the worker token's name, or
// a key value; and the real local secret key appears nowhere in the build output at all (it is read at run time, never inlined). Run after
// `npm run build -w apps/web` (the work order's command does). The words are assembled so this file does not hold them (source.test.ts).
vi.setConfig({ testTimeout: 120_000 });   // the server build is read once per test; a loaded machine took 15 s
const next = new URL('../../.next', import.meta.url).pathname;
const built = existsSync(join(next, 'static'));
if (!built) console.warn('SKIPPED build-output.test.ts: apps/web/.next/static does not exist. Run `npm run build -w apps/web` first.');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const f = join(dir, n); return statSync(f).isDirectory() ? files(f) : [f]; });
}
const WORDS: [string, RegExp][] = [
  ['the secret-key variable name', new RegExp(['SUPABASE', 'SECRET', 'KEY'].join('_'))],
  ['the service-role name', new RegExp(['service', 'role'].join('_'), 'i')],
  ['the worker token variable name', new RegExp(['WORKER', 'API', 'TOKEN'].join('_'))],
  // supabase-js itself contains the bare prefix (a `startsWith` check, its own refusal to run a secret key in a browser); a key VALUE has a long tail
  ['a secret key value', new RegExp(['sb', 'secret', '[A-Za-z0-9_-]{10,}'].join('_'))],
  ['a service-role JWT', /eyJ[A-Za-z0-9_-]{30,}\.eyJ[A-Za-z0-9_-]{30,}/],
];

describe.skipIf(!built)('the built client bundle (apps/web/.next/static)', () => {
  const statics = built ? files(join(next, 'static')).filter((f) => /\.(js|css|html|json|map|txt)$/.test(f)) : [];
  it('is not empty', () => { expect(statics.length).toBeGreaterThan(5); });
  it.each(WORDS)('contains no %s', (_n, re) => { expect(statics.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => f.slice(next.length))).toEqual([]); });
  it('the server-only module IS in the server build (so the scan above is not vacuous)', () => {
    const server = files(join(next, 'server')).filter((f) => f.endsWith('.js'));
    expect(server.some((f) => readFileSync(f, 'utf8').includes(['SUPABASE', 'SECRET', 'KEY'].join('_')))).toBe(true);
  });
  const stack = discover();
  it.skipIf(!stack?.secret)('the local secret key value appears nowhere in the build output (client or server bundles)', () => {
    const everything = ['static', 'server'].flatMap((d) => files(join(next, d))).filter((f) => statSync(f).size < 20_000_000);   // not .next/cache: webpack's own cache, never served
    expect(everything.filter((f) => readFileSync(f, 'utf8').includes(stack!.secret)).map((f) => f.slice(next.length))).toEqual([]);
  });
});
