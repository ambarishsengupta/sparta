import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decideRoute, type GateState } from './gate';

const STATES: GateState[] = ['unauthenticated', 'needs_email_confirmation', 'needs_documents', 'needs_pilot_notice', 'needs_onboarding', 'not_available', 'admin', 'ready'];
const PAGE_OF: Record<string, GateState> = { '/accept-terms': 'needs_documents', '/pilot-notice': 'needs_pilot_notice', '/onboarding': 'needs_onboarding', '/not-available': 'not_available' };
const file = (rel: string) => new URL(`../../${rel}`, import.meta.url);

describe('each gate step has a page, and a page appears exactly in its own state (WO-0051 wiring)', () => {
  it.each(Object.keys(PAGE_OF))('%s exists under app/(auth)', (path) => { expect(existsSync(file(`app/(auth)${path}/page.tsx`))).toBe(true); });
  it.each(['needs_documents', 'needs_pilot_notice', 'needs_onboarding', 'not_available'] as const)('the home of %s is a page that exists', (state) => {
    const d = decideRoute(state, '/');
    expect(d.action).toBe('redirect');
    expect(PAGE_OF[(d as { to: string }).to]).toBe(state);
  });
  const cases = Object.entries(PAGE_OF).flatMap(([path, own]) => STATES.map((s): [string, GateState, boolean] => [path, s, s === own]));
  it.each(cases)('%s in state %s is reachable: %s', (path, state, reachable) => {
    expect(decideRoute(state, path).action === 'allow').toBe(reachable);
  });
  it('the Privacy Policy and Terms pages the screens link to are reachable in every state', () => {
    for (const s of STATES) for (const p of ['/privacy', '/terms']) expect(decideRoute(s, p)).toEqual({ action: 'allow' });
  });
  it('the gate pages sit under the (auth) layout, which answers 404 unless the Supabase backend is on', () => {
    const layout = readFileSync(file('app/(auth)/layout.tsx'), 'utf8');
    expect(layout).toContain("dataBackend() !== 'supabase'");
    expect(layout).toContain('notFound()');
  });
});

describe('the consent screens reach the service only through the user session', () => {
  const sources = ['components/consent/AcceptTermsForm.tsx', 'components/consent/PilotNoticeForm.tsx', 'components/consent/OnboardingForm.tsx', 'lib/supabase/consent-actions.ts']
    .map((rel) => [rel, readFileSync(file(rel), 'utf8')] as const);
  it('none makes a request of its own, builds a client of its own or reads an environment variable', () => {
    for (const [rel, text] of sources) {
      expect(text, rel).not.toMatch(/\b(fetch|XMLHttpRequest|sendBeacon|createClient|createServerClient|createBrowserClient)\b|process\.env/);
    }
  });
  it('the three forms use the browser client and the consent-actions module, and move on only to the fixed path "/" (onboarding: the fixed page of the start choice, lib/onboarding.ts startPage, WO-0085)', () => {
    for (const [rel, text] of sources.slice(0, 3)) {
      expect(text, rel).toContain('createBrowserSupabase()');
      expect(text.match(/window\.location\.assign\(([^)]*)\)/g), rel).toEqual(rel.endsWith('OnboardingForm.tsx') ? ['window.location.assign(startPage(start.current)'] : ["window.location.assign('/')"]);
    }
  });
  it('each form sends exactly the versions its page gave it: no version value is written into any form or action', () => {
    expect(sources[0]![1]).toContain('acceptDocuments(createBrowserSupabase(), versions, age)');
    expect(sources[1]![1]).toContain('acceptPilotNotice(createBrowserSupabase(), noticeVersion)');
    for (const [rel, text] of sources) expect(text, rel).not.toMatch(/(terms|privacy|notice|version)\w*\s*[:=]\s*['"`]?\d/i);
  });
  it('the versions sent come from the page props, which the pages read through app.public_setting', () => {
    for (const p of ['accept-terms', 'pilot-notice']) expect(readFileSync(file(`app/(auth)/${p}/page.tsx`), 'utf8')).toContain('readVersions(');
    expect(sources[3]![1]).toContain("rpc('public_setting'");
  });
});
