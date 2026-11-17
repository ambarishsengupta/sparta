import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decideRoute, needsNoSession, type GateState } from './gate';

// R2c: the routes of the account pages, state by state (LLD 9.1: a person held at a gate step keeps Export, Leave the pilot and Sign out).
const STATES: GateState[] = ['unauthenticated', 'needs_email_confirmation', 'needs_documents', 'needs_pilot_notice', 'needs_onboarding', 'not_available', 'ready'];
const HOME: Record<string, string> = { needs_email_confirmation: '/check-your-email', needs_documents: '/accept-terms', needs_pilot_notice: '/pilot-notice', needs_onboarding: '/onboarding', not_available: '/not-available', ready: '/' };
const HELD: GateState[] = ['needs_documents', 'needs_pilot_notice', 'needs_onboarding', 'not_available'];
const allow = { action: 'allow' } as const;
const to = (path: string) => ({ action: 'redirect', to: path }) as const;
const file = (rel: string) => new URL(`../../${rel}`, import.meta.url);

describe('/settings is for a person who is ready, and for no one else', () => {
  it.each(STATES)('in state %s', (state) => {
    expect(decideRoute(state, '/settings')).toEqual(state === 'ready' ? allow : state === 'unauthenticated' ? to('/sign-in?next=%2Fsettings') : to(HOME[state]!));
  });
});

describe('/leave (Leave the pilot, FR-4, FR-66) is open to everyone who has a confirmed email', () => {
  it.each(STATES)('in state %s', (state) => {
    const expected = state === 'ready' || HELD.includes(state) ? allow : state === 'unauthenticated' ? to('/sign-in?next=%2Fleave') : to(HOME[state]!);
    expect(decideRoute(state, '/leave')).toEqual(expected);
  });
  it.each(HELD)('a person held at %s can open it, with a trailing slash or an encoded letter', (state) => {
    for (const p of ['/leave/', '/%6Ceave', '/leave?x=1']) expect(decideRoute(state, p)).toEqual(allow);
  });
  it.each(HELD)('but not a path made to look like it (%s)', (state) => {
    for (const p of ['/leave/x', '/leave/../outfits', '/leavex', '//leave', '/leave%2f..%2foutfits', '/settings/leave', '/x/leave']) expect(decideRoute(state, p)).toEqual(to(HOME[state]!));
  });
  it('a person held at a gate step cannot open Settings, the wardrobe or the outfits through it', () => {
    for (const state of HELD) for (const p of ['/settings', '/', '/outfits', '/items/new']) expect(decideRoute(state, p)).toEqual(to(HOME[state]!));
  });
});

describe('the public pages are open in every state, and a ready person is not turned away from them', () => {
  it.each(['/about', '/privacy', '/terms', '/notice', '/goodbye'])('%s', (path) => {
    for (const state of STATES) expect(decideRoute(state, path)).toEqual(allow);
  });
  it('/goodbye and /about need no session check, so they work while the account service is down; /leave and /settings do', () => {
    for (const p of ['/goodbye', '/about', '/notice', '/privacy', '/terms']) expect(needsNoSession('GET', p)).toBe(true);
    for (const p of ['/leave', '/settings', '/goodbye/x', '/goodbye/../settings', '/aboutx']) expect(needsNoSession('GET', p)).toBe(false);
  });
});

describe('the pages exist where the gate sends people', () => {
  it.each(['app/(auth)/settings', 'app/(auth)/leave', 'app/(auth)/goodbye', 'app/about', 'app/notice', 'app/privacy', 'app/terms'])('%s/page.tsx', (dir) => {
    expect(existsSync(file(`${dir}/page.tsx`))).toBe(true);
  });
  it('the account pages that need an account sit under the (auth) layout, which answers 404 unless the Supabase backend is on; the public ones do not', () => {
    expect(readFileSync(file('app/(auth)/layout.tsx'), 'utf8')).toContain("dataBackend() !== 'supabase'");
    for (const dir of ['app/about', 'app/notice', 'app/privacy', 'app/terms']) expect(existsSync(file(`${dir}/page.tsx`))).toBe(true);
  });
  it('Leave the pilot is not a gate page: a ready person may open it (it is not in the list that sends a ready person home)', () => {
    expect(decideRoute('ready', '/leave')).toEqual(allow);
    expect(decideRoute('ready', '/not-available')).toEqual(to('/'));
  });
});
