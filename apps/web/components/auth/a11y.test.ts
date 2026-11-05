/// <reference types="vite/client" />
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CheckYourEmail from '../../app/(auth)/check-your-email/page';
import { Nav } from '../Nav';
import { AuthForm } from './AuthForm';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined, refresh: () => undefined }), usePathname: () => '/sign-in' }));
const html = (mode: 'sign-up' | 'sign-in' | 'reset') => renderToStaticMarkup(createElement(AuthForm, { mode }));
const source = import.meta.glob<string>('./AuthForm.tsx', { query: '?raw', import: 'default', eager: true });

/** Problems with form controls in rendered HTML: an input without a non-empty label, or an aria-describedby that points nowhere. */
function problems(markup: string): string[] {
  const out: string[] = [];
  const ids = new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of markup.matchAll(/<input\b[^>]*>/g)) {
    const id = /\sid="([^"]+)"/.exec(m[0])?.[1];
    const label = id && new RegExp(`<label[^>]*\\sfor="${id}"[^>]*>([^<]+)</label>`).exec(markup);
    if (!label || label[1]!.trim() === '') out.push(`${m[0]} has no label`);
    for (const ref of /aria-describedby="([^"]+)"/.exec(m[0])?.[1]?.split(' ') ?? []) if (!ids.has(ref)) out.push(`${ref} is not on the page`);
  }
  for (const m of markup.matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)) if (m[1]!.trim() === '') out.push('a button has no text');
  return out;
}

describe('auth screens: labelled inputs, headings, hints (CC6)', () => {
  it('the checker flags an unlabelled input, an empty label and a dangling description', () => {
    expect(problems('<input id="a" type="text"/>')).toHaveLength(1);
    expect(problems('<label for="a"> </label><input id="a"/>')).toHaveLength(1);
    expect(problems('<label for="a">A</label><input id="a" aria-describedby="gone"/>')).toHaveLength(1);
    expect(problems('<label for="a">A</label><input id="a"/><button>Go</button>')).toEqual([]);
  });
  it.each(['sign-up', 'sign-in', 'reset'] as const)('%s: every control has a name and there is exactly one h1', (mode) => {
    const markup = html(mode);
    expect(problems(markup)).toEqual([]);
    expect(markup.match(/<h1>/g)).toHaveLength(1);
    expect(markup).toContain('<label for="auth-email">Email address</label>');
    expect(markup).toMatch(/<input[^>]*type="email"[^>]*autoComplete="email"|<input[^>]*autoComplete="email"[^>]*type="email"|<input[^>]*type="email"[^>]*autocomplete="email"|<input[^>]*autocomplete="email"[^>]*type="email"/);
  });
  it('sign-up states the 10 character minimum in the UI and links it to the password field', () => {
    const markup = html('sign-up');
    expect(markup).toContain('At least 10 characters.');
    expect(markup).toMatch(/<input id="auth-pw"[^>]*aria-describedby="auth-pw-hint"/);
    expect(markup).toMatch(/autoComplete="new-password"|autocomplete="new-password"/i);
  });
  it('sign-in asks for the current password; reset has no password field', () => {
    expect(html('sign-in')).toMatch(/autoComplete="current-password"|autocomplete="current-password"/i);
    expect(html('reset')).not.toContain('type="password"');
  });
  it('focus order follows reading order: email, password, button, then the links', () => {
    const markup = html('sign-in');
    const at = (s: string) => markup.indexOf(s);
    expect(at('id="auth-email"')).toBeGreaterThan(-1);
    expect(at('id="auth-email"')).toBeLessThan(at('id="auth-pw"'));
    expect(at('id="auth-pw"')).toBeLessThan(at('type="submit"'));
    expect(at('type="submit"')).toBeLessThan(at('href="/sign-up"'));
  });
  it('every error paragraph is announced (role="alert") and the status lines use role="status"', () => {
    const text = Object.values(source)[0]!;
    const errors = text.match(/<p [^>]*className="error"[^>]*>/g) ?? [];
    expect(errors.length).toBeGreaterThanOrEqual(3);
    for (const p of errors) expect(p).toContain('role="alert"');
    expect(text).toContain('role="status"');
    expect(text).toContain('aria-invalid');
  });
  it('the check-your-email screen has a heading, text and a way back', () => {
    const markup = renderToStaticMarkup(createElement(CheckYourEmail));
    expect(markup).toContain('<h1>Check your email</h1>');
    expect(markup).toContain('href="/sign-in"');
  });
});

describe('navigation: Sign out only when signed in', () => {
  it('shows a POST form to /auth/sign-out when signed in', () => {
    const markup = renderToStaticMarkup(createElement(Nav, { signedIn: true }));
    expect(markup).toMatch(/<form[^>]*action="\/auth\/sign-out"[^>]*method="post"|<form[^>]*method="post"[^>]*action="\/auth\/sign-out"/);
    expect(markup).toContain('>Sign out</button>');
  });
  it('shows nothing of the kind by default (local backend)', () => {
    expect(renderToStaticMarkup(createElement(Nav))).not.toContain('Sign out');
  });
  it('the Sign out button uses the link colour on the bar surface, so the contrast tests of the tokens cover it', () => {
    const sheet = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');
    const rule = /button\.linklike\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? '';
    expect(rule).toContain('color: var(--link)');
    expect(rule).toContain('background: none');
    expect(rule).toMatch(/min-height:\s*44px/);
  });
});
