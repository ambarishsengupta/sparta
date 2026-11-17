import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REDIRECT_PAYLOADS } from '../test-support/redirect-payloads';
import { MIN_PW_LENGTH, finishSignIn, normaliseEmail, safeNextPath, validateAuth } from './auth-form';

const pw = (n: number) => 'x'.repeat(n);
describe('validateAuth (CC6: password of at least 10 characters, checked in the browser too)', () => {
  it('states the minimum as 10', () => { expect(MIN_PW_LENGTH).toBe(10); });
  it('sign-up accepts exactly 10 characters and refuses 9', () => {
    expect(validateAuth('sign-up', 'a@b.co', pw(10))).toEqual({});
    expect(validateAuth('sign-up', 'a@b.co', pw(9)).pw).toMatch(/at least 10 characters/);
  });
  it('counts characters, not UTF-16 units: ten emoji pass, nine do not', () => {
    expect(validateAuth('sign-up', 'a@b.co', '😀'.repeat(10))).toEqual({});
    expect(validateAuth('sign-up', 'a@b.co', '😀'.repeat(9)).pw).toBeDefined();
  });
  it('sign-in does not apply the length rule but needs a password', () => {
    expect(validateAuth('sign-in', 'a@b.co', pw(3))).toEqual({});
    expect(validateAuth('sign-in', 'a@b.co', '').pw).toBe('Enter your password.');
  });
  it('reset needs only a valid email', () => {
    expect(validateAuth('reset', 'a@b.co', '')).toEqual({});
    expect(validateAuth('reset', '', '').email).toBe('Enter your email address.');
  });
  it.each(['', '   ', 'plain', 'a@b', '@b.co', 'a b@c.co', 'a@@b.co'])('refuses the email %j in every mode', (email) => {
    for (const mode of ['sign-up', 'sign-in', 'reset'] as const) expect(validateAuth(mode, email, pw(12)).email).toBeDefined();
  });
  it('trims and lower-cases the email before checking and sending', () => {
    expect(normaliseEmail('  Ann@Example.COM ')).toBe('ann@example.com');
    expect(validateAuth('sign-up', '  Ann@Example.COM ', pw(10))).toEqual({});
  });
});

describe('safeNextPath: no open redirect after sign-in', () => {
  it.each([['/outfits', '/outfits'], ['/items/new?x=1', '/items/new?x=1'], [null, '/'], [undefined, '/'], ['', '/']])('keeps %j as %j', (input, out) => {
    expect(safeNextPath(input)).toBe(out);
  });
  it.each(['https://evil.example/', '//evil.example/x', '/\\evil.example', '/\t/evil.example', 'javascript:alert(1)', 'outfits', '///evil.example'])('turns %j into the home page', (input) => {
    expect(safeNextPath(input)).toBe('/');
  });
});

describe('safeNextPath: the open-redirect payloads (B1)', () => {
  it.each(REDIRECT_PAYLOADS)('turns %j into the home page', (payload) => { expect(safeNextPath(payload)).toBe('/'); });
  it.each([['/outfits', '/outfits'], ['/outfits?anchor=item-1', '/outfits?anchor=item-1'], ['/items/new', '/items/new'], ['/items/abc-123', '/items/abc-123'],
    ['/outfits?anchor=item-1&x=%2F%2Fevil.com', '/outfits?anchor=item-1&x=%2F%2Fevil.com'], ['/a/../outfits', '/outfits'], ['/', '/']])('keeps the legitimate path %j', (input, out) => {
    expect(safeNextPath(input)).toBe(out);
  });
  it('whatever comes in, what comes out is one slash followed by anything but a slash, with no backslash and no control character', () => {
    const pieces = ['/', '.', '..', '%2e', '%2f', '\\', '\t', '\n', 'a', 'evil.com', '?', '=', '&', '#', ':', '@', ' ', ' ', '%5c', '%09'];
    let seed = 12345;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let i = 0; i < 4000; i++) {
      const input = '/' + Array.from({ length: 1 + rand(7) }, () => pieces[rand(pieces.length)]).join('');
      const out = safeNextPath(input);
      expect(out.startsWith('/') && !out.startsWith('//'), input).toBe(true);
      expect([...out].some((c) => c === '\\' || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f), input).toBe(false);
      expect(new URL(out, 'http://app.example').origin, input).toBe('http://app.example');
    }
  });
});

describe('the two places that follow a "next" value both use safeNextPath (B1 sinks)', () => {
  it('the sign-in form leaves the page only through finishSignIn, to the checked path', () => {
    for (const payload of REDIRECT_PAYLOADS) { const seen: string[] = []; finishSignIn(payload, (to) => seen.push(to)); expect(seen, payload).toEqual(['/']); }
    const seen: string[] = [];
    finishSignIn('/outfits', (to) => seen.push(to));
    finishSignIn(undefined, (to) => seen.push(to));
    expect(seen).toEqual(['/outfits', '/']);
  });
  const form = readFileSync(new URL('../components/auth/AuthForm.tsx', import.meta.url), 'utf8');
  it('AuthForm calls finishSignIn(next, ...) with a full navigation, and has no other way of following next (m1: no router race)', () => {
    expect(form).toContain("finishSignIn(next, (to) => window.location.assign(to))");
    expect(form.match(/window\.location\.assign\(/g)).toHaveLength(1);
    expect(form).not.toMatch(/router\.(replace|push)\((?!'\/check-your-email')/);
    expect(form).not.toContain('router.refresh');
  });
  it('the sign-in page hands the raw query value to the form, which is the only reader of it', () => {
    const page = readFileSync(new URL('../app/(auth)/sign-in/page.tsx', import.meta.url), 'utf8');
    expect(page).toContain('next={next}');
    expect(page).not.toMatch(/redirect\(|router\./);
  });
});
