import { HeldOptions } from '../../../components/account/HeldOptions';
import { OnboardingForm } from '../../../components/consent/OnboardingForm';
import { countryOptions, currencyOptions } from '../../../lib/onboarding';
import { readSupportedCountries } from '../../../lib/supabase/consent-actions';
import { createServerSupabase } from '../../../lib/supabase/server';

/** FR-2 and FR-4: the questions, and, as on the other held pages, a way to export the data, leave the pilot or sign out. */
export default async function Page() {
  const supported = await readSupportedCountries(await createServerSupabase());
  const region = new Intl.DisplayNames('en', { type: 'region', fallback: 'none' });
  const money = new Intl.DisplayNames('en', { type: 'currency', fallback: 'none' });
  // Lists are built here, on the server, so the page and the browser show exactly the same options.
  return (
    <>
      <OnboardingForm countries={countryOptions(supported, (c) => region.of(c))} currencies={currencyOptions(Intl.supportedValuesOf('currency'), (c) => money.of(c))} />
      <HeldOptions intro="You need to answer these few questions to use Sparta. If you do not want to, you can take your data with you, leave the pilot (which deletes your account) or sign out. The questions are shown again the next time you sign in." />
    </>
  );
}
