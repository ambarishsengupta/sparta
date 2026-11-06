/// <reference types="vite/client" />
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotAvailable from '../../app/(auth)/not-available/page';
import Goodbye from '../../app/(auth)/goodbye/page';
import Leave from '../../app/(auth)/leave/page';
import Settings from '../../app/(auth)/settings/page';
import About from '../../app/about/page';
import RootLayout from '../../app/layout';
import Notice from '../../app/notice/page';
import Privacy from '../../app/privacy/page';
import Terms from '../../app/terms/page';
import { SHARING_LOCKED_TEXT } from '../../lib/consent-form';
import { a11yProblems, hasTag } from '../../test-support/a11y';
import { Nav } from '../Nav';
import { ExportButton } from './ExportButton';
import { LeaveForm } from './LeaveForm';
import { SettingsForm } from './SettingsForm';
import { downloadText } from './download';

const state = vi.hoisted(() => ({ profile: { display_name: 'Asha', country: 'IN', hemisphere: 'north', currency: 'INR', occasions: ['Work'] } as Record<string, unknown> | null, countries: ['IN', 'AU'] as string[], path: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path }));
vi.mock('../../lib/supabase/server', () => ({
  createServerSupabase: async () => ({ schema: () => ({ from: () => ({ select: () => ({ maybeSingle: async () => ({ data: state.profile, error: state.profile ? null : { message: 'x' } }) }) }) }) }),
}));
vi.mock('../../lib/supabase/consent-actions', async (original) => ({ ...(await original<typeof import('../../lib/supabase/consent-actions')>()), readSupportedCountries: async () => state.countries }));

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const html = (el: ReactElement) => renderToStaticMarkup(el);
const page = async (p: unknown) => html(await (p as () => Promise<ReactElement>)());
const h1s = (m: string) => m.match(/<h1[ >]/g)?.length ?? 0;
const at = (m: string, s: string) => m.indexOf(s);
const inOrder = (m: string, parts: string[]) => { const ix = parts.map((p) => at(m, p)); return ix.every((n) => n > -1) && [...ix].sort((a, b) => a - b).join() === ix.join(); };

beforeEach(() => { state.profile = { display_name: 'Asha', country: 'IN', hemisphere: 'north', currency: 'INR', occasions: ['Work'] }; state.countries = ['IN', 'AU']; state.path = '/'; });
afterEach(() => vi.unstubAllEnvs());

describe('the checker (R2c)', () => {
  it('flags an unlabelled input, a dangling description, an empty button or link, a jumped heading, a table without headers, a second h1, a repeated id and an unannounced error', () => {
    expect(a11yProblems('<input id="a"/>')).toHaveLength(1);
    expect(a11yProblems('<label for="a">A</label><input id="a" aria-describedby="gone"/>')).toHaveLength(1);
    expect(a11yProblems('<button></button>')).toHaveLength(1);
    expect(a11yProblems('<a href="/x"> </a>')).toHaveLength(1);
    expect(a11yProblems('<h1>a</h1><h3>b</h3>')).toHaveLength(1);
    expect(a11yProblems('<h1>a</h1><h1>b</h1>')).toHaveLength(1);
    expect(a11yProblems('<table><tr><td>x</td></tr></table>')).toHaveLength(1);
    expect(a11yProblems('<p id="a">x</p><p id="a">y</p>')).toHaveLength(1);
    expect(a11yProblems('<p class="error">x</p>')).toHaveLength(1);
    expect(a11yProblems('<label for="a">A</label><input id="a"/><label><input type="checkbox"/>B</label><button>Go</button><h1>t</h1><h2>u</h2>')).toEqual([]);
    expect(a11yProblems('<label><input type="checkbox"/></label>')).toContain('an empty label');
  });
});

