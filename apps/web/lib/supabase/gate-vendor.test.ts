import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { decideRoute, stateFromFacts, type Facts, type GateState } from './gate';
import { loadGateState } from './gate-state';

// WO-0103 (LLD 9.1 steps 6 and 7): the vendor states, state by state. The existing gate tables are untouched; these add to them.
const allow = { action: 'allow' } as const;
const to = (path: string) => ({ action: 'redirect', to: path }) as const;
const VENDOR: Facts = { emailConfirmed: true, role: 'vendor', eligible: false, ageConfirmed: true, termsCurrent: true, privacyCurrent: true, noticeCurrent: true, country: null, vendor: { member: true, agreed: true } };

describe('stateFromFacts: vendors', () => {
  it.each<[string, Partial<Facts>, GateState]>([
    ['a vendor with the current agreement', {}, 'vendor'],
    ['a vendor without it is held at the agreement', { vendor: { member: true, agreed: false } }, 'needs_vendor_agreement'],
    ['a vendor with no membership is not available', { vendor: { member: false, agreed: true } }, 'not_available'],
    ['a vendor whose facts are missing is not available', { vendor: undefined }, 'not_available'],
    ['an unconfirmed email comes first', { emailConfirmed: false }, 'needs_email_confirmation'],
    ['being eligible changes nothing for a vendor', { eligible: true, vendor: { member: true, agreed: false } }, 'needs_vendor_agreement'],
    ['an unknown role stays at not-available even with vendor facts', { role: 'auditor' }, 'not_available'],
  ])('%s', (_n, change, expected) => { expect(stateFromFacts({ ...VENDOR, ...change })).toBe(expected); });
});

describe('decideRoute: the vendor area', () => {
  it.each<[GateState, string, ReturnType<typeof to> | typeof allow]>([
    ['needs_vendor_agreement', '/vendor/agreement', allow], ['needs_vendor_agreement', '/vendor', to('/vendor/agreement')], ['needs_vendor_agreement', '/vendor/account', to('/vendor/agreement')],
    ['needs_vendor_agreement', '/vendor/reports/abc', to('/vendor/agreement')], ['needs_vendor_agreement', '/', to('/vendor/agreement')], ['needs_vendor_agreement', '/outfits', to('/vendor/agreement')],
    ['needs_vendor_agreement', '/leave', to('/vendor/agreement')], ['needs_vendor_agreement', '/api/account/export', to('/vendor/agreement')], ['needs_vendor_agreement', '/vendor/agreement/x', to('/vendor/agreement')],
    ['needs_vendor_agreement', '/auth/sign-out', allow], ['needs_vendor_agreement', '/privacy', allow], ['needs_vendor_agreement', '/about', allow],
    ['vendor', '/vendor', allow], ['vendor', '/vendor/gaps', allow], ['vendor', '/vendor/reports/abc', allow], ['vendor', '/vendor/account', allow], ['vendor', '/vendor/agreement', to('/vendor')],
    ['vendor', '/', to('/vendor')], ['vendor', '/outfits', to('/vendor')], ['vendor', '/sign-in', to('/vendor')], ['vendor', '/admin/catalog', to('/vendor')], ['vendor', '/vendorx', to('/vendor')],
    ['vendor', '/vendor/../outfits', to('/vendor')], ['vendor', '/auth/sign-out', allow], ['vendor', '/terms', allow], ['vendor', '/api/admin/sources', allow],
    ['ready', '/vendor', to('/')], ['ready', '/vendor/gaps', to('/')], ['ready', '/vendor/agreement', to('/')], ['ready', '/vendorx', allow],
    ['unauthenticated', '/vendor', to('/sign-in?next=%2Fvendor')], ['unauthenticated', '/vendor/agreement', to('/sign-in?next=%2Fvendor%2Fagreement')],
    ['admin', '/vendor', to('/admin/catalog')], ['not_available', '/vendor', to('/not-available')], ['needs_documents', '/vendor/account', to('/accept-terms')],
    ['needs_email_confirmation', '/vendor', to('/check-your-email')],
  ])('%s on %s', (state, path, expected) => { expect(decideRoute(state, path)).toEqual(expected); });
});

const ok = (data: unknown) => Promise.resolve({ data, error: null });
/** A client whose tables and settings answer from the given rows, by table name. */
function fake(tables: Record<string, unknown>, current: unknown = '1'): SupabaseClient {
  const query = (name: string) => ({ select: () => ({ maybeSingle: () => ok(tables[name]), then: (f: (v: unknown) => unknown) => ok(tables[name]).then(f) }) });
  return { auth: { getUser: () => ok({ user: { email_confirmed_at: '2026-11-05T00:00:00Z' } }) }, schema: () => ({ from: query, rpc: (n: string) => ok(n === 'has_consent' ? false : current) }) } as unknown as SupabaseClient;
}
const profile = { role: 'vendor', age_confirmed: false, country: null };
describe('loadGateState: a vendor', () => {
  it.each([
    ['holds one membership and accepted the current version', [{ vendor_id: 'v' }], [{ version: '1' }], 'vendor'],
    ['accepted only an older version', [{ vendor_id: 'v' }], [{ version: '0' }], 'needs_vendor_agreement'],
    ['accepted nothing', [{ vendor_id: 'v' }], [], 'needs_vendor_agreement'],
    ['has no membership', [], [{ version: '1' }], 'not_available'],
    ['has two memberships (the vendor functions refuse that)', [{ vendor_id: 'v' }, { vendor_id: 'w' }], [{ version: '1' }], 'not_available'],
  ])('who %s is %s', async (_n, members, accepted, expected) => {
    expect(await loadGateState(fake({ profiles: profile, vendor_members: members, vendor_agreement_acceptances: accepted }))).toBe(expected);
  });
  it('is held at the agreement when the current version cannot be read (nothing is guessed in the vendor\'s favour)', async () => {
    expect(await loadGateState(fake({ profiles: profile, vendor_members: [{ vendor_id: 'v' }], vendor_agreement_acceptances: [{ version: '1' }] }, null))).toBe('needs_vendor_agreement');
  });
});
