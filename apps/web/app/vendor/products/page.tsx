import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ProductsPage } from '../../../components/vendor/products/ProductsPage';
import { isNoLoginDemo } from '../../../lib/demo-mode';
import { DEMO_VENDOR_NAME } from '../../../lib/demo-vendor';

/** Vendor plan, section 4: a screen of the no-login demo only, with fixed simulated figures. Anywhere else the page does not exist. */
export default function Page() {
  if (!isNoLoginDemo()) notFound();
  return (
    <>
      <h1>Products</h1>
      <p className="muted">{DEMO_VENDOR_NAME}</p>
      <p className="muted">Simulated demo data: no real users or sales.</p>
      <Suspense fallback={<p role="status">Loading the products.</p>}><ProductsPage /></Suspense>
    </>
  );
}
