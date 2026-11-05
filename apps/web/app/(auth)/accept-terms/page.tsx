import { AcceptTermsForm } from '../../../components/consent/AcceptTermsForm';
import { readVersions } from '../../../lib/supabase/consent-actions';
import { createServerSupabase } from '../../../lib/supabase/server';

export default async function Page() {
  const versions = await readVersions(await createServerSupabase());
  if (!versions) return <p className="error" role="alert">We could not load the documents just now. Reload the page in a moment.</p>;
  return <AcceptTermsForm versions={versions} />;
}
