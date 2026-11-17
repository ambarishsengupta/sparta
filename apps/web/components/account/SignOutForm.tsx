'use client';
import type { ReactNode } from 'react';
import { clearBrowserUsage } from './browser-data';

/**
 * Sign out: a plain POST form (it works without scripts, and a link or an image cannot sign anyone out). With scripts it first removes the usage log and
 * settings kept in this browser (WO-0062), then lets the form post go ahead; it never cancels the post.
 */
export function SignOutForm({ label = 'Sign out', className, buttonClassName, children }: { label?: string; className?: string; buttonClassName?: string; children?: ReactNode }) {
  return (
    <form action="/auth/sign-out" method="post" className={className} onSubmit={() => { clearBrowserUsage(); }}>
      {children}
      <button type="submit" className={buttonClassName}>{label}</button>
    </form>
  );
}
