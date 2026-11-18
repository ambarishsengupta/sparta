/// <reference types="vite/client" />
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AcceptTerms from '../../app/(auth)/accept-terms/page';
import Onboarding from '../../app/(auth)/onboarding/page';
import PilotNotice from '../../app/(auth)/pilot-notice/page';
import { a11yProblems, hasTag } from '../../test-support/a11y';
import { decideRoute } from '../../lib/supabase/gate';
import { HeldOptions } from './HeldOptions';

// WO-0062 item 3 (F3, FR-4, FR-5): a person who declines the pilot notice, or whose accepted versions are out of date, still has Export my data, Leave the pilot and Sign out.
vi.mock('../../lib/supabase/server', () => ({ createServerSupabase: async () => ({}) }));
vi.mock('../../lib/supabase/consent-actions', async (original) => ({
  ...(await original<typeof import('../../lib/supabase/consent-actions')>()),
  readVersions: vi.fn(async () => ({ terms: '3', privacy: '4', notice: '5' })),
}));
const html = (el: ReactElement) => renderToStaticMarkup(el);
const page = async (p: unknown) => html(await (p as () => Promise<ReactElement>)());
const h1s = (m: string) => m.match(/<h1[ >]/g)?.length ?? 0;
const inOrder = (m: string, parts: string[]) => { const ix = parts.map((p) => m.indexOf(p)); return ix.every((n) => n > -1) && [...ix].sort((a, b) => a - b).join() === ix.join(); };

describe.each([
  ['the pilot notice', PilotNotice, 'No thanks, sign out', 'I understand and join the pilot'],
  ['the Terms and Privacy Policy page', AcceptTerms, 'Sign out', 'Continue'],
  ['the onboarding page (WO-0161)', Onboarding, 'Sign out', 'Start from popular items'],
] as const)('%s', (_name, Page, signOutLabel, primary) => {
  it('offers Export my data, Leave the pilot and Sign out, after the way forward, under one heading', async () => {
    const m = await page(Page);
    expect(m).toContain('Export my data');
    expect(hasTag(m, 'a', 'href="/leave"')).toBe(true);
    expect(m).toContain('>Leave the pilot</a>');
    expect(hasTag(m, 'form', 'action="/auth/sign-out"', 'method="post"')).toBe(true);
    expect(m).toContain(`>${signOutLabel}</button>`);
    expect(inOrder(m, [primary, '<h2 id="held-options">If you do not want to continue</h2>', 'Export my data', 'href="/leave"', 'action="/auth/sign-out"'])).toBe(true);
  });
  it('explains the three choices in plain words, including that leaving deletes the account', async () => {
    const m = await page(Page);
    expect(m).toContain('take your data with you');
    expect(m).toContain('leave the pilot (which deletes your account)');
    expect(m).toContain('shown again the next time you sign in');
  });
  it('is still one page with one h1, labelled controls and valid ids (the export help text and the section heading are referenced)', async () => {
    const m = await page(Page);
    expect(h1s(m)).toBe(1);
    expect(a11yProblems(m)).toEqual([]);
    expect(m).toContain('aria-labelledby="held-options"');
    expect(m).toContain('aria-describedby="export-help"');
  });
  it('the export button is the same one as everywhere else (a client call on the person\'s own session, no link and no form)', async () => {
    const m = await page(Page);
    expect(m).toMatch(/<button type="button"[^>]*aria-describedby="export-help">Export my data<\/button>/);
  });
});

describe('the gate lets these people reach what the pages offer', () => {
  it.each(['needs_documents', 'needs_pilot_notice'] as const)('at %s: /leave is open, the wardrobe is not, and the page itself is the home page of the step', (state) => {
    expect(decideRoute(state, '/leave')).toEqual({ action: 'allow' });
    expect(decideRoute(state, '/auth/sign-out')).toEqual({ action: 'allow' });
    expect(decideRoute(state, '/')).toEqual({ action: 'redirect', to: state === 'needs_documents' ? '/accept-terms' : '/pilot-notice' });
  });
});

describe('the gate at needs_onboarding (WO-0161)', () => {
  it('keeps /leave and the export routes open and sends /settings, where the banner links, to /onboarding, which offers Export', () => {
    expect(decideRoute('needs_onboarding', '/leave')).toEqual({ action: 'allow' });
    expect(decideRoute('needs_onboarding', '/api/account/export')).toEqual({ action: 'allow' });
    expect(decideRoute('needs_onboarding', '/settings')).toEqual({ action: 'redirect', to: '/onboarding' });
  });
});

describe('HeldOptions', () => {
  it('shows its introduction and takes the sign-out button text from the page', () => {
    const m = html(createElement(HeldOptions, { intro: 'Hello there.', signOutLabel: 'Go away' }));
    expect(m).toContain('<p class="muted">Hello there.</p>');
    expect(m).toContain('>Go away</button>');
    expect(html(createElement(HeldOptions, { intro: 'x' }))).toContain('>Sign out</button>');
  });
  it('each page uses it, and neither page still carries a raw sign-out form of its own', () => {
    for (const p of ['../../app/(auth)/pilot-notice/page.tsx', '../../app/(auth)/accept-terms/page.tsx', '../../app/(auth)/onboarding/page.tsx']) {
      const src = readFileSync(new URL(p, import.meta.url), 'utf8');
      expect(src).toContain('<HeldOptions');
      expect(src).not.toContain('/auth/sign-out');
    }
  });
});
