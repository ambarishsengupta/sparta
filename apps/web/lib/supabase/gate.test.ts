import { describe, expect, it } from 'vitest';
import { safeNextPath } from '../auth-form';
import { decideRoute, needsNoSession, normalisePath, stateFromFacts, type Facts, type GateState } from './gate';

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
  // 6. WO-0088: the admin page belongs to the admin state; the admin routes answer 401 or 403 themselves, so no state redirects them
  ['admin', '/', to('/admin/catalog')],
  ['admin', '/admin/catalog', allow],
  ['admin', '/outfits', to('/admin/catalog')],
  ['admin', '/sign-in', to('/admin/catalog')],
  ['admin', '/auth/sign-out', allow],
  ['admin', '/api/admin/sources', allow],
  ['ready', '/admin/catalog', to('/')],
  ['not_available', '/admin/catalog', to('/not-available')],
  ['needs_onboarding', '/admin/catalog', to('/onboarding')],
  ['unauthenticated', '/admin/catalog', to('/sign-in?next=%2Fadmin%2Fcatalog')],
  ['unauthenticated', '/api/admin/sources', allow],
  ['unauthenticated', '/api/admin/sources/3/takedown', allow],
  ['needs_email_confirmation', '/api/admin/catalog/review', allow],
  ['ready', '/api/admin/catalog/review', allow],
  ['not_available', '/api/admin/sources', allow],
  ['unauthenticated', '/api/adminx', to('/sign-in?next=%2Fapi%2Fadminx')],
  ['unauthenticated', '/api/admin/../account/export', to('/sign-in?next=%2Fapi%2Faccount%2Fexport')],   // dot segments are resolved first: the admin prefix is not a way round the gate
  ['admin', '/admin/catalogx', to('/admin/catalog')],
];

describe('decideRoute (LLD 9.1)', () => {
  it.each(CASES)('%s on %s', (state, path, expected) => { expect(decideRoute(state, path)).toEqual(expected); });
  it('has at least 20 cases and covers every state', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CASES.map((c) => c[0])).size).toBe(8);
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
    ['an admin with a confirmed email is in the admin state', { role: 'admin', eligible: false, country: null }, 'admin'],
    ['an admin with an unconfirmed email still confirms first', { role: 'admin', emailConfirmed: false }, 'needs_email_confirmation'],
    ['no profile row is held', { role: 'none' }, 'not_available'],
  ])('%s', (_name, change, expected) => { expect(stateFromFacts({ ...FULL, ...change })).toBe(expected); });
});

describe('decideRoute: the query string travels in next, encoded as one parameter (m4)', () => {
  const next = (d: ReturnType<typeof decideRoute>) => (d.action === 'redirect' ? new URL(d.to, 'http://app.example').searchParams.get('next') : null);
  it.each([
    ['/outfits?anchor=item-1', '/sign-in?next=%2Foutfits%3Fanchor%3Ditem-1'],
    ['/items/new?x=1&y=2', '/sign-in?next=%2Fitems%2Fnew%3Fx%3D1%26y%3D2'],
    ['/outfits?next=%2F%2Fevil.com', '/sign-in?next=%2Foutfits%3Fnext%3D%252F%252Fevil.com'],
    ['/outfits?q=a%20b#frag', '/sign-in?next=%2Foutfits%3Fq%3Da%2520b'],
    ['/outfits?', '/sign-in?next=%2Foutfits'],
  ])('unauthenticated %s goes to %s', (path, to) => { expect(decideRoute('unauthenticated', path)).toEqual({ action: 'redirect', to }); });
  it('the sign-in page receives exactly the path that was asked for, and safeNextPath keeps it', () => {
    for (const path of ['/outfits?anchor=item-1', '/items/abc-123?tab=photos&x=%2F', '/outfits']) expect(safeNextPath(next(decideRoute('unauthenticated', path)))).toBe(path);
  });
  it('the home page and the account pages carry no next, and a query on a gate step is dropped (the step has one home)', () => {
    expect(decideRoute('unauthenticated', '/?x=1')).toEqual({ action: 'redirect', to: '/sign-in' });
    expect(decideRoute('unauthenticated', '/sign-in?next=%2Foutfits')).toEqual({ action: 'allow' });
    expect(decideRoute('needs_documents', '/outfits?anchor=item-1')).toEqual({ action: 'redirect', to: '/accept-terms' });
  });
});

describe('needsNoSession: what the proxy decides before it calls the session updater (m3)', () => {
  it.each([['GET', '/privacy', true], ['GET', '/terms', true], ['GET', '/privacy/', true], ['GET', '/terms?x=1', true], ['HEAD', '/privacy', true], ['POST', '/auth/sign-out', true], ['POST', '/auth/sign-out/', true],
    ['GET', '/auth/sign-out', false], ['PUT', '/auth/sign-out', false], ['GET', '/', false], ['GET', '/outfits', false], ['POST', '/outfits', false], ['GET', '/auth/callback', false],
    ['GET', '/sign-in', false], ['GET', '/accept-terms', false], ['GET', '/privacy/../outfits', false], ['GET', '/privacy%2f..%2foutfits', false], ['GET', '/privacy-x', false], ['GET', '//privacy', false]] as const)(
    '%s %s: %s', (method, path, expected) => { expect(needsNoSession(method, path)).toBe(expected); });
  it('everything it lets through is also allowed by decideRoute in every state', () => {
    for (const state of ['unauthenticated', 'needs_email_confirmation', 'needs_documents', 'needs_pilot_notice', 'needs_onboarding', 'not_available', 'admin', 'ready'] as const)
      for (const path of ['/privacy', '/terms', '/auth/sign-out']) expect(decideRoute(state, path)).toEqual({ action: 'allow' });
  });
});
