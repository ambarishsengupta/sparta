import { describe, expect, it, vi } from 'vitest';
import { acceptDocuments, acceptPilotNotice, completeOnboarding, readSupportedCountries, readVersions } from './consent-actions';

type Reply = { data?: unknown; error?: { message: string; code?: string } | null };
/** A client whose `rpc` answers from `rpcs` by name and whose `consent_records.insert` answers `insert`; every call is recorded. */
function fake(opts: { rpcs?: Record<string, Reply | Error>; insert?: Reply | Error; user?: { id: string } | null } = {}) {
  const rpc = vi.fn(async (name: string, args?: object) => { const r = opts.rpcs?.[name]; if (r instanceof Error) throw r; return { data: r?.data ?? null, error: r?.error ?? null, args }; });
  const insert = vi.fn(async (row: object) => { const r = opts.insert; if (r instanceof Error) throw r; return { error: r?.error ?? null, row }; });
  const from = vi.fn(() => ({ insert }));
  const client = { auth: { getUser: async () => ({ data: { user: opts.user === undefined ? { id: 'u-1' } : opts.user } }) }, schema: vi.fn(() => ({ rpc, from })) };
  return { client: client as never, rpc, insert, from, schema: client.schema };
}
const GENERIC = 'Something went wrong. Please try again in a moment.';
const VERSIONS = { public_setting: { data: '7' } };

describe('readVersions: versions come from app.public_setting, not from constants', () => {
  it('asks the app schema for the three keys', async () => {
    const f = fake({ rpcs: VERSIONS });
    expect(await readVersions(f.client)).toEqual({ terms: '7', privacy: '7', notice: '7' });
    expect(f.schema).toHaveBeenCalledWith('app');
    expect(f.rpc.mock.calls.map((c) => (c[1] as { p_key: string }).p_key).sort()).toEqual(['current_notice_version', 'current_privacy_version', 'current_terms_version']);
  });
  it.each([
    ['an error', { public_setting: { error: { message: 'x' } } }], ['a null version', { public_setting: { data: null } }],
    ['an empty version', { public_setting: { data: '' } }], ['a number', { public_setting: { data: 7 } }], ['a thrown failure', { public_setting: new Error('network') }],
  ])('gives null for %s, so the page shows an error instead of a form', async (_n, rpcs) => { expect(await readVersions(fake({ rpcs: rpcs as never }).client)).toBeNull(); });
});

describe('readSupportedCountries', () => {
  it('returns the codes', async () => { expect(await readSupportedCountries(fake({ rpcs: { supported_countries: { data: ['IN', 'AU'] } } }).client)).toEqual(['IN', 'AU']); });
  it.each([['an error', { error: { message: 'x' } }], ['not an array', { data: 'IN' }], ['a thrown failure', new Error('down')]])('gives an empty list for %s', async (_n, reply) => {
    expect(await readSupportedCountries(fake({ rpcs: { supported_countries: reply } }).client)).toEqual([]);
  });
  it('drops anything that is not a string', async () => { expect(await readSupportedCountries(fake({ rpcs: { supported_countries: { data: ['IN', 5, null] } } }).client)).toEqual(['IN']); });
});

