import { AuthApiError, AuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadGateState } from './gate-state';

const ok = (data: unknown) => Promise.resolve({ data, error: null });
/** A client whose auth answers `getUser` and whose queries answer from `tables` / `rpcs`. */
function fake(getUser: () => Promise<unknown>, tables: Record<string, unknown> = {}, rpcs: Record<string, unknown> = {}): SupabaseClient {
  const query = (name: string) => ({ select: () => ({ maybeSingle: () => ok(tables[name]), then: (f: (v: unknown) => unknown) => ok(tables[name]).then(f) }) });
  return { auth: { getUser }, schema: () => ({ from: query, rpc: (name: string) => ok(rpcs[name]) }) } as unknown as SupabaseClient;
}
const user = (confirmed = true) => () => ok({ user: { email_confirmed_at: confirmed ? '2026-11-05T00:00:00Z' : null } });

describe('loadGateState', () => {
  it('no session is unauthenticated', async () => {
    expect(await loadGateState(fake(() => Promise.resolve({ data: { user: null }, error: new AuthApiError('no session', 400, 'session_not_found') })))).toBe('unauthenticated');
    expect(await loadGateState(fake(() => ok({ user: null })))).toBe('unauthenticated');
  });
  it('a service that cannot be reached throws, so the proxy refuses instead of guessing', async () => {
    await expect(loadGateState(fake(() => Promise.resolve({ data: { user: null }, error: new AuthRetryableFetchError('down', 0) })))).rejects.toThrow();
    await expect(loadGateState(fake(() => Promise.resolve({ data: { user: null }, error: new AuthApiError('boom', 503, 'unexpected_failure') })))).rejects.toThrow();
  });
  it('an unconfirmed email is held before any table is read', async () => {
    expect(await loadGateState(fake(user(false), { profiles: { role: 'consumer', age_confirmed: false, country: null } }, { has_consent: false }))).toBe('needs_email_confirmation');
  });
  it('an eligible consumer is ready from two calls', async () => {
    expect(await loadGateState(fake(user(), { profiles: { role: 'consumer', age_confirmed: true, country: 'IN' } }, { has_consent: true }))).toBe('ready');
  });
  it('a failed query throws', async () => {
    const client = { auth: { getUser: user() }, schema: () => ({ from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }), rpc: () => ok(true) }) } as unknown as SupabaseClient;
    await expect(loadGateState(client)).rejects.toThrow();
  });
});

// WO-0126: the client is now typed with the generated `Database`; these pin the cases where the database answers less than the types promise. None of them may open the gate.
describe('loadGateState stays closed on missing rows, nulls and errors', () => {
  it('no profile row at all is held (role none), never ready', async () => {
    expect(await loadGateState(fake(user(), { profiles: null }, { has_consent: false }))).toBe('not_available');
  });
  it('a profile whose columns are null is held, never ready', async () => {
    expect(await loadGateState(fake(user(), { profiles: { role: null, age_confirmed: null, country: null } }, { has_consent: true }))).not.toBe('ready');
  });
  it('a consent answer of null or false is not eligibility: a consumer with no accepted documents is not ready', async () => {
    for (const has_consent of [null, false, undefined]) {
      expect(await loadGateState(fake(user(), { profiles: { role: 'consumer', age_confirmed: true, country: 'IN' }, document_acceptances: [], consent_records: [] }, { has_consent }))).not.toBe('ready');
    }
  });
  it('a missing list of accepted documents (null) counts as none accepted', async () => {
    expect(await loadGateState(fake(user(), { profiles: { role: 'consumer', age_confirmed: true, country: 'IN' }, document_acceptances: null, consent_records: null }, { has_consent: false, public_setting: 'v1' }))).not.toBe('ready');
  });
  it('a failed consent call throws instead of guessing', async () => {
    const client = { auth: { getUser: user() }, schema: () => ({ from: () => ({ select: () => ({ maybeSingle: () => ok({ role: 'consumer', age_confirmed: true, country: 'IN' }) }) }), rpc: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) } as unknown as SupabaseClient;
    await expect(loadGateState(client)).rejects.toThrow();
  });
});
