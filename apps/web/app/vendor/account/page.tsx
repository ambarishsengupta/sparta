import { CONTACT_NOT_SET, contactEmail } from '../../../lib/pilot-config';
import { ProductPhoto } from '../../../components/ui/ProductPhoto';
import { isNoLoginDemo } from '../../../lib/demo-mode';
import { DEMO_VENDOR_EMAIL, DEMO_VENDOR_NAME, demoCatalogue } from '../../../lib/demo-vendor';
import { createServerSupabase } from '../../../lib/supabase/server';
import { ownVendor } from '../../../lib/vendor/access';

/** FR-95: who is signed in, for which vendor, and the privacy contact address. Read with the vendor's own session; the page changes nothing. */
export default async function Page() {
  if (isNoLoginDemo()) {
    return (
      <>
        <h1>Account</h1>
        <h2>Signed in as</h2>
        <p>{DEMO_VENDOR_EMAIL}</p>
        <h2>Vendor</h2>
        <p>{DEMO_VENDOR_NAME}</p>
        <h2>Your catalogue</h2>
        <p className="muted">12 items.</p>
        <ul className="list tiles">
          {demoCatalogue().map((i) => (
            <li key={i.id} className="card item">
              <div className="swatch"><ProductPhoto id={i.photoId} name={i.name} /></div>
              <div className="grow"><p className="title">{i.name}</p><p className="muted">{[i.category, i.subType].filter(Boolean).join(' · ')}</p></div>
            </li>
          ))}
        </ul>
      </>
    );
  }
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