describe('Settings (FR-61, FR-62, FR-66)', () => {
  it('has one h1, labelled controls, a logical heading order and the sections in this order: details, sharing, data, leave, account', async () => {
    const m = await page(Settings);
    expect(a11yProblems(m)).toEqual([]);
    expect(h1s(m)).toBe(1);
    expect(inOrder(m, ['<h1>Settings</h1>', 'id="set-name"', 'id="set-hemisphere"', 'id="set-currency"', '<legend>Occasions', 'type="submit"', '<h2>Sharing</h2>', 'id="sharing"', '<h2>Your data</h2>', 'Export my data', '<h2>Leave the pilot</h2>', 'href="/leave"', '<h2>Account</h2>', 'action="/auth/sign-out"'])).toBe(true);
  });
  it('shows the country by name and does not let it be edited', async () => {
    const m = await page(Settings);
    expect(m).toContain('<strong>India</strong>');
    expect(m).not.toMatch(/id="set-country"|name="country"/);
  });
  it('shows the profile values in the controls: name, hemisphere, currency and ticked occasions', async () => {
    const m = await page(Settings);
    expect(m).toContain('value="Asha"');
    expect(m).toMatch(/<option value="north" selected="">Northern<\/option>/);
    expect(m).toMatch(/<option value="INR" selected="">INR - Indian Rupee<\/option>/);
    expect(m.match(/type="checkbox"[^>]*checked=""/g)).toHaveLength(2); // the sharing box and Work
  });
  it('shows sharing locked on: a ticked, disabled box with a label, and the FR-61 wording one tap away', async () => {
    const m = await page(Settings);
    expect(hasTag(m, 'input', 'id="sharing"', 'type="checkbox"', 'checked=""', 'disabled=""')).toBe(true);
    expect(m).toContain('<summary>Why can&#x27;t I switch this off?</summary>');
    expect(m.replace(/&#x27;/g, "'")).toContain(SHARING_LOCKED_TEXT);
  });
  it('Leave the pilot is a link to the confirmation page, not a button that deletes; sign-out is a POST form', async () => {
    const m = await page(Settings);
    expect(hasTag(m, 'a', 'href="/leave"')).toBe(true);
    expect(m).toContain('>Leave the pilot</a>');
    expect(hasTag(m, 'form', 'action="/auth/sign-out"', 'method="post"')).toBe(true);
  });
  it('says so, as an announced error with no form, when the profile cannot be read', async () => {
    state.profile = null;
    const m = await page(Settings);
    expect(m).toContain('role="alert"');
    expect(m).not.toContain('<form');
  });
  it('the form announces its errors next to the field, marks the field invalid, focuses the first one, and has a live region for "saved"', () => {
    const src = read('./SettingsForm.tsx');
    for (const p of src.match(/<p [^>]*className="error"[^>]*>/g) ?? []) expect(p).toContain('role="alert"');
    expect(src.match(/className="error"/g)!.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("'aria-invalid'");
    expect(src).toContain('first.current?.focus()');
    expect(src).toMatch(/<p role="status">\{saved \?/);
  });
  it('the settings form alone: every control has a name, and the occasions are the seven of the taxonomy', () => {
    const m = html(createElement(SettingsForm, { initial: { displayName: '', hemisphere: '', currency: 'USD', occasions: [] }, currencies: [{ value: 'USD', label: 'USD - US Dollar' }] }));
    expect(a11yProblems(m)).toEqual([]);
    expect(m.match(/type="checkbox"/g)).toHaveLength(7);
    expect(m).toMatch(/<option value=""[^>]*>Choose<\/option>/); // a missing hemisphere is a visible choice, not a silent default
  });
});

describe('Leave the pilot (FR-63, FR-66)', () => {
  it('explains what is deleted, offers an export first, and asks for the password in a labelled password field', async () => {
    const m = await page(Leave);
    expect(a11yProblems(m)).toEqual([]);
    expect(h1s(m)).toBe(1);
    expect(m).toContain('deletes your Sparta account and everything in it');
    expect(m).toContain('7 days');
    expect(m).toContain('30 days');
    expect(inOrder(m, ['<h1>Leave the pilot</h1>', 'Want a copy first?', 'Export my data', 'Confirm that it is you', 'id="leave-pw"', 'type="submit"', 'Cancel, keep my account'])).toBe(true);
    expect(hasTag(m, 'input', 'id="leave-pw"', 'type="password"', 'autoComplete="current-password"')).toBe(true);
  });
  it('the destructive button is the last action and is marked as dangerous; cancel is a link home', async () => {
    const m = await page(Leave);
    expect(hasTag(m, 'button', 'type="submit"', 'class="danger"')).toBe(true);
    expect(m).toContain('Delete my account and leave the pilot');
    expect(m).toMatch(/<a[^>]*href="\/"[^>]*>Cancel, keep my account<\/a>/);
  });
  it('the form code: the password is asked again through leaveThePilot, the error is announced and linked to the field, cookies are swept, then only /goodbye is opened', () => {
    const src = read('./LeaveForm.tsx');
    expect(src).toContain('leaveThePilot(createBrowserSupabase(), pw, () => purgeMyStorage())');   // WO-0071: the files are removed first, through the server
    expect(src).toContain('role="alert"');
    expect(src).toContain("aria-describedby={failure ? 'leave-error' : undefined}");
    expect(src).toContain('pwRef.current?.focus()');
    expect(src.match(/window\.location\.assign\(([^)]*)\)/g)).toEqual(["window.location.assign('/goodbye')"]);
    expect(src.indexOf('sessionCookieNames(document.cookie)')).toBeLessThan(src.indexOf("window.location.assign('/goodbye')"));
    expect(src).not.toMatch(/localStorage|sessionStorage|console\./);
  });
  it('the form alone renders a labelled password field and no stored value', () => {
    const m = html(createElement(LeaveForm));
    expect(a11yProblems(m)).toEqual([]);
    expect(m).not.toMatch(/value="[^"]/);
  });
});

describe('the goodbye page', () => {
  it('has one h1, says the account and data are deleted, holds no form, no field and no personal data', () => {
    const m = html(createElement(Goodbye));
    expect(a11yProblems(m)).toEqual([]);
    expect(h1s(m)).toBe(1);
    expect(m).toContain('<h1>You have left the pilot</h1>');
    expect(m).toContain('have been deleted');
    expect(m).not.toMatch(/<(form|input|button|select)\b/);
    expect(read('../../app/(auth)/goodbye/page.tsx')).not.toMatch(/cookies|createServerSupabase|searchParams|useSearchParams/);
  });
});

describe('the not-available page (FR-4, FR-9)', () => {
  it('offers Export my data, Leave the pilot and Sign out, and still asks for nothing', () => {
    const m = html(createElement(NotAvailable as never));
    expect(a11yProblems(m)).toEqual([]);
    expect(h1s(m)).toBe(1);
    expect(inOrder(m, ['Export my data', 'href="/leave"', 'action="/auth/sign-out"'])).toBe(true);
    expect(m).not.toMatch(/<(input|select|textarea)\b/);
  });
});

describe('About the pilot (FR-67)', () => {
  it('says plainly that the contact address and the hosting region are not configured when they are not', async () => {
    const m = await page(About);
    expect(a11yProblems(m)).toEqual([]);
    expect(h1s(m)).toBe(1);
    expect(m).toContain('privacy contact address is not configured');
    expect(m).toContain('hosting region is not configured');
    expect(m).not.toMatch(/mailto:|@/);
  });
  it('shows the configured address as a mail link and the configured region as text, and never an address from the documents', async () => {
    vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', 'privacy@example.org');
    vi.stubEnv('NEXT_PUBLIC_HOSTING_REGION', 'South Asia (Mumbai, India)');
    const m = await page(About);
    expect(hasTag(m, 'a', 'href="mailto:privacy@example.org"')).toBe(true);
    expect(m).toContain('>privacy@example.org</a>');
    expect(m).toContain('<p>South Asia (Mumbai, India)</p>');
    expect(m).not.toContain('not configured');
    expect(m).not.toContain('icloud');
  });
  it('an address that is not an address counts as not configured, and cannot become a link', async () => {
    vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', 'javascript:alert(1)');
    const m = await page(About);
    expect(m).toContain('privacy contact address is not configured');
    expect(m).not.toContain('javascript');
  });
  it('lists the supported countries by name, sorted, from the database list', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase');
    const m = await page(About);
    expect(m).toContain('<ul><li>Australia</li><li>India</li></ul>');
  });
  it('says the list could not be loaded, as an announced message, when it is empty', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase');
    state.countries = [];
    expect(await page(About)).toMatch(/role="alert">The list of countries could not be loaded/);
  });
  it('with the local backend there is no list to show, and it says so', async () => {
    expect(await page(About)).toContain('keeps your wardrobe in your browser only');
  });
  it('shows the plan for the end of the pilot from section 7 of the Privacy Policy, and who runs the pilot', async () => {
    const m = await page(About);
    expect(m).toContain('<strong>When the pilot ends</strong> (planned after 3 months), we will tell you and you can export your data.');
    expect(m).toContain('three students taking part in the Analytics Capstone Project');
    expect(hasTag(m, 'a', 'href="/privacy#doc-7-how-long-we-keep-it"')).toBe(true);
  });
  it('the link to section 7 points at a heading that exists on the Privacy page', async () => {
    expect(await page(Privacy)).toContain('<h2 id="doc-7-how-long-we-keep-it">7. How long we keep it</h2>');
  });
  it('links the Privacy Policy, the Terms of Use and the pilot notice', async () => {
    const m = await page(About);
    for (const href of ['/privacy', '/terms', '/notice']) expect(hasTag(m, 'a', `href="${href}"`)).toBe(true);
  });
});

