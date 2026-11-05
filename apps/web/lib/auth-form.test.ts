import { describe, expect, it } from 'vitest';
import { MIN_PW_LENGTH, normaliseEmail, safeNextPath, validateAuth } from './auth-form';

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
