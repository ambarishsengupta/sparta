'use client';
import { useState } from 'react';
import { BARCODE_FAILED, BARCODE_INVALID, SCAN_FAILED, lookupBarcode } from '../../lib/barcode-lookup';
import type { BarcodeResult } from '../../lib/barcode-lookup';
import type { CatalogueCollection } from '../../lib/catalogue';
import { DEMO_BARCODES, ean13Modules } from '../../lib/demo-barcodes';
import { isNoLoginDemo } from '../../lib/demo-mode';
import { BarcodeScanner, DemoBarcodeScanner, scannerAvailable } from './BarcodeScanner';

/** A demo barcode drawn as real EAN-13 bars: one rectangle per run of bars, with a quiet zone of 9 modules each side. */
function Bars({ gtin }: { gtin: string }) {
  const bits = ean13Modules(gtin);
  const runs: [number, number][] = [];
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') { const last = runs[runs.length - 1]; if (last && last[0] + last[1] === i) last[1]++; else runs.push([i, 1]); }
  return (
    <svg viewBox="0 0 113 48" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      <rect width="113" height="48" fill="#fff" />
      {runs.map(([x, w]) => <rect key={x} x={x + 9} y="2" width={w} height="44" fill="#000" />)}
    </svg>
  );
}

/** FR-26: type the number (always), or scan it where the browser can. The result goes to the picker: one match pre-fills the form, several are listed, none offers manual entry. */
export function BarcodeLookup({ catalogue, onResult }: { catalogue: Pick<CatalogueCollection, 'byGtin'>; onResult: (r: Extract<BarcodeResult, { kind: 'none' | 'one' | 'many' }>) => void }) {
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const demo = isNoLoginDemo();
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
        {(demo || scannerAvailable()) && !scanning && <button type="button" className="secondary" onClick={() => { setProblem(''); setScanning(true); }}>Scan with camera</button>}
      </form>
      {demo && DEMO_BARCODES.length > 0 && (
        <div className="demo-barcodes" role="group" aria-label="Try a demo barcode">
          <p className="muted">Try a demo barcode</p>
          <ul className="list">
            {DEMO_BARCODES.map((b) => (
              <li key={b.gtin}>
                <button type="button" className="demo-barcode" disabled={busy} aria-label={`Use demo barcode ${b.gtin}, ${b.label}`} onClick={() => { setCode(b.gtin); void find(b.gtin); }}>
                  <Bars gtin={b.gtin} />
                  <span className="digits">{b.gtin}</span>
                  <span className="label">{b.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {scanning && demo && <DemoBarcodeScanner onClose={() => setScanning(false)} onCode={(raw) => { setScanning(false); setCode(raw); void find(raw); }} />}
      {scanning && !demo && <BarcodeScanner onClose={() => setScanning(false)} onCode={(raw) => { setScanning(false); setCode(raw); void find(raw); }} onError={() => { setScanning(false); setProblem(SCAN_FAILED); }} />}
      {problem && <p role="alert" className="error">{problem}</p>}
    </section>
  );
}
