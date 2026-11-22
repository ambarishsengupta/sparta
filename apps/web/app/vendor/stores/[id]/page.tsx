import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StoreDetail } from '../../../../components/vendor/stores/StoreDetail';
import { isNoLoginDemo } from '../../../../lib/demo-mode';
import { DEMO_VENDOR_NAME } from '../../../../lib/demo-vendor';

/** Vendor plan, section 4: one store of the no-login demo. An unknown id shows "Not found" text (the component), not a 404 page. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!isNoLoginDemo()) notFound();
  const { id } = await params;
  return (
    <>
      <p className="muted"><Link href="/vendor/stores">Stores</Link> / {DEMO_VENDOR_NAME}</p>
      <StoreDetail id={id} />
    </>
  );
}
