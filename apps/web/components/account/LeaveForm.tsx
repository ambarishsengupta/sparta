'use client';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { clearSessionCookies, leaveThePilot } from './account-actions';
import { clearBrowserUsage } from './browser-data';
import { createBrowserSupabase } from '../../lib/supabase/browser';

/** FR-63, FR-66: the confirmation step. The password is asked again; nothing is deleted unless it is right. Afterwards the session cookies and the browser-only usage log are removed and the goodbye page opens. */
export function LeaveForm() {
  const [pw, setPw] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    setBusy(true);
    const out = await leaveThePilot(createBrowserSupabase(), pw);
    if (out.ok) {
      clearSessionCookies(document);
      clearBrowserUsage(); // the usage log and settings kept in this browser go with the account (WO-0062)
      return window.location.assign('/goodbye');
    }
    setBusy(false);
    setFailure(out.message);
    if (out.reason === 'credentials') pwRef.current?.focus();
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <label htmlFor="leave-pw">Your password</label>
      <input id="leave-pw" ref={pwRef} type="password" name="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)}
        aria-invalid={failure ? true : undefined} aria-describedby={failure ? 'leave-error' : undefined} />
      {failure && <p id="leave-error" className="error" role="alert">{failure}</p>}
      <button type="submit" className="danger" disabled={busy}>{busy ? 'Please wait' : 'Delete my account and leave the pilot'}</button>
      <Link href="/" className="button secondary">Cancel, keep my account</Link>
    </form>
  );
}
