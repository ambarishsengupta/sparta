import Link from 'next/link';
import { SignOutForm } from '../../../components/account/SignOutForm';
import { ExportButton } from '../../../components/account/ExportButton';
import { NOT_OPEN_MESSAGE } from '../../../lib/consent-form';

/** FR-9 and FR-4: nothing is asked or collected here. The person can still export their data, leave the pilot or sign out. */
export default function Page() {
  return (
    <>
      <h1>{NOT_OPEN_MESSAGE}</h1>
      <p>You cannot use Sparta until the pilot opens where you are. This page asks for nothing more from you.</p>
      <h2>What you can do</h2>
      <ExportButton />
      <p><Link href="/leave" className="button secondary">Leave the pilot</Link></p>
      <SignOutForm />
      <p><Link href="/about">About the pilot</Link></p>
    </>
  );
}
