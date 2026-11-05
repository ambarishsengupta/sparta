'use client';
import { useState } from 'react';
import { exportMyData } from './account-actions';
import { createBrowserSupabase } from '../../lib/supabase/browser';
import { downloadText } from './download';

/** FR-62: Export my data. The document comes from the database function (the signed-in person's own rows) and is saved by the browser as a file. */
export function ExportButton() {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function run() {
    setFailure(null);
    setSaved(null);
    setBusy(true);
    const out = await exportMyData(createBrowserSupabase());
    setBusy(false);
    if (!out.ok) return setFailure(out.message);
    downloadText(out.text, out.filename);
    setSaved(out.filename);
  }

  return (
    <div className="form">
      <button type="button" onClick={run} disabled={busy} aria-describedby="export-help">{busy ? 'Please wait' : 'Export my data'}</button>
      <p id="export-help" className="muted">Saves one file (JSON) with everything Sparta holds about you: your profile, your wardrobe, your outfits and your agreements.</p>
      <p role="status">{saved ? `Your data was saved as ${saved}.` : ''}</p>
      {failure && <p className="error" role="alert">{failure}</p>}
    </div>
  );
}
