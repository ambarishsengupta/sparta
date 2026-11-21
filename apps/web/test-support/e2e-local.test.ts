import { describe, expect, it } from 'vitest';
import { assertLocalStack, belongsToRun, isLocalUrl, runPattern, syntheticAddress, syntheticPassword } from './e2e-local';

// WO-0168: the end-to-end suite refuses to run unless the stack is local. The refusal is pinned here so the gate runs it (the suite itself needs a browser and the stack).
const OK = { supabaseUrl: 'http://127.0.0.1:54321', mailUrl: 'http://127.0.0.1:54324', dbUrl: 'postgresql://postgres:secret@127.0.0.1:54322/postgres' };

describe('the end-to-end suite runs only against the local stack', () => {
  it('accepts 127.0.0.1, localhost and [::1] for all three URLs', () => {
    expect(assertLocalStack(OK)).toEqual(OK);
    expect(() => assertLocalStack({ supabaseUrl: 'http://localhost:54321', mailUrl: 'http://[::1]:54324', dbUrl: 'postgres://postgres:x@localhost:54322/postgres' })).not.toThrow();
  });
  it.each([
    ['a hosted Supabase URL', { ...OK, supabaseUrl: 'https://abcdefgh.supabase.co' }, 'the Supabase URL'],
    ['a hosted database URL', { ...OK, dbUrl: 'postgresql://postgres:x@db.abcdefgh.supabase.co:5432/postgres' }, 'the database URL'],
    ['a remote mail catcher', { ...OK, mailUrl: 'http://mail.example.org:8025' }, 'the mail catcher URL'],
    ['a host that only starts with 127.0.0.1', { ...OK, supabaseUrl: 'http://127.0.0.1.evil.example' }, 'the Supabase URL'],
    ['a user name that looks like a local host', { ...OK, supabaseUrl: 'http://127.0.0.1@evil.example' }, 'the Supabase URL'],
    ['a database URL with ?host= (libpq would connect elsewhere)', { ...OK, dbUrl: 'postgresql://postgres:x@127.0.0.1/postgres?host=db.example.org' }, 'the database URL'],
    ['a fragment', { ...OK, supabaseUrl: 'http://127.0.0.1:54321#x' }, 'the Supabase URL'],
    ['a value that is not a URL', { ...OK, supabaseUrl: 'localhost' }, 'the Supabase URL'],
    ['a ftp scheme', { ...OK, supabaseUrl: 'ftp://127.0.0.1' }, 'the Supabase URL'],
  ])('refuses %s', (_label, urls, which) => {
    expect(() => assertLocalStack(urls)).toThrow(`refuse to run: ${which}`);
  });
  it('refuses a missing URL and names every bad setting', () => {
    expect(() => assertLocalStack({})).toThrow('the Supabase URL, the mail catcher URL, the database URL');
    expect(() => assertLocalStack({ ...OK, dbUrl: '' })).toThrow('the database URL');
  });
  it('never puts the offending value (it may hold a password) in the message', () => {
    let message = '';
    try { assertLocalStack({ ...OK, dbUrl: 'postgresql://postgres:topsecretvalue@db.example.org:5432/postgres' }); } catch (e) { message = (e as Error).message; }
    expect(message).not.toContain('topsecretvalue');
    expect(message).not.toContain('db.example.org');
  });
  it('isLocalUrl is false for an empty string', () => { expect(isLocalUrl('')).toBe(false); });
});

describe('synthetic users', () => {
  const run = 'a1b2c3d4e5f6';
  it('addresses end in @example.test, carry the run id and differ every time', () => {
    const a = syntheticAddress(run, 'invited');
    const b = syntheticAddress(run, 'invited');
    expect(a).toMatch(/^e2e-a1b2c3d4e5f6-invited-[0-9a-f]{8}@example\.test$/);
    expect(a).not.toBe(b);
  });
  it('every address of a run matches the sweep pattern', () => {
    expect(runPattern(run)).toBe('e2e-a1b2c3d4e5f6-%@example.test');
    const mine = belongsToRun(run);
    expect(mine(syntheticAddress(run, 'second'))).toBe(true);
    expect(mine(syntheticAddress('0123456789ab', 'second'))).toBe(false);
    expect(mine(`e2e-${run}-x@example.org`)).toBe(false);
  });
  it('refuses a run id or label that could widen the sweep or inject SQL', () => {
    expect(() => syntheticAddress('%', 'x')).toThrow();
    expect(() => syntheticAddress(run, "x'; drop")).toThrow();
  });
  it('passwords are generated, long and different every time', () => {
    const p = syntheticPassword();
    expect(p.length).toBeGreaterThanOrEqual(20);
    expect(syntheticPassword()).not.toBe(p);
  });
});
