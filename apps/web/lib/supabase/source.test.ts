import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importersOf, specifiers } from '../../test-support/imports';

const root = new URL('../..', import.meta.url).pathname;
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (['node_modules', '.next', '.env.local'].includes(name)) return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}
const all = files(root);
// The forbidden words are assembled here so this file does not contain them itself.
// WO-0071 (R5b decision): the secret key may be named in exactly one module, lib/server/admin.ts (and its variable in .env.example, empty). Each entry lists the
// files that must hold the word: no folder wildcard, and the list must match exactly, so a second file (or the module losing the word) fails.
const ADMIN = 'lib/server/admin.ts';
const FORBIDDEN: [string, RegExp, string[]][] = [
  ['the service-role name', new RegExp(['service', 'role'].join('_'), 'i'), [ADMIN]],
  ['a secret-key variable', new RegExp(['SUPABASE', 'SECRET', 'KEY'].join('_')), ['.env.example', ADMIN]],
  ['a secret key value', new RegExp(['sb', 'secret', ''].join('_')), [ADMIN]],
  ['a service-role JWT', new RegExp('eyJ[A-Za-z0-9_-]{30,}\\.eyJ'), []],
  ['a publishable key value', new RegExp(['sb', 'publishable', '[A-Za-z0-9_-]{8,}'].join('_')), []],
];
const WORKER_VAR = ['WORKER', 'API', 'TOKEN'].join('_');

