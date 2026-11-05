import { OnboardingForm } from '../../../components/consent/OnboardingForm';
import { countryOptions, currencyOptions } from '../../../lib/onboarding';
import { readSupportedCountries } from '../../../lib/supabase/consent-actions';
import { createServerSupabase } from '../../../lib/supabase/server';

export default async function Page() {
  const supported = await readSupportedCountries(await createServerSupabase());
  const region = new Intl.DisplayNames('en', { type: 'region', fallback: 'none' });
  const money = new Intl.DisplayNames('en', { type: 'currency', fallback: 'none' });
  // Lists are built here, on the server, so the page and the browser show exactly the same options.
  return <OnboardingForm countries={countryOptions(supported, (c) => region.of(c))} currencies={currencyOptions(Intl.supportedValuesOf('currency'), (c) => money.of(c))} />;
}
