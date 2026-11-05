import { AuthForm } from '../../../components/auth/AuthForm';
import { createServerSupabase } from '../../../lib/supabase/server';

export default async function Page() {
  // FR-8: the sign-up page lists the countries the pilot is open in. If the list cannot be read the page still works without it.
  const { data } = await (await createServerSupabase()).schema('app').rpc('supported_countries');
  const names = new Intl.DisplayNames('en', { type: 'region' });
  const countries: string[] = Array.isArray(data) ? data.map((c: string) => names.of(c) ?? c) : [];
  return (
    <>
      <AuthForm mode="sign-up" />
      <p className="muted">Sparta is invitation-only during the pilot: sign up with the address your invitation was sent to.{countries.length > 0 && ` The pilot is open in: ${countries.join(', ')}.`}</p>
    </>
  );
}
