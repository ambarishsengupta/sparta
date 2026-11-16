'use client';
import { useState } from 'react';
import { createBrowserSupabase } from '../../lib/supabase/browser';
import { messageOf } from '../../lib/supabase/errors';
import { acceptPilotNotice } from '../../lib/supabase/consent-actions';

/** The only way forward from the pilot notice (FR-4): the consent record is stored for the notice version this page showed. */
export function PilotNoticeForm({ noticeVersion }: { noticeVersion: string }) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function join() {
    accept().catch((err: unknown) => { setBusy(false); setFailure(messageOf(err)); }); // a rejection is shown, never left unhandled
  }
  async function accept() {
    setFailure(null);
    setBusy(true);
    const out = await acceptPilotNotice(createBrowserSupabase(), noticeVersion);
    if (out.ok) return window.location.assign('/'); // the proxy sends the person to the next step
    setBusy(false);
    setFailure(out.message);
  }

  return (
    <div className="form">
      {failure && <p className="error" role="alert">{failure}</p>}
      <button type="button" className="primary" onClick={join} disabled={busy}>{busy ? 'Please wait' : 'I understand and join the pilot'}</button>
    </div>
  );
}
