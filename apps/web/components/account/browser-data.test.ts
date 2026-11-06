/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EVENTS_KEY } from '../../lib/events';
import { SETTINGS_KEY } from '../../lib/suggestions-view-model';
import { STORAGE_KEY } from '../../lib/local-repository';
import { Nav } from '../Nav';
import { USAGE_KEY_PREFIXES, clearBrowserUsage, type ClearableStorage } from './browser-data';
import { SignOutForm } from './SignOutForm';
import { clearSessionCookies, expiredCookie } from './account-actions';

// WO-0062 items 6 and 7: the browser-only usage log goes on Leave the pilot and on Sign out; every session cookie is expired with the path it was set on.
const root = new URL('../../', import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (['node_modules', '.next'].includes(n) ? [] : statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
}
const sources = files(root).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'));

class FakeStorage implements ClearableStorage {
  readonly data = new Map<string, string>();
  removed: string[] = [];
  constructor(entries: Record<string, string>) { Object.entries(entries).forEach(([k, v]) => this.data.set(k, v)); }
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(k: string) { this.removed.push(k); this.data.delete(k); }
}

describe('clearBrowserUsage (item 7)', () => {
  it('removes the usage log and the settings, whatever the version, and nothing else', () => {
    const s = new FakeStorage({ [EVENTS_KEY]: '{}', [SETTINGS_KEY]: '{}', 'sparta.events.v2': '{}', 'sparta.settings.v9': '{}', [STORAGE_KEY]: 'wardrobe', other: 'x', 'sparta.eventsX': 'y', theme: 'dark' });
    const removed = clearBrowserUsage(s);
    expect(removed.sort()).toEqual([EVENTS_KEY, 'sparta.events.v2', SETTINGS_KEY, 'sparta.settings.v9'].sort());
    expect([...s.data.keys()].sort()).toEqual([STORAGE_KEY, 'other', 'sparta.eventsX', 'theme'].sort());
  });
  it('the two keys the app writes are covered by the prefixes (so a renamed key breaks this test, not the privacy promise)', () => {
    expect(EVENTS_KEY).toBe('sparta.events.v1');
    expect(SETTINGS_KEY).toBe('sparta.settings.v1');
    for (const k of [EVENTS_KEY, SETTINGS_KEY]) expect(USAGE_KEY_PREFIXES.some((p) => k.startsWith(p))).toBe(true);
    expect(USAGE_KEY_PREFIXES.some((p) => STORAGE_KEY.startsWith(p))).toBe(false); // the no-account wardrobe is not usage data
  });
  it('every sparta.* storage key the app source names is either cleared here or the device-local wardrobe: a new key has to be decided on', () => {
    const named = new Set(sources.flatMap((f) => [...read(f.slice(root.length)).matchAll(/['"`](sparta\.[a-z]+\.v\d+)['"`]/g)].map((m) => m[1]!)));
    expect([...named].sort()).toEqual([EVENTS_KEY, SETTINGS_KEY, STORAGE_KEY].sort());
  });
  it('keys are listed before any is removed, so none is skipped as the storage shrinks', () => {
    const s = new FakeStorage(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`sparta.events.v${i}`, '1'])));
    expect(clearBrowserUsage(s)).toHaveLength(30);
    expect(s.length).toBe(0);
  });
  it('blocked or missing storage is nothing to remove, never an error', () => {
    expect(clearBrowserUsage(null)).toEqual([]);
    expect(clearBrowserUsage({ length: 1, key: () => { throw new Error('blocked'); }, removeItem: () => undefined })).toEqual([]);
    const s = new FakeStorage({ 'sparta.events.v1': '1', 'sparta.settings.v1': '1' });
    s.removeItem = (k: string) => { if (k === 'sparta.events.v1') throw new Error('blocked'); s.data.delete(k); };
    expect(clearBrowserUsage(s)).toEqual(['sparta.settings.v1']);
    expect(clearBrowserUsage()).toEqual([]); // no localStorage in this test environment
  });
});

describe('Sign out and Leave the pilot clear it (item 7)', () => {
  it('SignOutForm is the one place that posts to /auth/sign-out; it clears the usage data on submit and never cancels the post', () => {
    const offenders = sources.filter((f) => read(f.slice(root.length)).includes('action="/auth/sign-out"')).map((f) => f.slice(root.length));
    expect(offenders).toEqual(['components/account/SignOutForm.tsx']);
    const src = read('components/account/SignOutForm.tsx');
    expect(src).toMatch(/onSubmit=\{\(\) => \{ clearBrowserUsage\(\); \}\}/);
    expect(src).not.toContain('preventDefault');
    expect(src).toContain("'use client'");
  });
  it('and it is still a POST form with a button (works without scripts)', () => {
    const m = renderToStaticMarkup(createElement(SignOutForm));
    expect(m).toBe('<form action="/auth/sign-out" method="post"><button type="submit">Sign out</button></form>');
    expect(renderToStaticMarkup(createElement(Nav, { signedIn: true }))).toContain('<form action="/auth/sign-out" method="post"><button type="submit" class="linklike">Sign out</button></form>');
  });
  it('every page that offers Sign out uses it', () => {
    for (const page of ['app/(auth)/settings/page.tsx', 'app/(auth)/not-available/page.tsx', 'components/Nav.tsx', 'components/account/HeldOptions.tsx']) expect(read(page), page).toContain('SignOutForm');
  });
  it('the Leave form clears the session cookies and the usage data, after the account is gone and before it opens the goodbye page', () => {
    const src = read('components/account/LeaveForm.tsx');
    const ok = src.indexOf('if (out.ok)');
    const cookies = src.indexOf('clearSessionCookies(document)');
    const usage = src.indexOf('clearBrowserUsage()');
    const goodbye = src.indexOf("location.assign('/goodbye')");
    expect(ok).toBeGreaterThan(0);
    expect(ok).toBeLessThan(cookies);
    expect(cookies).toBeLessThan(goodbye);
    expect(ok).toBeLessThan(usage);
    expect(usage).toBeLessThan(goodbye);
  });
});

// ---- A01: every sb- cookie is expired, with the path it was set on -----------------------------------------------------------
/** A cookie jar that behaves like a browser's for the parts that matter here: an assignment without Path uses the directory of the page (here /leave -> /), a cookie is removed only by an
 * assignment with the same name and path that has Max-Age=0 (or a past Expires), and everything is visible to the page. The cookies were set by Supabase on Path=/. */
function jar(initial: [name: string, path: string][], pagePath = '/leave/confirm') {
  const store = new Map<string, true>(initial.map(([n, p]) => [`${n}\u0000${p}`, true]));
  const defaultPath = pagePath.slice(0, pagePath.lastIndexOf('/')) || '/';
  return {
    get cookie() { return [...store.keys()].map((k) => `${k.split('\u0000')[0]}=value`).join('; '); },
    set cookie(line: string) {
      const [pair, ...attrs] = line.split(';').map((p) => p.trim());
      const name = pair!.split('=')[0]!;
      const a = Object.fromEntries(attrs.map((x) => { const [k, ...v] = x.split('='); return [k!.toLowerCase(), v.join('=')]; }));
      const path = a.path ?? defaultPath;
      const gone = (a['max-age'] !== undefined && Number(a['max-age']) <= 0) || (a.expires !== undefined && Date.parse(a.expires) < Date.now());
      if (gone) store.delete(`${name}\u0000${path}`); else store.set(`${name}\u0000${path}`, true);
    },
    names: () => [...store.keys()].map((k) => k.split('\u0000')[0]!),
  };
}

describe('session cookies are expired on the path they were set (A01)', () => {
  const SB = ['sb-abcdefgh-auth-token', 'sb-abcdefgh-auth-token.0', 'sb-abcdefgh-auth-token.1', 'sb-abcdefgh-auth-token.2', 'sb-abcdefgh-auth-token-code-verifier', 'sb-x-auth-token-user'];
  it('the expiry text names the cookie, the whole site path and an age of zero', () => {
    expect(expiredCookie('sb-a-auth-token')).toBe('sb-a-auth-token=; Max-Age=0; Path=/; SameSite=Lax');
    for (const n of SB) { const e = expiredCookie(n); expect(e.startsWith(`${n}=;`)).toBe(true); expect(e).toMatch(/;\s*Path=\/(;|$)/); expect(e).toMatch(/;\s*Max-Age=0(;|$)/); }
  });
  it('every sb- cookie is gone from the jar (pieces .0 .1 .2 and the code verifier too) and the other cookies stay', () => {
    const j = jar([...SB, 'theme', 'sbx', 'xsb-1', 'sparta'].map((n) => [n, '/'] as [string, string]));
    const gone = clearSessionCookies(j);
    expect(gone.sort()).toEqual([...SB].sort());
    expect(j.names().sort()).toEqual(['sbx', 'sparta', 'theme', 'xsb-1']);
  });
  it('a cookie expired without Path=/ would stay: the jar really does model the path rule (the control for the test above)', () => {
    const j = jar([['sb-a-auth-token', '/']]);
    j.cookie = 'sb-a-auth-token=; Max-Age=0; SameSite=Lax';
    expect(j.names()).toEqual(['sb-a-auth-token']);
    j.cookie = 'sb-a-auth-token=; Path=/; SameSite=Lax';
    expect(j.names()).toEqual(['sb-a-auth-token']); // no Max-Age: it is set again, not removed
    j.cookie = 'sb-a-auth-token=; Max-Age=0; Path=/; SameSite=Lax';
    expect(j.names()).toEqual([]);
  });
  it('with no cookies there is nothing to do, and the result is the list of names it expired', () => {
    expect(clearSessionCookies(jar([]))).toEqual([]);
    expect(clearSessionCookies(jar([['sb-a-auth-token', '/']]))).toEqual(['sb-a-auth-token']);
  });
  it('the Leave form expires them through this function (not through a copy of the string)', () => {
    expect(read('components/account/LeaveForm.tsx')).toContain('clearSessionCookies(document)');
    expect(read('components/account/LeaveForm.tsx')).not.toContain('Max-Age');
  });
});
