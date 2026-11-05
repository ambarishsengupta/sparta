/// <reference types="vite/client" />
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import NotAvailable from '../../app/(auth)/not-available/page';
import Onboarding from '../../app/(auth)/onboarding/page';
import PilotNotice from '../../app/(auth)/pilot-notice/page';
import Privacy from '../../app/privacy/page';
import Terms from '../../app/terms/page';
import { SHARING_LOCKED_TEXT } from '../../lib/consent-form';
import { readVersions } from '../../lib/supabase/consent-actions';
import { AcceptTermsForm } from './AcceptTermsForm';
import { OnboardingForm } from './OnboardingForm';

vi.mock('../../lib/supabase/server', () => ({ createServerSupabase: async () => ({}) }));
vi.mock('../../lib/supabase/consent-actions', async (original) => ({
  ...(await original<typeof import('../../lib/supabase/consent-actions')>()),
  readVersions: vi.fn(async () => ({ terms: '3', privacy: '4', notice: '5' })), readSupportedCountries: async () => ['IN'],
}));
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const html = (el: ReactElement) => renderToStaticMarkup(el);
const page = async (p: () => Promise<ReactElement> | ReactElement) => html(await p());
const at = (markup: string, s: string) => markup.indexOf(s);
/** True when some `<tag ...>` in the markup carries every one of the attribute strings, in any order. */
const has = (markup: string, tag: string, ...attrs: string[]) => [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].some((m) => attrs.every((a) => m[0].includes(a)));

/** Problems with form controls in rendered HTML: an input or select without a non-empty label, a description that points nowhere, an empty button. */
function problems(markup: string): string[] {
  const out: string[] = [];
  const ids = new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of markup.matchAll(/<(input|select)\b[^>]*>/g)) {
    const id = /\sid="([^"]+)"/.exec(m[0])?.[1];
    // A label is either explicit (for="id") or one that wraps the control.
    const before = markup.slice(0, m.index);
    const wrapping = before.lastIndexOf('<label') > before.lastIndexOf('</label>') ? /^[^]*?<\/label>/.exec(markup.slice(before.lastIndexOf('<label')))?.[0] : undefined;
    const label = (id && new RegExp(`<label[^>]*\\sfor="${id}"[^>]*>(.*?)</label>`, 's').exec(markup)?.[1]) || wrapping;
    if (!label || label.replace(/<[^>]*>/g, '').trim() === '') out.push(`${m[0]} has no label`);
    for (const ref of /aria-describedby="([^"]+)"/.exec(m[0])?.[1]?.split(' ') ?? []) if (!ids.has(ref)) out.push(`${ref} is not on the page`);
  }
  for (const m of markup.matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)) if (m[1]!.trim() === '') out.push('a button has no text');
  return out;
}
const h1s = (markup: string) => markup.match(/<h1[ >]/g)?.length ?? 0;

describe('the checker (CC6)', () => {
  it('flags an unlabelled select, an empty label, a dangling description and an empty button', () => {
    expect(problems('<select id="a"></select>')).toHaveLength(1);
    expect(problems('<label for="a"> </label><input id="a"/>')).toHaveLength(1);
    expect(problems('<label for="a">A</label><input id="a" aria-describedby="gone"/>')).toHaveLength(1);
    expect(problems('<button></button>')).toHaveLength(1);
    expect(problems('<label for="a"><input id="a"/>A</label><button>Go</button>')).toEqual([]);
    expect(problems('<label><input type="checkbox"/>Work</label>')).toEqual([]);
    expect(problems('<label><input type="checkbox"/></label>')).toHaveLength(1);
    expect(problems('<label>A</label><input type="checkbox"/>')).toHaveLength(1);
  });
});

describe('accept-terms (FR-2, FR-68)', () => {
  const markup = html(createElement(AcceptTermsForm, { versions: { terms: '3', privacy: '4' } }));
  it('every control has a name and there is one h1', () => { expect(problems(markup)).toEqual([]); expect(h1s(markup)).toBe(1); });
  it('has the age tick and the agreement tick, both unticked at the start', () => {
    expect(markup.match(/type="checkbox"/g)).toHaveLength(2);
    expect(markup).not.toMatch(/checked/);
    expect(markup).toContain('I am 18 or over.');
    expect(markup).toContain('I agree to the Terms of Use and the Privacy Policy.');
  });
  it('shows the versions it will send and links both documents in a new tab without handing over the opener', () => {
    expect(markup).toContain('Terms of Use (version 3)');
    expect(markup).toContain('Privacy Policy (version 4)');
    for (const href of ['/terms', '/privacy']) expect(has(markup, 'a', `href="${href}"`, 'target="_blank"', 'rel="noopener"')).toBe(true);
  });
  it('focus order: documents, age tick, agreement tick, then Continue', () => {
    expect(at(markup, 'href="/terms"')).toBeLessThan(at(markup, 'id="accept-age"'));
    expect(at(markup, 'id="accept-age"')).toBeLessThan(at(markup, 'id="accept-agree"'));
    expect(at(markup, 'id="accept-agree"')).toBeLessThan(at(markup, 'type="submit"'));
  });
  it('errors are announced next to their field and mark it invalid; the first invalid field is focused', () => {
    const src = read('./AcceptTermsForm.tsx');
    for (const p of src.match(/<p [^>]*className="error"[^>]*>/g) ?? []) expect(p).toContain('role="alert"');
    expect(src.match(/className="error"/g)!.length).toBeGreaterThanOrEqual(3);
    expect(src).toContain('aria-invalid');
    expect(src).toContain('ageRef.current?.focus()');
  });
});

