import { describe, expect, it } from 'vitest';
import { decideRoute, normalisePath, stateFromFacts, type Facts, type GateState } from './gate';

const allow = { action: 'allow' } as const;
const to = (path: string) => ({ action: 'redirect', to: path }) as const;
const CASES: [GateState, string, ReturnType<typeof to> | typeof allow][] = [
  // 1. no session: only the account pages and the public pages
  ['unauthenticated', '/', to('/sign-in')],
  ['unauthenticated', '/outfits', to('/sign-in?next=%2Foutfits')],
  ['unauthenticated', '/items/new', to('/sign-in?next=%2Fitems%2Fnew')],
  ['unauthenticated', '/sign-in', allow],
  ['unauthenticated', '/sign-up', allow],
  ['unauthenticated', '/reset', allow],
  ['unauthenticated', '/check-your-email', allow],
  ['unauthenticated', '/auth/callback', allow],
  ['unauthenticated', '/privacy', allow],
  ['unauthenticated', '/accept-terms', to('/sign-in?next=%2Faccept-terms')],
  ['unauthenticated', '/api/account/export', to('/sign-in?next=%2Fapi%2Faccount%2Fexport')],
  // 2. signed in, email not confirmed
  ['needs_email_confirmation', '/', to('/check-your-email')],
  ['needs_email_confirmation', '/check-your-email', allow],
  ['needs_email_confirmation', '/sign-in', to('/check-your-email')],
  ['needs_email_confirmation', '/api/account/delete', to('/check-your-email')],
  ['needs_email_confirmation', '/auth/sign-out', allow],
  // 3. one step at a time
  ['needs_documents', '/', to('/accept-terms')],
  ['needs_documents', '/accept-terms', allow],
  ['needs_documents', '/pilot-notice', to('/accept-terms')],
  ['needs_documents', '/onboarding', to('/accept-terms')],
  ['needs_pilot_notice', '/outfits', to('/pilot-notice')],
  ['needs_pilot_notice', '/pilot-notice', allow],
  ['needs_pilot_notice', '/accept-terms', to('/pilot-notice')],
  ['needs_onboarding', '/', to('/onboarding')],
  ['needs_onboarding', '/onboarding', allow],
  ['needs_onboarding', '/sign-up', to('/onboarding')],
  ['not_available', '/', to('/not-available')],
  ['not_available', '/not-available', allow],
  ['not_available', '/outfits', to('/not-available')],
  // 4. held users keep export, Leave the pilot, sign-out and the public pages (LLD 9.1)
  ['needs_pilot_notice', '/api/account/export', allow],
  ['not_available', '/api/exports/abc', allow],
  ['not_available', '/api/account/delete', allow],
  ['not_available', '/api/account/deleted-not', to('/not-available')],
  ['needs_documents', '/auth/sign-out', allow],
  ['needs_documents', '/about', allow],
  ['needs_documents', '/terms', allow],
  // 5. ready: the app, and no way back into the account or gate pages
  ['ready', '/', allow],
  ['ready', '/outfits', allow],
  ['ready', '/items/123', allow],
  ['ready', '/sign-in', to('/')],
  ['ready', '/accept-terms', to('/')],
  ['ready', '/not-available', to('/')],
  ['ready', '/auth/sign-out', allow],
];

describe('decideRoute (LLD 9.1)', () => {
  it.each(CASES)('%s on %s', (state, path, expected) => { expect(decideRoute(state, path)).toEqual(expected); });
  it('has at least 20 cases and covers every state', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CASES.map((c) => c[0])).size).toBe(7);
  });
});

describe('decideRoute: paths written to get round the rules', () => {
  it.each([
    ['/accept-terms/', 'needs_documents', allow],
    ['/accept-terms?x=1', 'needs_documents', allow],
    ['/%61ccept-terms', 'needs_documents', allow],
    ['/about/../outfits', 'needs_documents', to('/accept-terms')],
    ['/about/%2e%2e/outfits', 'needs_documents', to('/accept-terms')],
    ['//accept-terms', 'needs_documents', to('/accept-terms')],
    ['/sign-in/extra', 'unauthenticated', to('/sign-in?next=%2Fsign-in%2Fextra')],
    ['/about-us', 'unauthenticated', to('/sign-in?next=%2Fabout-us')],
    ['/api/account/exportx', 'not_available', to('/not-available')],
    ['/%E0%A4%A', 'unauthenticated', to('/sign-in?next=%2F__invalid__')],
    ['/sign-in\\..\\outfits', 'unauthenticated', to('/sign-in?next=%2Foutfits')],
  ] as const)('%s for %s', (path, state, expected) => { expect(decideRoute(state, path)).toEqual(expected); });
  it('normalisePath decodes once, drops one trailing slash and refuses odd paths', () => {
    expect(normalisePath('/a/b/')).toBe('/a/b');
    expect(normalisePath('/')).toBe('/');
    expect(normalisePath('/%2561')).toBe('/%61');
    expect(normalisePath('/a%2f..%2fb')).toBe('/__invalid__');
  });
});

const FULL: Facts = { emailConfirmed: true, role: 'consumer', eligible: false, ageConfirmed: true, termsCurrent: true, privacyCurrent: true, noticeCurrent: true, country: 'IN' };
describe('stateFromFacts: the first open step wins, in the order of LLD 9.1', () => {
  it.each<[string, Partial<Facts>, GateState]>([
    ['unconfirmed email beats everything', { emailConfirmed: false, eligible: true }, 'needs_email_confirmation'],
    ['eligible consumer is ready', { eligible: true }, 'ready'],
    ['age not confirmed', { ageConfirmed: false }, 'needs_documents'],
    ['terms out of date', { termsCurrent: false }, 'needs_documents'],
    ['privacy policy out of date', { privacyCurrent: false }, 'needs_documents'],
    ['documents come before the notice', { termsCurrent: false, noticeCurrent: false }, 'needs_documents'],
    ['notice out of date', { noticeCurrent: false }, 'needs_pilot_notice'],
    ['the notice comes before onboarding', { noticeCurrent: false, country: null }, 'needs_pilot_notice'],
    ['no country yet', { country: null }, 'needs_onboarding'],
    ['country given but not eligible (off the list)', {}, 'not_available'],
    ['a vendor is held, not let through', { role: 'vendor', eligible: true }, 'not_available'],
    ['no profile row is held', { role: 'none' }, 'not_available'],
  ])('%s', (_name, change, expected) => { expect(stateFromFacts({ ...FULL, ...change })).toBe(expected); });
});
