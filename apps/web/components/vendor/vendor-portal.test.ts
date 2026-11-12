/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { a11yProblems, hasTag } from '../../test-support/a11y';
import { importersOf } from '../../test-support/imports';
import { Nav } from '../Nav';
import { VENDOR_AGREEMENT_FILE, readVendorAgreement } from '../legal/files';
import { EventLog } from '../../lib/events';
import { CONTACT_NOT_SET } from '../../lib/pilot-config';
import { AgreementForm } from './AgreementForm';
import Account from '../../app/vendor/account/page';
import Agreement from '../../app/vendor/agreement/page';
import VendorLayout from '../../app/vendor/layout';

// WO-0103: the vendor shell, the agreement page and the account page, as rendered markup (no browser; the screenshots are the browser evidence).
const path = vi.hoisted(() => ({ now: '/vendor' }));
const session = vi.hoisted(() => ({ email: 'ada@example.test' as string | null }));
vi.mock('next/navigation', () => ({ usePathname: () => path.now }));
vi.mock('../../lib/supabase/server', () => ({
  createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: session.email ? { email: session.email } : null } }) },
    schema: () => ({ from: () => ({ select: async () => ({ data: [{ vendor_id: 'v1' }], error: null }) }) }) }),
}));
const html = (el: ReactElement) => renderToStaticMarkup(el);
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('the vendor shell', () => {
  it.each([['/vendor', 'Dashboard'], ['/vendor/gaps', 'Gaps'], ['/vendor/reports', 'Reports'], ['/vendor/reports/abc', 'Reports'], ['/vendor/account', 'Account']])('on %s only %s is current', (at, on) => {
    path.now = at;
    const markup = html(createElement(Nav, { signedIn: true }));
    expect(markup.match(/aria-current/g)).toHaveLength(1);
    expect(markup).toMatch(new RegExp(`<a[^>]*aria-current="page"[^>]*>${on}</a>`));
  });
  it('has Dashboard, Gaps, Reports, Account and Sign out, the Demo label, and neither a Feed link nor a consumer link', () => {
    path.now = '/vendor';
    const markup = html(createElement(Nav, { signedIn: true }));
    expect([...markup.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((m) => m[1])).toEqual(['Sparta', 'Dashboard', 'Gaps', 'Reports', 'Account']);
    expect(markup).toContain('<span class="demo-tag">Demo</span>');
    expect(markup).toMatch(/<button[^>]*>Sign out<\/button>/);
    expect(markup).not.toMatch(/Feed|Wardrobe|Outfits|Wishlist|Purchases|Settings/);
    expect(a11yProblems(markup)).toEqual([]);
  });
  it('shows only the label and Sign out on the agreement page, and the consumer links elsewhere', () => {
    path.now = '/vendor/agreement';
    const held = html(createElement(Nav, { signedIn: true }));
    expect(held).not.toContain('<nav');
    expect(held).toContain('demo-tag');
    expect(held).toContain('Sign out');
    path.now = '/outfits';
    expect(html(createElement(Nav, { signedIn: true }))).toMatch(/Wardrobe[\s\S]*Settings/);
  });
  it('with the local backend the layout says the portal needs the account service and renders none of its pages', () => {
    const boom = () => { throw new Error('a vendor page was rendered'); };
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'local');
    const markup = html(VendorLayout({ children: createElement(boom) }) as ReactElement);
    expect(markup).toContain('The vendor portal needs the account service.');
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase');
    expect(VendorLayout({ children: 'inside' })).toBe('inside');
    vi.unstubAllEnvs();
  });
});

