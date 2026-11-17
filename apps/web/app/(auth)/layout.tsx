import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { dataBackend } from '../../lib/supabase/config';

/** The account pages exist only when the app runs against Supabase; with the local backend there is nothing to sign in to. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  if (dataBackend() !== 'supabase') notFound();
  return children;
}
