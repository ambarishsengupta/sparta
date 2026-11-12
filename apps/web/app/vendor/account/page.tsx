import { CONTACT_NOT_SET, contactEmail } from '../../../lib/pilot-config';
import { createServerSupabase } from '../../../lib/supabase/server';
import { ownVendor } from '../../../lib/vendor/access';

/** FR-95: who is signed in, for which vendor, and the privacy contact address. Read with the vendor's own session; the page changes nothing. */
export default async function Page() {
  const client = await createServerSupabase();
  const [{ data }, vendor] = await Promise.all([client.auth.getUser(), ownVendor(client)]);
  const contact = contactEmail();
  return (
    <>
      <h1>Account</h1>
      <h2>Signed in as</h2>
      <p>{data.user?.email ?? 'Not signed in.'}</p>
      <h2>Vendor</h2>
      <p>{vendor?.name ?? 'The vendor name is not available.'}</p>
      <h2>Privacy contact</h2>
      {contact ? <p>Questions, requests and complaints about privacy: <a href={`mailto:${contact}`}>{contact}</a>. We answer within 7 days.</p> : <p>{CONTACT_NOT_SET}</p>}
    </>
  );
}
