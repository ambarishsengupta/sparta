import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { discover } from '../../test-support/stack';

// WO-0071: the built CLIENT bundle (`.next/static`, everything served to browsers) holds none of the secret-key words, the worker token's name, or
// a key value; and the real local secret key appears nowhere in the build output at all (it is read at run time, never inlined). Run after
// `npm run build -w apps/web` (the work order's command does). The words are assembled so this file does not hold them (source.test.ts).
vi.setConfig({ testTimeout: 120_000 });   // the server build is read once per test; a loaded machine took 15 s
// WO-0074: workflow/gates/web_containment.sh builds with dummy secret values and runs this file with SPARTA_REQUIRE_BUILD=1, and then a missing build is a FAILURE,
// not a skip. SPARTA_NEXT_DIR points the file at another build directory (the test of that rule in workflow/gates/web_containment.test.ts uses a missing one).
const next = process.env.SPARTA_NEXT_DIR ?? new URL('../../.next', import.meta.url).pathname;
const built = existsSync(join(next, 'static'));
const required = process.env.SPARTA_REQUIRE_BUILD === '1';
if (!built && !required) console.warn('SKIPPED build-output.test.ts: apps/web/.next/static does not exist. Run `npm run build -w apps/web` first.');
// the dummy values the containment stage put in the build environment (never real keys); absent in an ordinary run
const DUMMIES = [process.env.SPARTA_CONTAINMENT_KEY, process.env.SPARTA_CONTAINMENT_WORKER].filter((v): v is string => typeof v === 'string' && v.length >= 20);
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

describe.runIf(required)('SPARTA_REQUIRE_BUILD=1 (the containment stage of the gate)', () => {
  it('the build output exists: a missing build is a failure here, never a skip', () => { expect(built, `no build at ${next}`).toBe(true); });
  it('the stage handed over its dummy secret key and worker token', () => { expect(DUMMIES.length).toBe(2); });
});

describe.skipIf(!built)('the built client bundle (apps/web/.next/static)', () => {
  const statics = built ? files(join(next, 'static')).filter((f) => /\.(js|css|html|json|map|txt)$/.test(f)) : [];
  it('is not empty', () => { expect(statics.length).toBeGreaterThan(5); });
  it.each(WORDS)('contains no %s', (_n, re) => { expect(statics.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => f.slice(next.length))).toEqual([]); });
  it('the server-only module IS in the server build (so the scan above is not vacuous)', () => {
    const server = files(join(next, 'server')).filter((f) => f.endsWith('.js'));
    expect(server.some((f) => readFileSync(f, 'utf8').includes(['SUPABASE', 'SECRET', 'KEY'].join('_')))).toBe(true);
  });
  it.skipIf(DUMMIES.length === 0)('the dummy secret key and worker token of the build environment appear nowhere in the build output (client or server bundles)', () => {
    const everything = ['static', 'server'].flatMap((d) => files(join(next, d))).filter((f) => statSync(f).size < 20_000_000);
    for (const dummy of DUMMIES) expect(everything.filter((f) => readFileSync(f, 'utf8').includes(dummy)).map((f) => f.slice(next.length))).toEqual([]);
  });
  const stack = built ? discover() : null;
  it.skipIf(!stack?.secret)('the local secret key value appears nowhere in the build output (client or server bundles)', () => {
    const everything = ['static', 'server'].flatMap((d) => files(join(next, d))).filter((f) => statSync(f).size < 20_000_000);   // not .next/cache: webpack's own cache, never served
    expect(everything.filter((f) => readFileSync(f, 'utf8').includes(stack!.secret)).map((f) => f.slice(next.length))).toEqual([]);
  });
});