describe('pilot-notice (FR-3 to FR-5, FR-61)', () => {
  it('shows the notice with its two links, the join button and nothing else that leads on', async () => {
    const markup = await page(PilotNotice as never);
    expect(h1s(markup)).toBe(1);
    expect(markup).toContain('<h1>Welcome to the Sparta pilot</h1>');
    expect(markup).toContain('<strong>group figures</strong>');
    expect([...markup.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(['/privacy', '/terms']);
    expect(problems(markup)).toEqual([]);
  });
  it('shows sharing locked on: a ticked, disabled box with a label, and the FR-61 wording one tap away', async () => {
    const markup = await page(PilotNotice as never);
    expect(has(markup, 'input', 'id="sharing"', 'type="checkbox"', 'checked=""', 'disabled=""')).toBe(true);
    expect(markup).toContain('<summary>Why can&#x27;t I switch this off?</summary>');
    expect(markup.replace(/&#x27;/g, "'")).toContain(SHARING_LOCKED_TEXT);
  });
  it('the only other way out is a POST form that signs out, with a plain explanation', async () => {
    const markup = await page(PilotNotice as never);
    expect(has(markup, 'form', 'action="/auth/sign-out"', 'method="post"')).toBe(true);
    expect(markup).toContain('No thanks, sign out');
    expect(markup).toContain('You need to join the pilot to use Sparta.');
    expect(markup).toContain('shown again the next time you sign in');
  });
  it('the join button is the client form, given the notice version read from the settings', async () => {
    const markup = await page(PilotNotice as never);
    expect(markup).toContain('I understand and join the pilot');
    expect(read('../../app/(auth)/pilot-notice/page.tsx')).toContain('noticeVersion={versions.notice}');
  });
  it('without a readable version there is an error and no way to join', async () => {
    vi.mocked(readVersions).mockResolvedValueOnce(null);
    const markup = await page(PilotNotice as never);
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('join the pilot');
  });
  it('the locked sharing text uses the muted colour, which the contrast tests cover', () => {
    expect(/\.locked\s*\{([^}]*)\}/.exec(read('../../app/globals.css'))?.[1]).toContain('color: var(--muted)');
  });
});

describe('onboarding (FR-6, FR-9)', () => {
  const countries = [{ value: 'IN', label: 'India' }];
  const currencies = [{ value: 'INR', label: 'INR - Indian Rupee' }, { value: 'USD', label: 'USD - US Dollar' }];
  const markup = html(createElement(OnboardingForm, { countries, currencies }));
  it('every control has a name and there is one h1', () => { expect(problems(markup)).toEqual([]); expect(h1s(markup)).toBe(1); });
  it('asks country, hemisphere and currency in that order, then the optional occasions, then Continue', () => {
    const order = ['id="ob-country"', 'id="ob-hemisphere"', 'id="ob-currency"', '<legend>Occasions you dress for most (optional)</legend>', 'type="submit"'].map((s) => at(markup, s));
    expect(order.every((n) => n > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('lists the pilot countries, a way to say the country is not listed, and every occasion of the taxonomy unticked', () => {
    expect(markup).toContain('<option value="IN">India</option>');
    expect(markup).toContain('My country is not listed');
    expect(markup.match(/type="checkbox"/g)).toHaveLength(7);
    expect(markup).not.toMatch(/checked/);
  });
  it('the page builds its lists on the server from the supported-countries call and the Intl currency list', async () => {
    const markup2 = await page(Onboarding as never);
    expect(markup2).toContain('<option value="IN">India</option>');
    expect(markup2).toContain('INR - Indian Rupee');
    expect(problems(markup2)).toEqual([]);
  });
  it('errors are announced next to their field and mark it invalid', () => {
    const src = read('./OnboardingForm.tsx');
    expect(src).toContain('role="alert"');
    expect(src).toContain("'aria-invalid'");
    expect(src).toContain('first.current?.focus()');
  });
  it('the note about a country that is not listed is a status message, not an error', () => { expect(read('./OnboardingForm.tsx')).toMatch(/id="ob-note" className="muted" role="status"/); });
});

describe('not-available (FR-9)', () => {
  const markup = html(createElement(NotAvailable as never));
  it('says the pilot is not open in the person\'s country, in the words of the FDD', () => { expect(markup).toContain('<h1>The pilot is not open in your country yet</h1>'); expect(h1s(markup)).toBe(1); });
  it('asks for and collects nothing: no field of any kind, only a sign-out form', () => {
    expect(markup).not.toMatch(/<(input|select|textarea)\b/);
    expect(has(markup, 'form', 'action="/auth/sign-out"', 'method="post"')).toBe(true);
    expect(problems(markup)).toEqual([]);
  });
});

describe('the Privacy Policy and Terms of Use pages', () => {
  it('each has one h1, names the repository file that holds the full text, and the Privacy page also shows the notice', () => {
    const terms = html(createElement(Terms as never));
    const privacy = html(createElement(Privacy as never));
    expect(h1s(terms)).toBe(1);
    expect(h1s(privacy)).toBe(1);
    expect(terms).toContain('legal/TERMS-OF-USE.md');
    expect(privacy).toContain('legal/PRIVACY-POLICY.md');
    expect(privacy).toContain('<h2>Welcome to the Sparta pilot</h2>');
  });
});
