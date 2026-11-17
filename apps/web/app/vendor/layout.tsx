import type { ReactNode } from 'react';
import { dataBackend } from '../../lib/supabase/config';

/** The vendor portal exists only on the account-backed app. With the local backend it says so and renders none of its pages, so nothing is called. The header (Dashboard, Gaps, Reports, Account, Sign out, and the Demo label) is components/Nav.tsx, which the root layout draws. */
export default function VendorLayout({ children }: { children: ReactNode }) {
  if (dataBackend() !== 'supabase') return <><h1>Vendor portal</h1><p>The vendor portal needs the account service.</p></>;
  return children;
}
