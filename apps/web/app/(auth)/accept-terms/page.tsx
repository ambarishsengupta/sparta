import { HeldOptions } from '../../../components/account/HeldOptions';
import { AcceptTermsForm } from '../../../components/consent/AcceptTermsForm';
import { readVersions } from '../../../lib/supabase/consent-actions';
import { createServerSupabase } from '../../../lib/supabase/server';

/** FR-2, FR-5, FR-68. A person who does not accept (or whose accepted versions are out of date) can still export the data, leave the pilot or sign out. */
export default async function Page() {
  const versions = await readVersions(await createServerSupabase());
  if (!versions) return <p className="error" role="alert">We could not load the documents just now. Reload the page in a moment.</p>;
  return (
    <>
      <AcceptTermsForm versions={versions} />
      <HeldOptions intro="You need to accept the Terms of Use and the Privacy Policy to use Sparta. If you do not want to, you can take your data with you, leave the pilot (which deletes your account) or sign out. The documents are shown again the next time you sign in." />
    </>
  );
}
