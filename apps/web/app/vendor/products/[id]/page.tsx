import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductDetail } from '../../../../components/vendor/products/ProductDetail';
import { isNoLoginDemo } from '../../../../lib/demo-mode';
import { DEMO_VENDOR_NAME } from '../../../../lib/demo-vendor';

/** Vendor plan, section 4: one product of the no-login demo. An unknown id shows "Not found" text (the component), not a 404 page. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!isNoLoginDemo()) notFound();
  const { id } = await params;
  return (
    <>
      <p className="muted"><Link href="/vendor/products">Products</Link> / {DEMO_VENDOR_NAME}</p>
      <ProductDetail id={id} />
    </>
  );
}