describe('Privacy Policy, Terms of Use and the notice', () => {
  it.each([['Privacy', Privacy, 'legal/PRIVACY-POLICY.md'], ['Terms', Terms, 'legal/TERMS-OF-USE.md']] as const)('%s: no structural problems, one h1, tables with column headers, the file it shows is named', async (_n, p, file) => {
    const m = await page(p);
    expect(a11yProblems(m)).toEqual([]);
    expect(h1s(m)).toBe(1);
    expect(m).toContain(file);
    expect(m).not.toMatch(/<(script|img|iframe|input|form)\b/);
  });
  it('the notice page has one h1 and the same links as the notice', async () => {
    const m = await page(Notice);
    expect(a11yProblems(m)).toEqual([]);
    expect(h1s(m)).toBe(1);
    expect(m).toContain('<h1>Welcome to the Sparta pilot</h1>');
    for (const href of ['/privacy', '/terms', '/about']) expect(hasTag(m, 'a', `href="${href}"`)).toBe(true);
  });
});

describe('the page shell', () => {
  it('has a skip link, a labelled main navigation and a labelled footer navigation with About, Privacy Policy and Terms of Use', async () => {
    const m = html(await RootLayout({ children: createElement('p', null, 'x') }));
    expect(m).toContain('<a class="skip" href="#main">Skip to content</a>');
    expect(m).toContain('<nav aria-label="Main">');
    expect(m).toContain('<footer class="foot"><nav aria-label="About and legal">');
    for (const [href, name] of [['/about', 'About the pilot'], ['/privacy', 'Privacy Policy'], ['/terms', 'Terms of Use']]) expect(m).toMatch(new RegExp(`<a[^>]*href="${href}"[^>]*>${name}</a>`));
    expect(m).toContain('<html lang="en">');
    expect(a11yProblems(m)).toEqual([]);
  });
  it('the main navigation shows Settings only to a signed-in person, and marks it as the current page there', () => {
    expect(html(createElement(Nav))).not.toContain('Settings');
    state.path = '/settings';
    const m = html(createElement(Nav, { signedIn: true }));
    expect(m).toMatch(/<a[^>]*aria-current="page"[^>]*>Settings<\/a>/);
    expect(m.match(/aria-current/g)).toHaveLength(1);
  });
});

