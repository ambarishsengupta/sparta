import { notFound } from 'next/navigation';
import { AdminPilot } from '../../../components/admin/AdminPilot';
import { isNoLoginDemo } from '../../../lib/demo-mode';
import { dataBackend } from '../../../lib/supabase/config';

/** The end-of-pilot admin page (FR-69, BR-45). Only the account-backed app has administrators; every call it makes is checked again on the server (the routes check the role in the database). */
export default function Page() {
  if (isNoLoginDemo()) return <AdminPilot />;
  if (dataBackend() !== 'supabase') notFound();
  return <AdminPilot />;
}
