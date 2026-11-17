import Link from 'next/link';
import type { ReactNode } from 'react';
import { ExportButton } from './ExportButton';
import { SignOutForm } from './SignOutForm';

/**
 * FR-4 and FR-5: a person who is held at a step (the pilot notice, the Terms and Privacy Policy) or has said no still has three ways out: Export my data,
 * Leave the pilot (which deletes the account) and Sign out. The gate lets /leave through at these steps; the export is a call on the person's own session.
 */
export function HeldOptions({ intro, signOutLabel = 'Sign out' }: { intro: ReactNode; signOutLabel?: string }) {
  return (
    <section aria-labelledby="held-options" className="form">
      <h2 id="held-options">If you do not want to continue</h2>
      <p className="muted">{intro}</p>
      <ExportButton />
      <p><Link href="/leave" className="button secondary">Leave the pilot</Link></p>
      <SignOutForm label={signOutLabel} />
    </section>
  );
}
