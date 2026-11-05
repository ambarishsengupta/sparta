import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, discover, lockStack, newClient, provisionUser, sql } from '../../test-support/stack';
import { validateAcceptance } from '../consent-form';
import { validateOnboarding } from '../onboarding';
import { signOut } from './auth-actions';
import { acceptDocuments, acceptPilotNotice, completeOnboarding, readSupportedCountries, readVersions } from './consent-actions';
import { decideRoute } from './gate';
import { loadGateState } from './gate-state';

// Integration suite against the REAL local stack (CC3: acceptance, consent, onboarding, unsupported country). Two invited users are
// signed up and confirmed through Mailpit; everything after that goes through the same functions the screens call, with the user's own
// session. The suite skips, with a message, when the stack is not running.
const stack = discover();
if (!stack) console.warn('SKIPPED consent.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');
const ITEM = { name: 'Test shirt', category: 'Tops', sub_type: 'Shirt', colour_r: 10, colour_g: 20, colour_b: 30, origin: 'manual' };
const SETTING = (key: string) => sql(`select value from ops.settings where key = :'k'`, { k: key });

vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });
describe.skipIf(!stack)('acceptance, pilot notice, onboarding and the unsupported country, against the real stack', () => {
  const run = randomUUID().slice(0, 8);
  const email = { ann: `it-${run}-ann@example.test`, bob: `it-${run}-bob@example.test` };
  const pw = randomBytes(12).toString('base64url');
  const mailIds: string[] = [];
  let ann: SupabaseClient; // supported country
  let bob: SupabaseClient; // unsupported country
  let annId = '';
  let bobId = '';
  const count = (table: string, user: string, extra = '') => Number(sql(`select count(*) from app.${table} where user_id = :'u' ${extra}`, { u: user }));

  let unlock: (() => void) | undefined;
  beforeAll(async () => {
    unlock = await lockStack();
    ann = await provisionUser(stack!, email.ann, pw, mailIds);
    bob = await provisionUser(stack!, email.bob, pw, mailIds);
    annId = (await ann.auth.getUser()).data.user!.id;
    bobId = (await bob.auth.getUser()).data.user!.id;
  });
  afterAll(async () => { try { await cleanup(stack!, Object.values(email), mailIds); } finally { unlock?.(); } });

  it('the versions and the supported countries come from the settings, not from constants', async () => {
    expect(await readVersions(ann)).toEqual({ terms: SETTING('current_terms_version'), privacy: SETTING('current_privacy_version'), notice: SETTING('current_notice_version') });
    expect(await readSupportedCountries(ann)).toEqual(SETTING('supported_countries').split(','));
    expect(await readSupportedCountries(newClient(stack!))).toEqual(SETTING('supported_countries').split(',')); // the sign-up page reads it signed out (FR-8)
  });

  it('a new user is held at accept-terms, and a pilot-notice or onboarding request is sent back there', async () => {
    const state = await loadGateState(ann);
    expect(state).toBe('needs_documents');
    expect(decideRoute(state, '/')).toEqual({ action: 'redirect', to: '/accept-terms' });
    for (const path of ['/pilot-notice', '/onboarding']) expect(decideRoute(state, path)).toEqual({ action: 'redirect', to: '/accept-terms' });
    expect((await ann.schema('app').from('items').select('id')).data ?? []).toEqual([]);
  });

  it('refuses the acceptance without the age tick, and for a version that is no longer current; nothing is stored', async () => {
    const v = (await readVersions(ann))!;
    expect(validateAcceptance(false, true).age).toBeDefined(); // the screen stops this before any call
    expect(await acceptDocuments(ann, v, false)).toEqual({ ok: false, message: 'Confirm that you are 18 or over to continue.' });
    expect(await acceptDocuments(ann, { terms: '0', privacy: v.privacy }, true)).toEqual({ ok: false, message: expect.stringMatching(/Reload the page/) });
    expect(await acceptDocuments(ann, { terms: v.terms, privacy: '0' }, true)).toEqual({ ok: false, message: expect.stringMatching(/Reload the page/) });
    expect(count('document_acceptances', annId)).toBe(0);
    expect(await loadGateState(ann)).toBe('needs_documents');
  });

  it('acceptDocuments stores both acceptances at the current versions and the age answer; the next step is the pilot notice', async () => {
    const v = (await readVersions(ann))!;
    expect(await acceptDocuments(ann, v, true)).toEqual({ ok: true });
    expect(sql(`select document || ':' || version from app.document_acceptances where user_id = :'u' order by document`, { u: annId })).toBe(`privacy_policy:${v.privacy}\nterms:${v.terms}`);
    expect(sql(`select age_confirmed from app.profiles where id = :'u'`, { u: annId })).toBe('t');
    const state = await loadGateState(ann);
    expect(state).toBe('needs_pilot_notice');
    expect(decideRoute(state, '/pilot-notice')).toEqual({ action: 'allow' });
    expect(decideRoute(state, '/accept-terms')).toEqual({ action: 'redirect', to: '/pilot-notice' });
  });

  it('the pilot notice cannot be skipped: a stale version is refused, and a record cannot be written for another user', async () => {
    expect(await acceptPilotNotice(ann, '0')).toEqual({ ok: false, message: expect.stringMatching(/Reload the page/) });
    expect(count('consent_records', annId)).toBe(0);
    const forged = await ann.schema('app').from('consent_records').insert({ user_id: bobId, notice_version: SETTING('current_notice_version') });
    expect(forged.error?.code).toBe('42501');
    expect(count('consent_records', bobId)).toBe(0);
    expect(await loadGateState(ann)).toBe('needs_pilot_notice');
  });

  it('accepting the notice stores the record with the current notice version once, however often it is sent; the next step is onboarding', async () => {
    const v = (await readVersions(ann))!;
    expect(await acceptPilotNotice(ann, v.notice)).toEqual({ ok: true });
    expect(await acceptPilotNotice(ann, v.notice)).toEqual({ ok: true });
    expect(sql(`select notice_version from app.consent_records where user_id = :'u'`, { u: annId })).toBe(v.notice);
    expect(count('consent_records', annId)).toBe(1);
    const state = await loadGateState(ann);
    expect(state).toBe('needs_onboarding');
    expect(decideRoute(state, '/onboarding')).toEqual({ action: 'allow' });
    expect((await ann.schema('app').from('items').select('id')).data ?? []).toEqual([]); // still no wardrobe access
  });

  it('onboarding: an invalid answer is refused and changes nothing; the right answers open the app', async () => {
    expect(validateOnboarding({ country: 'XYZ', hemisphere: 'north', currency: 'INR' }, 'other').country).toBeDefined(); // the screen stops this
    expect(await completeOnboarding(ann, { country: 'XYZ', hemisphere: 'north', currency: 'INR', occasions: [] })).toEqual({ ok: false, message: expect.stringMatching(/Something went wrong/) });
    expect(sql(`select country is null from app.profiles where id = :'u'`, { u: annId })).toBe('t');
    expect(await completeOnboarding(ann, { country: 'IN', hemisphere: 'north', currency: 'INR', occasions: ['Work', 'Casual'] })).toEqual({ ok: true, result: 'ok' });
    expect(sql(`select country || ',' || hemisphere || ',' || currency || ',' || array_to_string(occasions, '+') from app.profiles where id = :'u'`, { u: annId })).toBe('IN,north,INR,Work+Casual');
    const state = await loadGateState(ann);
    expect(state).toBe('ready');
    expect(decideRoute(state, '/outfits')).toEqual({ action: 'allow' });
    expect(decideRoute(state, '/onboarding')).toEqual({ action: 'redirect', to: '/' });
    expect((await ann.schema('app').from('items').select('id')).error).toBeNull();
    expect((await ann.schema('app').from('items').insert({ ...ITEM, user_id: annId })).error).toBeNull(); // the same row that is refused to the blocked user below
  });

  it('another user cannot see the first user\'s acceptance or consent rows', async () => {
    expect((await bob.schema('app').from('consent_records').select('user_id')).data ?? []).toEqual([]);
    expect((await bob.schema('app').from('document_acceptances').select('user_id')).data ?? []).toEqual([]);
    expect((await ann.schema('app').from('consent_records').select('user_id')).data).toEqual([{ user_id: annId }]);
  });

  it('a country that is not on the list gives the not-available state: nothing else is opened, and the declared country is kept', async () => {
    const v = (await readVersions(bob))!;
    expect(await acceptDocuments(bob, v, true)).toEqual({ ok: true });
    expect(await acceptPilotNotice(bob, v.notice)).toEqual({ ok: true });
    expect(await loadGateState(bob)).toBe('needs_onboarding');
    expect(await completeOnboarding(bob, { country: 'US', hemisphere: 'north', currency: 'USD', occasions: [] })).toEqual({ ok: true, result: 'unsupported_country' });
    expect(sql(`select country from app.profiles where id = :'u'`, { u: bobId })).toBe('US');
    const state = await loadGateState(bob);
    expect(state).toBe('not_available');
    for (const path of ['/', '/outfits', '/onboarding', '/accept-terms']) expect(decideRoute(state, path)).toEqual({ action: 'redirect', to: '/not-available' });
    expect(decideRoute(state, '/not-available')).toEqual({ action: 'allow' });
    expect((await bob.schema('app').from('items').select('id')).data ?? []).toEqual([]);
    expect((await bob.schema('app').from('items').insert({ ...ITEM, user_id: bobId })).error?.code).toBe('42501');
  });

  // WO-0053 m2: the versions are global settings, so these tests change one for about a second and put it back in a finally block. They run
  // while `ann` is ready. The other integration suites cannot overlap: every suite holds lockStack() from its first hook to its last.
  const bump = async (key: string, expected: string) => {
    const old = SETTING(key);
    try {
      sql(`update ops.settings set value = :'v' where key = :'k'`, { v: `${old}-next`, k: key });
      expect(await loadGateState(ann)).toBe(expected);
      const d = decideRoute(await loadGateState(ann), '/outfits');
      expect(d).toEqual({ action: 'redirect', to: expected === 'needs_documents' ? '/accept-terms' : '/pilot-notice' });
      expect((await ann.schema('app').rpc('has_consent')).data).toBe(false);
    } finally {
      sql(`update ops.settings set value = :'v' where key = :'k'`, { v: old, k: key });
    }
    expect(SETTING(key)).toBe(old);
    expect(await loadGateState(ann)).toBe('ready');
  };
  it('a new notice version sends a ready person back to the pilot notice, and restoring it lets them in again (m2)', async () => { await bump('current_notice_version', 'needs_pilot_notice'); });
  it('a new terms version sends a ready person back to accept-terms, and restoring it lets them in again (m2)', async () => { await bump('current_terms_version', 'needs_documents'); });
  it('a new privacy version also sends a ready person back to accept-terms (m2)', async () => { await bump('current_privacy_version', 'needs_documents'); });

  it('sign-out ends both sessions: unauthenticated, no rows', async () => {
    for (const c of [ann, bob]) {
      expect(await signOut(c)).toEqual({ ok: true });
      expect(await loadGateState(c)).toBe('unauthenticated');
      expect((await c.schema('app').from('consent_records').select('user_id')).data ?? []).toEqual([]);
    }
  });
});
