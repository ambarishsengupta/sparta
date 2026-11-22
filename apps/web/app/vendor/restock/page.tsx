import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { isNoLoginDemo } from '../../../lib/demo-mode';
import { ActionsHeading } from '../../../components/vendor/actions/Parts';
import { RestockBuilder } from '../../../components/vendor/actions/RestockBuilder';

/** Vendor plan, section 5: a screen of the no-login demo only, with fixed simulated figures and local state. Anywhere else the page does not exist. */
export default function Page() {
  if (!isNoLoginDemo()) notFound();
  return (
    <>
      <ActionsHeading title="Restock" />
      <Suspense fallback={<p role="status">Loading.</p>}><RestockBuilder /></Suspense>
    </>
  );
}
