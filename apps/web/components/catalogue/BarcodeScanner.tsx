'use client';
import { useEffect, useRef } from 'react';
import { DEMO_BARCODES } from '../../lib/demo-barcodes';
import { startScan } from '../../lib/barcode-scan';
import type { ScanDeps } from '../../lib/barcode-scan';

type DetectorClass = new (options: { formats: string[] }) => ScanDeps['detector'];
/** The browser's own barcode detector, where it exists (FR-26); nothing is downloaded or installed. Typed entry works everywhere. */
export const scannerAvailable = (): boolean =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

/** The camera view. It is mounted only after the person taps "Scan with camera", and unmounting it (Close, a code read, leaving the page) stops every track. */
export function BarcodeScanner({ onCode, onClose, onError }: { onCode: (raw: string) => void; onClose: () => void; onError: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onCode, onError });
  callbacks.current = { onCode, onError };
  useEffect(() => {
    const el = video.current;
    if (!el || !scannerAvailable()) { callbacks.current.onError(); return; }
    const Detector = (window as unknown as { BarcodeDetector: DetectorClass }).BarcodeDetector;
    const scan = startScan(
      { getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c), detector: new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf'] }), video: el, every: (fn, ms) => { const t = setInterval(fn, ms); return () => clearInterval(t); } },
      (raw) => callbacks.current.onCode(raw), () => callbacks.current.onError(),
    );
    return () => scan.stop();
  }, []);
  return (
    <div className="form" role="group" aria-label="Scan a barcode with the camera">
      <video ref={video} muted playsInline aria-label="Camera view" />
      <p className="muted">Hold the barcode in front of the camera. Nothing you see here is saved or sent.</p>
      <button type="button" onClick={onClose}>Close camera</button>
    </div>
  );
}

let demoScans = 0; // each simulated scan in this tab hands over the next demo barcode
/** The simulated camera of the no-login demo: a dark viewfinder with a moving scan line; after about 2 seconds it "finds" the next demo barcode. It never asks for the camera. */
export function DemoBarcodeScanner({ onCode, onClose }: { onCode: (raw: string) => void; onClose: () => void }) {
  const callback = useRef(onCode);
  callback.current = onCode;
  useEffect(() => {
    const t = setTimeout(() => {
      const code = DEMO_BARCODES[demoScans++ % Math.max(DEMO_BARCODES.length, 1)];
      if (code) callback.current(code.gtin);
    }, 2000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="viewfinder" role="group" aria-label="Scan a barcode with the camera (demo)">
      <div className="viewfinder-frame" aria-hidden="true"><span className="scan-line" /></div>
      <p className="viewfinder-note" role="status">Looking for a barcode…</p>
      <button type="button" className="secondary" onClick={onClose}>Cancel</button>
    </div>
  );
}
