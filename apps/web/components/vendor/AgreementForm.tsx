'use client';
import { useRef, useState, type SubmitEvent } from 'react';
import { createBrowserSupabase } from '../../lib/supabase/browser';
import { messageOf } from '../../lib/supabase/errors';
import { acceptVendorAgreement } from '../../lib/vendor/access';

/** FR-94: one tick and Accept. The agreement above it is the file in legal/, shown unchanged; nothing else in the portal opens until this is recorded. */
export function AgreementForm() {
  const [agree, setAgree] = useState(false);
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    accept().catch((err: unknown) => { setBusy(false); setFailure(messageOf(err)); }); // a rejection is shown, never left unhandled
  }
  async function accept() {
    setFailure(null);
    setMissing(!agree);
    if (!agree) return box.current?.focus();
    setBusy(true);
    const out = await acceptVendorAgreement(createBrowserSupabase());
    if (out.ok) return window.location.assign('/vendor'); // the proxy now lets the vendor in
    setBusy(false);
    setFailure(out.message);
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <h2>Accept the agreement</h2>
      <label className="check" htmlFor="accept-vendor-agreement">
        <input id="accept-vendor-agreement" ref={box} type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); setMissing(false); }}
          aria-invalid={missing ? true : undefined} aria-describedby={missing ? 'accept-vendor-agreement-error' : undefined} />
        I have read the Vendor Pilot Agreement and accept it for my organisation.
      </label>
      {missing && <p id="accept-vendor-agreement-error" className="error" role="alert">Tick the box to accept the agreement.</p>}
      {failure && <p className="error" role="alert">{failure}</p>}
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Please wait' : 'Accept'}</button>
    </form>
  );
}
