import { Dashboard } from '../../components/vendor/Dashboard';
import { isNoLoginDemo } from '../../lib/demo-mode';
import { DEMO_VENDOR_NAME } from '../../lib/demo-vendor';
import { createServerSupabase } from '../../lib/supabase/server';
import { ownVendor } from '../../lib/vendor/access';

/** FR-72 to FR-77: the dashboard. The vendor name (readable since WO-0112) is the page's subtitle; every figure is loaded by the client component with the vendor's own session. */
export default async function Page() {
  if (isNoLoginDemo()) return <><h1>Dashboard</h1><p className="muted">{DEMO_VENDOR_NAME}</p><Dashboard /></>;
  const vendor = await ownVendor(await createServerSupabase());
  return (
    <>
      <h1>Dashboard</h1>
      {vendor?.name && <p className="muted">{vendor.name}</p>}
      <Dashboard />
    </>
  );
}
