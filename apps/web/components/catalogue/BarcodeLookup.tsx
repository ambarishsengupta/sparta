'use client';
import { useState } from 'react';
import { BARCODE_FAILED, BARCODE_INVALID, SCAN_FAILED, lookupBarcode } from '../../lib/barcode-lookup';
import type { BarcodeResult } from '../../lib/barcode-lookup';
import type { CatalogueCollection } from '../../lib/catalogue';
import { BarcodeScanner, scannerAvailable } from './BarcodeScanner';

/** FR-26: type the number (always), or scan it where the browser can. The result goes to the picker: one match pre-fills the form, several are listed, none offers manual entry. */
export function BarcodeLookup({ catalogue, onResult }: { catalogue: Pick<CatalogueCollection, 'byGtin'>; onResult: (r: Extract<BarcodeResult, { kind: 'none' | 'one' | 'many' }>) => void }) {
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const find = async (raw: string) => {
    setProblem(''); setBusy(true);
    try {
      const r = await lookupBarcode(catalogue, raw);
      if (r.kind === 'invalid') setProblem(BARCODE_INVALID); else onResult(r);
    } catch { setProblem(BARCODE_FAILED); } finally { setBusy(false); }
  };
  return (
    <section aria-label="Find by barcode">
      <form className="row" onSubmit={(e) => { e.preventDefault(); void find(code); }}>
        <label>Barcode number
          <input type="text" inputMode="numeric" autoComplete="off" value={code} maxLength={24} onChange={(e) => setCode(e.target.value)} />
        </label>
        <button type="submit" disabled={busy}>Find by barcode</button>
        {scannerAvailable() && !scanning && <button type="button" className="secondary" onClick={() => { setProblem(''); setScanning(true); }}>Scan with camera</button>}
      </form>
      {scanning && <BarcodeScanner onClose={() => setScanning(false)} onCode={(raw) => { setScanning(false); setCode(raw); void find(raw); }} onError={() => { setScanning(false); setProblem(SCAN_FAILED); }} />}
      {problem && <p role="alert" className="error">{problem}</p>}
    </section>
  );
}
