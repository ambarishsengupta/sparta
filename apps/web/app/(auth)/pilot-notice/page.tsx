import { HeldOptions } from '../../../components/account/HeldOptions';
import { NoticeText } from '../../../components/consent/NoticeText';
import { PilotNoticeForm } from '../../../components/consent/PilotNoticeForm';
import { SHARING_LOCKED_TEXT } from '../../../lib/consent-form';
import { readVersions } from '../../../lib/supabase/consent-actions';
import { createServerSupabase } from '../../../lib/supabase/server';

/** FR-3 to FR-5, FR-61. Blocking: the only ways on are joining, or (FR-4) exporting the data, leaving the pilot and signing out. */
export default async function Page() {
  const versions = await readVersions(await createServerSupabase());
  if (!versions) return <p className="error" role="alert">We could not load the notice just now. Reload the page in a moment.</p>;
  return (
    <>
      <NoticeText />
      <label className="check locked" htmlFor="sharing">
        <input id="sharing" type="checkbox" checked disabled readOnly />
        Share anonymised group figures (on for everyone in the pilot)
      </label>
      <details>
        <summary>Why can&apos;t I switch this off?</summary>
        <p>{SHARING_LOCKED_TEXT}</p>
      </details>
      <PilotNoticeForm noticeVersion={versions.notice} />
      <HeldOptions signOutLabel="No thanks, sign out" intro="You need to join the pilot to use Sparta. If you do not want to, you can take your data with you, leave the pilot (which deletes your account) or sign out. This notice is shown again the next time you sign in." />
    </>
  );
}