describe('Export my data: the button and the download', () => {
  it('is a button with text, described by its help text, with a live region for the result and an announced error', () => {
    const m = html(createElement(ExportButton));
    expect(a11yProblems(m)).toEqual([]);
    expect(hasTag(m, 'button', 'type="button"', 'aria-describedby="export-help"')).toBe(true);
    expect(m).toContain('id="export-help"');
    expect(m).toContain('<p role="status"></p>');
    expect(read('./ExportButton.tsx')).toMatch(/className="error" role="alert"/);
  });
  it('the download is a Blob link on this page: no request, and the file name comes from the export function', () => {
    const src = read('./ExportButton.tsx') + read('./download.ts');
    expect(src).toContain('exportMyData(createBrowserSupabase())');
    expect(src).toContain('downloadText(out.text, out.filename)');
    expect(src).toContain('URL.createObjectURL(new Blob(');
    expect(src).not.toMatch(/\b(fetch|XMLHttpRequest|sendBeacon)\b/);
  });
  it('downloadText builds a JSON Blob, names the file as given, clicks a temporary link once and releases the address later', () => {
    const made: unknown[] = [];
    const link = { href: '', download: '', rel: '', click: vi.fn(), remove: vi.fn() };
    const body = { append: vi.fn() };
    vi.stubGlobal('document', { createElement: (t: string) => { made.push(t); return link; }, body });
    vi.stubGlobal('URL', { createObjectURL: vi.fn((b: Blob) => { made.push(b); return 'blob:x'; }), revokeObjectURL: vi.fn() });
    vi.useFakeTimers();
    try {
      downloadText('{"a":1}', 'sparta-export-2026-11-06.json');
      expect(made[1]).toBe('a');
      expect((made[0] as Blob).type).toBe('application/json');
      expect((made[0] as Blob).size).toBe(7);
      expect([link.href, link.download, link.rel]).toEqual(['blob:x', 'sparta-export-2026-11-06.json', 'noopener']);
      expect(body.append).toHaveBeenCalledWith(link);
      expect(link.click).toHaveBeenCalledTimes(1);
      expect(link.remove).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10_000);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });
});

describe('the new styles use the colour tokens, which the contrast tests cover', () => {
  it('no colour is written into a rule outside the two :root blocks', () => {
    const css = read('../../app/globals.css').replace(/:root\s*\{[^}]*\}/g, '');
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });
});