describe('acceptDocuments (FR-2, FR-68)', () => {
  it('sends the versions that were shown, and the age answer', async () => {
    const f = fake({ rpcs: { accept_documents: {} } });
    expect(await acceptDocuments(f.client, { terms: '3', privacy: '4' }, true)).toEqual({ ok: true });
    expect(f.rpc).toHaveBeenCalledWith('accept_documents', { p_terms_version: '3', p_privacy_version: '4', p_age_confirmed: true });
  });
  it('sends the age answer as it is: false stays false', async () => {
    const f = fake({ rpcs: { accept_documents: { error: { message: 'age_not_confirmed' } } } });
    await acceptDocuments(f.client, { terms: '3', privacy: '4' }, false);
    expect(f.rpc).toHaveBeenCalledWith('accept_documents', { p_terms_version: '3', p_privacy_version: '4', p_age_confirmed: false });
  });
  it('a version that is no longer current asks for a reload', async () => {
    const out = await acceptDocuments(fake({ rpcs: { accept_documents: { error: { message: 'stale_version' } } } }).client, { terms: '1', privacy: '1' }, true);
    expect(out).toEqual({ ok: false, message: expect.stringMatching(/Reload the page/) });
  });
  it('the age refusal is explained', async () => {
    const out = await acceptDocuments(fake({ rpcs: { accept_documents: { error: { message: 'age_not_confirmed' } } } }).client, { terms: '1', privacy: '1' }, false);
    expect(out).toEqual({ ok: false, message: 'Confirm that you are 18 or over to continue.' });
  });
  it('shows no other server text', async () => {
    for (const reply of [{ error: { message: 'relation "app.profiles" does not exist' } }, new Error('connect ECONNREFUSED 10.0.0.1:5432')]) {
      expect(await acceptDocuments(fake({ rpcs: { accept_documents: reply } }).client, { terms: '1', privacy: '1' }, true)).toEqual({ ok: false, message: GENERIC });
    }
  });
});

describe('acceptPilotNotice (FR-3 to FR-5)', () => {
  it('inserts the consent record for the signed-in user and the version that was shown', async () => {
    const f = fake();
    expect(await acceptPilotNotice(f.client, '5')).toEqual({ ok: true });
    expect(f.from).toHaveBeenCalledWith('consent_records');
    expect(f.insert).toHaveBeenCalledWith({ user_id: 'u-1', notice_version: '5' });
  });
  it('writes nothing and asks to sign in again when there is no user', async () => {
    const f = fake({ user: null });
    expect(await acceptPilotNotice(f.client, '5')).toEqual({ ok: false, message: expect.stringMatching(/Sign in again/) });
    expect(f.insert).not.toHaveBeenCalled();
  });
  it('a record that already exists (23505) is success: the version is accepted', async () => { expect((await acceptPilotNotice(fake({ insert: { error: { message: 'dup', code: '23505' } } }).client, '1')).ok).toBe(true); });
  it('a row-level-security refusal (a version that is no longer current) asks for a reload', async () => {
    expect(await acceptPilotNotice(fake({ insert: { error: { message: 'new row violates row-level security policy', code: '42501' } } }).client, '1')).toEqual({ ok: false, message: expect.stringMatching(/Reload the page/) });
  });
  it.each([[{ error: { message: 'boom', code: '500' } }], [new Error('offline')]])('any other failure is the generic line: %#', async (insert) => {
    expect(await acceptPilotNotice(fake({ insert }).client, '1')).toEqual({ ok: false, message: GENERIC });
  });
});

describe('completeOnboarding (FR-6, FR-9)', () => {
  const answers = { country: 'IN', hemisphere: 'north', currency: 'INR', occasions: ['Work'] };
  it('sends the answers and returns ok', async () => {
    const f = fake({ rpcs: { complete_onboarding: { data: 'ok' } } });
    expect(await completeOnboarding(f.client, answers)).toEqual({ ok: true, result: 'ok' });
    expect(f.rpc).toHaveBeenCalledWith('complete_onboarding', { p_country: 'IN', p_hemisphere: 'north', p_currency: 'INR', p_occasions: ['Work'] });
  });
  it('an unsupported country is a result, not an error', async () => { expect(await completeOnboarding(fake({ rpcs: { complete_onboarding: { data: 'unsupported_country' } } }).client, answers)).toEqual({ ok: true, result: 'unsupported_country' }); });
  it.each([[{ data: 'something else' }], [{ error: { message: 'invalid_country' } }], [new Error('offline')]])('anything else is the generic line: %#', async (reply) => {
    expect(await completeOnboarding(fake({ rpcs: { complete_onboarding: reply } }).client, answers)).toEqual({ ok: false, message: GENERIC });
  });
});
