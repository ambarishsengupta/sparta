import Link from 'next/link';
import { InlineNodes } from '../../components/legal/Markdown';
import { contactEmail, hostingRegion } from '../../lib/pilot-config';
import { endOfPilotPlan, readLegal } from '../../components/legal/files';
import { readSupportedCountries } from '../../lib/supabase/consent-actions';
import { dataBackend } from '../../lib/supabase/config';
import { createServerSupabase } from '../../lib/supabase/server';

/** FR-67: who runs the pilot, the privacy contact, the hosting region, the supported countries, the plan for the end of the pilot and the documents. Public. */
export default async function Page() {
  const email = contactEmail();
  const region = hostingRegion();
  const plan = endOfPilotPlan(readLegal('privacy'));
  const onAccounts = dataBackend() === 'supabase';
  const codes = onAccounts ? await readSupportedCountries(await createServerSupabase()) : [];
  const names = new Intl.DisplayNames('en', { type: 'region', fallback: 'none' });
  const countries = codes.map((c) => names.of(c) ?? c).sort((a, b) => a.localeCompare(b, 'en'));
  return (
    <>
      <h1>About the pilot</h1>
      <h2>Who runs it</h2>
      <p>Sparta is a free pilot study run by the Sparta project team, three students taking part in the Analytics Capstone Project, Term 5, 2026. It is an academic proof of concept, not a company or a commercial product.</p>
      <h2>Privacy contact</h2>
      {email
        ? <p>Questions, requests and complaints about privacy: <a href={`mailto:${email}`}>{email}</a>. We answer within 7 days.</p>
        : <p>The privacy contact address is not configured in this build, so it cannot be shown here. Ask the person who invited you.</p>}
      <h2>Where your data is hosted</h2>
      {region ? <p>{region}</p> : <p>The hosting region is not configured in this build, so it cannot be shown here. The Privacy Policy, section 6, names the providers.</p>}
      <h2>Where the pilot is open</h2>
      {!onAccounts ? <p>This build keeps your wardrobe in your browser only and has no list of countries.</p>
        : countries.length > 0 ? <ul>{countries.map((c) => <li key={c}>{c}</li>)}</ul>
          : <p className="error" role="alert">The list of countries could not be loaded just now. Reload the page in a moment.</p>}
      <h2>When the pilot ends</h2>
      {plan.length > 0 ? <p><InlineNodes nodes={plan} /></p> : <p>The plan for the end of the pilot is in section 7 of the Privacy Policy.</p>}
      <p><Link href="/privacy#doc-7-how-long-we-keep-it">Read section 7 of the Privacy Policy</Link></p>
      <h2>Documents</h2>
      <ul>
        <li><Link href="/privacy">Privacy Policy</Link></li>
        <li><Link href="/terms">Terms of Use</Link></li>
        <li><Link href="/notice">The pilot notice</Link></li>
      </ul>
    </>
  );
}