describe('no secret or service key anywhere in apps/web except the one server-only module (CC4, CC7; WO-0071)', () => {
  it('scans the app, its tests and its config', () => { expect(all.length).toBeGreaterThan(40); });
  it.each(FORBIDDEN)('%s appears only in the files listed for it', (_name, pattern, allowed) => {
    expect(all.filter((f) => pattern.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length)).sort()).toEqual(allowed);
  });
  it('.env.example lists the Supabase variables, the secret key and the worker token with empty values', () => {
    const text = readFileSync(join(root, '.env.example'), 'utf8');
    for (const name of ['NEXT_PUBLIC_DATA_BACKEND', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ['SUPABASE', 'SECRET', 'KEY'].join('_'), WORKER_VAR]) expect(text).toMatch(new RegExp(`^${name}=$`, 'm'));
  });
  it('.env.local is git-ignored', () => { expect(readFileSync(join(root, '.gitignore'), 'utf8').split('\n')).toContain('.env.local'); });
  it('the app reads only public (NEXT_PUBLIC_) environment variables, and the three Supabase ones among them; the only others are the secret key (admin module) and the worker token (worker route)', () => {
    const reads = all.filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts')).flatMap((f) => readFileSync(f, 'utf8').split('\n').flatMap((line) => [...(line.split('//')[0] ?? '').matchAll(/process\.env\.(\w+)/g)].map((m) => `${m[1]} <- ${f.slice(root.length)}`)));
    const names = new Set(reads.map((r) => r.split(' <- ')[0]!));
    expect([...new Set(reads.filter((r) => !r.startsWith('NEXT_PUBLIC_')))].sort()).toEqual([`${['SUPABASE', 'SECRET', 'KEY'].join('_')} <- ${ADMIN}`, `${WORKER_VAR} <- app/api/worker/signed-urls/route.ts`].sort());
    for (const n of ['NEXT_PUBLIC_DATA_BACKEND', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL']) expect(names.has(n)).toBe(true);
  });
  it('the secret-key module is imported by the two route handlers and its own test, and nothing else imports anything from lib/server', () => {
    const sources = all.filter((f) => /\.tsx?$/.test(f) && !f.includes('/node_modules/'));
    // WO-0074: every import form (quotes, dynamic import(), require(), export ... from, re-export chains), see test-support/imports.ts and imports.test.ts
    const text = Object.fromEntries(sources.map((f) => [f.slice(root.length), readFileSync(f, 'utf8')]));
    const importing = (re: RegExp) => importersOf(text, re);
    expect(importing(/(^|\/)admin$/)).toEqual(['app/api/account/purge-storage/route.ts', 'app/api/worker/signed-urls/route.ts', 'lib/server/admin.test.ts']);
    const outside = importing(/(^|\/)server\/[a-z-]+$/).filter((f) => !f.startsWith('lib/server/'));
    // route handlers, and the integration/support code that exercises the handlers; no page, component or other lib module
    expect(outside).toEqual(['app/api/account/purge-storage/route.ts', 'app/api/worker/signed-urls/route.ts', 'test-support/purge.ts']);
  });
  it('the Leave screen removes the files through the server before the deletion, and the purge route never takes a user id from the request', () => {
    expect(readFileSync(join(root, 'components/account/LeaveForm.tsx'), 'utf8')).toContain('leaveThePilot(createBrowserSupabase(), pw, () => purgeMyStorage())');
    const route = readFileSync(join(root, 'app/api/account/purge-storage/route.ts'), 'utf8');
    expect(route).not.toMatch(/searchParams|\.json\(\)|\.text\(\)|formData|params/);
    // the files are removed with the secret-key client's storage and the caller's own session only proves who is asking (the caller's storage client has no delete right)
    expect(route).toContain('handlePurge(request, { caller, storage: admin.storage })');
    expect(route).toContain('const caller = await createServerSupabase();');
    expect(readFileSync(join(root, 'app/api/worker/signed-urls/route.ts'), 'utf8')).toContain('storage: admin.storage,');
    // WO-0074: the worker route's two budgets come from workerLimiters(), one for correct calls and a separate one for failures
    const worker = readFileSync(join(root, 'app/api/worker/signed-urls/route.ts'), 'utf8');
    expect(worker).toContain('const limiters = workerLimiters();');
    expect(worker).toContain('allow: limiters.allow,');
    expect(worker).toContain('allowFailure: limiters.allowFailure,');
  });
  it('no page or component renders user-supplied HTML', () => {
    expect(all.filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts') && readFileSync(f, 'utf8').includes('dangerously')).map((f) => f.slice(root.length))).toEqual([]);
  });
});

// The suggestion path (see components/outfits/outfits.test.ts) must stay offline. That test leaves the sign-in modules out of its
// scan by name, so this one proves that nothing it does scan can reach them, except the repository modules (WO-0052).
describe('the suggestion path reaches only the repository modules of lib/supabase (companion to the no-network test)', () => {
  const path = all.filter((f) => /\/(lib\/[^/]+\.ts|lib\/supabase\/(repository|mapping|errors|config)\.ts|components\/outfits\/[^/]+\.tsx|app\/outfits\/.*\.tsx|components\/use-(repository|learned)\.ts)$/.test(f) && !f.endsWith('.test.ts'));
  const importsOf = (f: string) => specifiers(readFileSync(f, 'utf8'));
  const ALLOWED = /(^|\/)supabase\/(config|errors|backend|repository|mapping)$|^\.\/(config|errors|mapping)$/;
  it('finds the suggestion sources', () => { expect(path.length).toBeGreaterThanOrEqual(19); });
  it('none imports a sign-in module, lib/auth-form or an Auth package; the only others are the repository modules, config and errors', () => {
    const bad = path.flatMap((f) => importsOf(f).filter((i) => /supabase|auth-form/.test(i) && !ALLOWED.test(i) && !(f.endsWith('/lib/supabase/repository.ts') && i === '@supabase/supabase-js')).map((i) => `${f.slice(root.length)} -> ${i}`));
    expect(bad).toEqual([]);
  });
  it('the Supabase package is imported by the repository as a type only', () => {
    const text = readFileSync(join(root, 'lib/supabase/repository.ts'), 'utf8');
    expect([...text.matchAll(/^import (.*) from '@supabase\/supabase-js';$/gm)].map((m) => m[1])).toEqual(['type { SupabaseClient }']);
  });
  it('backend.ts, the one module the network test leaves out by name, imports exactly the session client, the gate state and the repositories', () => {
    expect(importsOf(join(root, 'lib/supabase/backend.ts')).sort()).toEqual(
      ['../local-repository', '../repository', './browser', './config', './errors', './errors', './gate', './gate-state', './repository', '@supabase/supabase-js'].sort());
  });
  it('only the use-repository hook imports backend.ts', () => {
    const users = all.filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts') && importsOf(f).some((i) => /\/backend$/.test(i)));
    expect(users.map((f) => f.slice(root.length))).toEqual(['components/use-repository.ts']);
  });
});

// WO-0053 (B1): an inventory of every place the app leaves a page or sends a redirect. Each takes a fixed path, a path the gate chose itself,
// or the one value that comes from a request (`next`), which must pass through safeNextPath first. A new sink makes this list fail.
describe('every redirect sink takes a fixed path or a checked one', () => {
  const sources = all.filter((f) => /\.tsx?$/.test(f) && !/\.test\.ts$/.test(f) && !f.includes('/test-support/'));
  const calls = (pattern: RegExp) => sources.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(pattern)].map((m) => `${f.slice(root.length)}: ${m[0]}`)).sort();
  it('seeOther(...) is called with a literal path or safeNextPath(...) only', () => {
    expect(calls(/\bseeOther\((?!path: string)[^\n]*\)/g)).toEqual([
      "app/auth/callback/route.ts: seeOther(safeNextPath(searchParams.get('next')))",
      "app/auth/callback/route.ts: seeOther('/sign-in?error=link')",
      "app/auth/sign-out/route.ts: seeOther('/sign-in')",
    ].sort());
  });
  it('window.location.assign(...) is called with the fixed home path, the fixed goodbye path (R2c, after Leave the pilot), or with the value finishSignIn has checked', () => {
    expect(calls(/location\.assign\([^)]*\)/g)).toEqual([
      "components/account/LeaveForm.tsx: location.assign('/goodbye')",
      "components/auth/AuthForm.tsx: location.assign(to)",
      "components/consent/AcceptTermsForm.tsx: location.assign('/')",
      "components/consent/OnboardingForm.tsx: location.assign('/')",
      "components/consent/PilotNoticeForm.tsx: location.assign('/')",
    ].sort());
  });
  it('router.push / router.replace take fixed paths, and nothing else assigns location or redirects from the request', () => {
    expect(calls(/router\.(push|replace)\([^)]*\)/g)).toEqual([
      "components/auth/AuthForm.tsx: router.replace('/check-your-email')",
      "components/wardrobe/ItemForm.tsx: router.push('/')",
      "components/wardrobe/ItemForm.tsx: router.push('/')",
      "components/wardrobe/ItemForm.tsx: router.push('/')",
    ].sort());
    expect(calls(/location\.(href|replace)\s*=|location\.replace\(|\bpermanentRedirect\b|import \{[^}]*\bredirect\b[^}]*\} from 'next\/navigation'/g)).toEqual([]);
  });
  it('the only NextResponse.redirect is the proxy\'s, and its target is built from the gate decision', () => {
    expect(calls(/NextResponse\.redirect\([^)]*\)/g)).toEqual(['proxy.ts: NextResponse.redirect(target)']);
    expect(readFileSync(join(root, 'proxy.ts'), 'utf8')).toContain('const target = new URL(decision.to, request.nextUrl.origin);');
  });
});
