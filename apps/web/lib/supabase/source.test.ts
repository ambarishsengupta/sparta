import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
const FORBIDDEN: [string, RegExp][] = [
  ['the service-role name', new RegExp(['service', 'role'].join('_'), 'i')],
  ['a secret-key variable', new RegExp(['SUPABASE', 'SECRET', 'KEY'].join('_'))],
  ['a secret key value', new RegExp(['sb', 'secret', ''].join('_'))],
  ['a service-role JWT', new RegExp('eyJ[A-Za-z0-9_-]{30,}\\.eyJ')],
  ['a publishable key value', new RegExp(['sb', 'publishable', '[A-Za-z0-9_-]{8,}'].join('_'))],
];

describe('no secret or service key anywhere in apps/web (CC4, CC7)', () => {
  it('scans the app, its tests and its config', () => { expect(all.length).toBeGreaterThan(40); });
  it.each(FORBIDDEN)('%s appears in no file of apps/web', (_name, pattern) => {
    expect(all.filter((f) => pattern.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length))).toEqual([]);
  });
  it('.env.example lists the three variables with empty values', () => {
    const text = readFileSync(join(root, '.env.example'), 'utf8');
    for (const name of ['NEXT_PUBLIC_DATA_BACKEND', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']) expect(text).toMatch(new RegExp(`^${name}=$`, 'm'));
  });
  it('.env.local is git-ignored', () => { expect(readFileSync(join(root, '.gitignore'), 'utf8').split('\n')).toContain('.env.local'); });
  it('the app reads only public (NEXT_PUBLIC_) environment variables, and the three Supabase ones among them', () => {
    const names = new Set(all.filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts')).flatMap((f) => readFileSync(f, 'utf8').split('\n').flatMap((line) => [...(line.split('//')[0] ?? '').matchAll(/process\.env\.(\w+)/g)].map((m) => m[1]))));
    expect([...names].filter((n) => !n!.startsWith('NEXT_PUBLIC_'))).toEqual([]);
    for (const n of ['NEXT_PUBLIC_DATA_BACKEND', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL']) expect(names.has(n)).toBe(true);
  });
  it('no page or component renders user-supplied HTML', () => {
    expect(all.filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts') && readFileSync(f, 'utf8').includes('dangerously')).map((f) => f.slice(root.length))).toEqual([]);
  });
});

// The suggestion path (see components/outfits/outfits.test.ts) must stay offline. That test leaves the sign-in modules out of its
// scan by name, so this one proves that nothing it does scan can reach them.
describe('the suggestion path does not import the sign-in modules (companion to the no-network test)', () => {
  const path = all.filter((f) => /\/(lib\/[^/]+\.ts|components\/outfits\/[^/]+\.tsx|app\/outfits\/.*\.tsx|components\/use-(repository|learned)\.ts)$/.test(f) && !f.endsWith('.test.ts'));
  it('finds the suggestion sources', () => { expect(path.length).toBeGreaterThanOrEqual(15); });
  it('none imports lib/supabase, lib/auth-form or an Auth package', () => {
    const bad = path.filter((f) => [...readFileSync(f, 'utf8').matchAll(/from '([^']+)'/g)].some((m) => /supabase|auth-form/.test(m[1]!)));
    expect(bad.map((f) => f.slice(root.length))).toEqual([]);
  });
});
