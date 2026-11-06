import { describe, expect, it } from 'vitest';
import { bearerToken, makeLimiter, MIN_BEARER_CHARS, tokenMatches } from './limits';

const B = 'a'.repeat(31) + 'b';   // 32 characters

describe('tokenMatches (constant-time bearer comparison)', () => {
  it('accepts the identical token of at least 32 characters', () => { expect(tokenMatches(B, B)).toBe(true); expect(MIN_BEARER_CHARS).toBe(32); });
  it('refuses a token that differs in the first, middle or last character', () => {
    for (const i of [0, 15, 31]) expect(tokenMatches(B.slice(0, i) + 'c' + B.slice(i + 1), B)).toBe(false);
  });
  it('refuses longer, shorter and empty tokens, and non-strings', () => {
    expect(tokenMatches(B + 'x', B)).toBe(false);
    expect(tokenMatches(B.slice(0, 31), B)).toBe(false);
    expect(tokenMatches('', B)).toBe(false);
    expect(tokenMatches(null, B)).toBe(false);
    expect(tokenMatches(undefined, B)).toBe(false);
    expect(tokenMatches(B, undefined)).toBe(false);
    expect(tokenMatches(B, null)).toBe(false);
    expect(tokenMatches(12345 as unknown as string, B)).toBe(false);
  });
  it('a configured token under 32 characters matches nothing, not even itself', () => {
    expect(tokenMatches('short', 'short')).toBe(false);
    expect(tokenMatches('x'.repeat(31), 'x'.repeat(31))).toBe(false);
    expect(tokenMatches('', '')).toBe(false);
  });
  it('compares characters, not bytes of a prefix: a token that only shares a long prefix fails', () => {
    expect(tokenMatches(`${B}${B}`, B)).toBe(false);
    expect(tokenMatches(B, `${B}${B}`)).toBe(false);
  });
});

describe('bearerToken', () => {
  it('reads exactly "Bearer <token>"', () => { expect(bearerToken(`Bearer ${B}`)).toBe(B); });
  it.each([null, undefined, '', 'Bearer', 'Bearer ', `bearer ${B}`, `Basic ${B}`, `Bearer ${B} extra`, ` Bearer ${B}`, `Bearer  ${B}`, B, `Bearer ${B}\n`])('refuses %j', (h) => { expect(bearerToken(h)).toBeNull(); });
});

describe('makeLimiter (fixed window per process)', () => {
  it('allows max calls in a window, then refuses, then allows again in the next window', () => {
    let now = 1000;
    const allow = makeLimiter(3, 1000, () => now);
    expect([allow(), allow(), allow(), allow(), allow()]).toEqual([true, true, true, false, false]);
    now += 999; expect(allow()).toBe(false);
    now += 1; expect(allow()).toBe(true);
  });
  it('a clock that goes backwards starts a new window instead of locking the route', () => {
    let now = 5000;
    const allow = makeLimiter(1, 1000, () => now);
    expect(allow()).toBe(true); expect(allow()).toBe(false);
    now = 100; expect(allow()).toBe(true);
  });
});