describe('/vendor/agreement', () => {
  const page = html(Agreement());
  it('shows legal/VENDOR-PILOT-AGREEMENT.md read-only: its title, its sections and the file name', () => {
    expect(page).toContain('Vendor Pilot Agreement');
    expect(page).toContain('1. Parties and purpose');
    expect(page).toContain(`legal/${VENDOR_AGREEMENT_FILE}`);
    expect(readVendorAgreement()).toBe(readFileSync(new URL('../../../../legal/VENDOR-PILOT-AGREEMENT.md', import.meta.url), 'utf8'));
  });
  it('has one labelled tick box, an Accept button, one h1 and no accessibility problem', () => {
    expect(hasTag(page, 'input', 'type="checkbox"', 'id="accept-vendor-agreement"')).toBe(true);
    expect(page).toMatch(/<label[^>]*for="accept-vendor-agreement"[^>]*>[^]*accept it for my organisation/);
    expect(page).toMatch(/<button[^>]*type="submit"[^>]*>Accept<\/button>/);
    expect(a11yProblems(page)).toEqual([]);
  });
  it('asks for the tick before it calls anything, and moves on only to /vendor', () => {
    const source = read('./AgreementForm.tsx');
    expect(source.indexOf('if (!agree) return')).toBeGreaterThan(0);
    expect(source.indexOf('if (!agree) return')).toBeLessThan(source.indexOf('acceptVendorAgreement(createBrowserSupabase())'));
    expect(source).toContain("window.location.assign('/vendor')");
    expect(source).toContain('Tick the box to accept the agreement.');
    expect(html(createElement(AgreementForm))).not.toContain('role="alert"');
  });
});

describe('/vendor/account (FR-95)', () => {
  it('shows the signed-in email, the vendor name line and the contact address', async () => {
    vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', 'privacy@example.test');
    const markup = html(await Account());
    expect(markup).toContain('ada@example.test');
    expect(markup).toContain('The vendor name is not shown in this build.');   // catalog.vendors has no client grant yet (see the notes)
    expect(markup).toContain('<a href="mailto:privacy@example.test">privacy@example.test</a>');
    expect(markup).not.toContain(CONTACT_NOT_SET);
    expect(a11yProblems(markup)).toEqual([]);
    vi.unstubAllEnvs();
  });
  it('says the contact address is not set, in the words of the About page, when the build has none or a bad one', async () => {
    for (const value of ['', 'not an email']) {
      vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', value);
      const markup = html(await Account());
      expect(markup).toContain(CONTACT_NOT_SET);
      expect(markup).not.toContain('mailto:');
    }
    expect(read('../../app/about/page.tsx')).toContain(CONTACT_NOT_SET);
    vi.unstubAllEnvs();
  });
  it('says so when no one is signed in', async () => { session.email = null; expect(html(await Account())).toContain('Not signed in.'); session.email = 'ada@example.test'; });
});

describe('the vendor sources', () => {
  const root = new URL('../..', import.meta.url).pathname;
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []; });
  const vendor = Object.fromEntries(['app/vendor', 'components/vendor', 'lib/vendor'].flatMap((d) => files(join(root, d))).map((f) => [f.slice(root.length), readFileSync(f, 'utf8')]));
  it('scans the pages, the components and the lib files of the vendor portal', () => { expect(Object.keys(vendor).length).toBeGreaterThanOrEqual(8); });
  it('no file under app/vendor or components/vendor imports lib/server/admin.ts, and none imports anything from lib/server', () => {
    expect(importersOf(vendor, /(^|\/)admin$/)).toEqual([]);
    expect(importersOf(vendor, /(^|\/)server\/[a-z-]+$/)).toEqual([]);
    expect(Object.keys(vendor).filter((f) => !f.startsWith('lib/') && !f.endsWith('.test.ts')).some((f) => /createClient|createServerClient|createBrowserClient|process\.env/.test(vendor[f]!))).toBe(false);
  });
  it('the shipped agreement version is the one the database seeds', () => {
    expect(read('../../lib/vendor/access.ts')).toContain("VENDOR_AGREEMENT_VERSION = '1'");
    expect(readFileSync(new URL('../../../../supabase/migrations/20261105102304_ops_settings_and_invitations.sql', import.meta.url), 'utf8')).toContain("('current_vendor_agreement_version', '1')");
  });
});

describe('the two vendor events', () => {
  it('are accepted by the event log and carry no property but their type, the time and the engine configuration', () => {
    const log = new EventLog(null, () => 'T', () => 'cfg');
    for (const type of ['vendor_dashboard_viewed', 'vendor_report_opened'] as const) log.record(type);
    expect(log.list()).toEqual(['vendor_dashboard_viewed', 'vendor_report_opened'].map((type) => ({ type, at: 'T', occasion: null, season: null, engine_config: 'cfg', rule_ids: [], slot: null, origin: null })));
    expect(read('../../lib/events.ts')).not.toContain('feed_uploaded');
  });
});
