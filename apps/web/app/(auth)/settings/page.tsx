import Link from 'next/link';
import { ExportButton } from '../../../components/account/ExportButton';
import { SignOutForm } from '../../../components/account/SignOutForm';
import { SettingsForm } from '../../../components/account/SettingsForm';
import { SHARING_LOCKED_TEXT } from '../../../lib/consent-form';
import { currencyOptions } from '../../../lib/onboarding';
import { readProfile } from '../../../components/account/account-actions';
import { createServerSupabase } from '../../../lib/supabase/server';

/** FR-61, FR-62, FR-66: the profile, the locked sharing setting, Export my data, Leave the pilot and sign-out. */
export default async function Page() {
  const profile = await readProfile(await createServerSupabase());
  if (!profile) return <><h1>Settings</h1><p className="error" role="alert">We could not load your settings just now. Reload the page in a moment.</p></>;
  const region = new Intl.DisplayNames('en', { type: 'region', fallback: 'none' });
  const money = new Intl.DisplayNames('en', { type: 'currency', fallback: 'none' });
  const currencies = currencyOptions(Intl.supportedValuesOf('currency'), (c) => money.of(c));
  return (
    <>
      <h1>Settings</h1>
      <h2>Your details</h2>
      <p>Country: <strong>{profile.country ? (region.of(profile.country) ?? profile.country) : 'not set'}</strong> <span className="muted">(chosen when you joined; it decides where the pilot is open for you)</span></p>
      <SettingsForm initial={{ displayName: profile.displayName, hemisphere: profile.hemisphere ?? '', currency: profile.currency, occasions: profile.occasions }} currencies={currencies} />
      <h2>Sharing</h2>
      <label className="check locked" htmlFor="sharing">
        <input id="sharing" type="checkbox" checked disabled readOnly />
        Share anonymised group figures (on for everyone in the pilot)
      </label>
      <details>
        <summary>Why can&apos;t I switch this off?</summary>
        <p>{SHARING_LOCKED_TEXT}</p>
      </details>
      <h2>Your data</h2>
      <ExportButton />
      <h2>Leave the pilot</h2>
      <p>Leaving deletes your account and everything in it. No reason is asked.</p>
      <Link href="/leave" className="button secondary">Leave the pilot</Link>
      <h2>Account</h2>
      <SignOutForm />
      <p><Link href="/about">About the pilot</Link></p>
    </>
  );
}
