/// <reference types="node" />
import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SIGN_IN_FAILURE, messageOf } from '../lib/supabase/errors';
import { EXPORT_FAILURE } from './account/account-actions';
import { findAll, mount, settle, textOf, type Found } from '../test-support/hook-shim';
import { ExportButton } from './account/ExportButton';
import { LeaveForm } from './account/LeaveForm';
import { SettingsForm } from './account/SettingsForm';
import { AuthForm } from './auth/AuthForm';
import { AcceptTermsForm } from './consent/AcceptTermsForm';
import { OnboardingForm } from './consent/OnboardingForm';
import { PilotNoticeForm } from './consent/PilotNoticeForm';
import { AgreementForm } from './vendor/AgreementForm';

// WO-0125: the eight forms flagged by no-misused-promises. Each submit handler is a plain function (it returns nothing, not a promise) and a rejection of the work it starts lands in the form's own
// error state, with the button usable again. The rejection here is the client factory throwing, which every one of the eight calls inside its async part, after its own checks.
vi.mock('react', async (orig) => ({ ...(await orig<object>()), ...(await import('../test-support/hook-shim')).hookStandIns }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined }) }));
vi.mock('../lib/supabase/browser', () => ({ createBrowserSupabase: () => { throw new Error('internal detail: connection refused'); } }));

const SENTENCE = messageOf(new Error('x'));
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const click = (e: Found) => (e.props.onClick as () => unknown)();
const change = (e: Found, target: object) => (e.props.onChange as (ev: unknown) => void)({ target });
const submit = (el: unknown) => (findAll(el, (e) => e.type === 'form')[0]!.props.onSubmit as (ev: unknown) => unknown)({ preventDefault: () => undefined });
const input = (el: unknown, id: string) => findAll(el, (e) => e.props.id === id)[0]!;

/** The form after the failure: the sentence in an alert, no server text, the button not left on "Please wait". */
function expectShown(el: unknown, sentence = SENTENCE) {
  const page = html(el);
  expect(page).toMatch(new RegExp(`<p( id="[a-z-]+")? class="error" role="alert">${sentence}</p>`));
  expect(page).not.toContain('internal detail');
  expect(page).not.toContain('Please wait');
}

describe('a rejection is shown in the form, never left unhandled', () => {
  it('ExportButton', async () => {
    const f = mount(ExportButton, {});
    const button = findAll(f.render(), (e) => e.type === 'button')[0]!;
    expect(click(button)).toBeUndefined();
    await settle();
    expectShown(f.render(), EXPORT_FAILURE.unexpected);   // export saves nothing in the database: never the not-saved sentence
  });
  it('PilotNoticeForm', async () => {
    const f = mount(PilotNoticeForm, { noticeVersion: '2026-11-01' });
    expect(click(findAll(f.render(), (e) => e.type === 'button')[0]!)).toBeUndefined();
    await settle();
    expectShown(f.render());
  });
  it('LeaveForm', async () => {
    const f = mount(LeaveForm, {});
    expect(submit(f.render())).toBeUndefined();
    await settle();
    expectShown(f.render());
  });
  it('AgreementForm', async () => {
    const f = mount(AgreementForm, {});
    change(input(f.render(), 'accept-vendor-agreement'), { checked: true });
    expect(submit(f.render())).toBeUndefined();
    await settle();
    expectShown(f.render());
  });
  it('AcceptTermsForm', async () => {
    const f = mount(AcceptTermsForm, { versions: { terms: '1', privacy: '1' } });
    change(input(f.render(), 'accept-age'), { checked: true });
    change(input(f.render(), 'accept-agree'), { checked: true });
    expect(submit(f.render())).toBeUndefined();
    await settle();
    expectShown(f.render());
  });
  it('SettingsForm', async () => {
    const f = mount(SettingsForm, { initial: { displayName: '', hemisphere: 'north', currency: 'USD', occasions: [] }, currencies: [{ value: 'USD', label: 'US dollar' }] });
    expect(submit(f.render())).toBeUndefined();
    await settle();
    expectShown(f.render());
  });
  it('AuthForm (reset: an address and no password)', async () => {
    const f = mount(AuthForm, { mode: 'reset' });
    change(input(f.render(), 'auth-email'), { value: 'person@example.test' });
    expect(submit(f.render())).toBeUndefined();
    await settle();
    expectShown(f.render());
  });
  it('OnboardingForm', async () => {
    const f = mount(OnboardingForm, { countries: [{ value: 'IN', label: 'India' }], currencies: [{ value: 'INR', label: 'Indian rupee' }] });
    change(input(f.render(), 'ob-country'), { value: 'IN' });
    expect(submit(f.render())).toBeUndefined();
    await settle();
    expectShown(f.render());
  });
  it('sign-in and export say a failure to load or sign in, never that a change was not saved', async () => {
    expect(EXPORT_FAILURE.unexpected).not.toMatch(/not saved/);
    expect(SIGN_IN_FAILURE).not.toMatch(/not saved/);
    const exp = mount(ExportButton, {});
    click(findAll(exp.render(), (e) => e.type === 'button')[0]!);
    await settle();
    expect(html(exp.render())).toContain(`role="alert">${EXPORT_FAILURE.unexpected}</p>`);
    const f = mount(AuthForm, { mode: 'sign-in' });
    change(input(f.render(), 'auth-email'), { value: 'person@example.test' });
    change(input(f.render(), 'auth-pw'), { value: 'a-long-enough-test-password' });
    expect(submit(f.render())).toBeUndefined();
    await settle();
    const page = html(f.render());
    expect(page).toContain(`role="alert">${SIGN_IN_FAILURE}</p>`);
    expect(page).not.toMatch(/not saved/);
    const up = mount(AuthForm, { mode: 'sign-up' });   // sign-up creates an account: it keeps the write sentence
    change(input(up.render(), 'auth-email'), { value: 'person@example.test' });
    change(input(up.render(), 'auth-pw'), { value: 'a-long-enough-test-password' });
    submit(up.render());
    await settle();
    expect(html(up.render())).toContain(`role="alert">${SENTENCE}</p>`);
  });
  it('none of the eight forms holds its own copy of the rejection line: each uses showRejection', () => {
    const files = ['account/ExportButton', 'account/LeaveForm', 'account/SettingsForm', 'auth/AuthForm', 'consent/AcceptTermsForm', 'consent/OnboardingForm', 'consent/PilotNoticeForm', 'vendor/AgreementForm'];
    for (const f of files) {
      const src = readFileSync(new URL(`./${f}.tsx`, import.meta.url), 'utf8');
      expect(src, f).toContain('showRejection(setBusy, setFailure');
      expect(src, f).not.toMatch(/setFailure\(\s*messageOf/);
      expect(src, f).not.toMatch(/\.catch\(\s*\(/);
    }
  });
  it('the text helper reads what the page says', () => {
    expect(textOf(['a', { props: { children: ['b', 1] } }])).toBe('ab1');
  });
});
