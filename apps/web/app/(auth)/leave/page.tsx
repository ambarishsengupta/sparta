import { ExportButton } from '../../../components/account/ExportButton';
import { LeaveForm } from '../../../components/account/LeaveForm';

/** FR-63, FR-66: the confirmation step of Leave the pilot. Reachable from Settings and, for a person held at a gate step, from the not-available page (FR-4). */
export default function Page() {
  return (
    <>
      <h1>Leave the pilot</h1>
      <p>Leaving deletes your Sparta account and everything in it: your profile, your wardrobe, your outfits, your wishlist, your agreements and your place on the invitation list. It cannot be undone, and no reason is asked.</p>
      <p>Deletion is complete within 7 days at the latest, and copies in our encrypted backups are gone within 30 days; they are never restored. Group figures that were already built from many people&apos;s data are not recalculated, and they never held a row about you.</p>
      <h2>Want a copy first?</h2>
      <ExportButton />
      <h2>Confirm that it is you</h2>
      <p>Type your password again to delete the account.</p>
      <LeaveForm />
    </>
  );
}
