import { notFound } from 'next/navigation';
import { AdminCatalog } from '../../../components/admin/AdminCatalog';
import { isNoLoginDemo } from '../../../lib/demo-mode';
import { dataBackend } from '../../../lib/supabase/config';

/** The catalogue admin page (FR-100 to FR-103). Only the account-backed app has administrators; the proxy lets only the admin state in, and every call it makes is checked again on the server. */
export default function Page() {
  if (isNoLoginDemo()) return <AdminCatalog />;
  if (dataBackend() !== 'supabase') notFound();
  return <AdminCatalog />;
}
