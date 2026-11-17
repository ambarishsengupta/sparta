import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { a11yProblems } from '../../test-support/a11y';
import { itemRow } from '../../lib/supabase/mapping';
import { BarcodeLookup } from './BarcodeLookup';
import { scannerAvailable } from './BarcodeScanner';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('barcode lookup in the picker (FR-26, CC9)', () => {
  const out = renderToStaticMarkup(createElement(BarcodeLookup, { catalogue: { byGtin: async () => [] }, onResult: () => undefined }));
  it('typed entry is always there, named, numeric and not auto-completed; no camera control and no camera view without a browser that has the detector', () => {
    expect(out).toContain('aria-label="Find by barcode"');
    expect(out).toContain('Barcode number');
    expect(out).toContain('inputMode="numeric"');
    expect(out).toContain('autoComplete="off"');
    expect(out).toContain('Find by barcode</button>');
    expect(out).not.toContain('Scan with camera');
    expect(out).not.toContain('<video');
    expect(a11yProblems(out)).toEqual([]);
    expect(scannerAvailable()).toBe(false);   // node: no window, no BarcodeDetector
  });
  it('the camera starts only on a tap: the scanner is mounted behind the Scan button\'s state, and getUserMedia is named in the scan module alone', () => {
    const lookup = read('./BarcodeLookup.tsx');
    expect(lookup).toMatch(/\{scanning && <BarcodeScanner /);
    expect(lookup).toMatch(/onClick=\{\(\) => \{ setProblem\(''\); setScanning\(true\); \}\}/);
    expect(lookup).toMatch(/\{scannerAvailable\(\) && !scanning && /);
    const hits: string[] = [];
    const walk = (dir: string) => readdirSync(dir).forEach((n) => { const f = join(dir, n); if (n === 'node_modules' || n === '.next') return; if (statSync(f).isDirectory()) walk(f); else if (/\.tsx?$/.test(n) && !n.endsWith('.test.ts') && /getUserMedia/.test(readFileSync(f, 'utf8'))) hits.push(f.slice(f.indexOf('apps/web/') + 9)); });
    walk(new URL('../..', import.meta.url).pathname);
    expect(hits.sort()).toEqual(['components/catalogue/BarcodeScanner.tsx', 'lib/barcode-scan.ts']);
  });
  it('the scanner stops the scan when it unmounts (the effect\'s clean-up) and the Close button unmounts it', () => {
    const scanner = read('./BarcodeScanner.tsx');
    expect(scanner).toContain('return () => scan.stop();');
    expect(scanner).toMatch(/<button type="button" onClick=\{onClose\}>Close camera<\/button>/);
    expect(read('./BarcodeLookup.tsx')).toContain('onClose={() => setScanning(false)}');
  });
  it('no frame, image or code is sent: the scan and lookup modules hold no request, no canvas, no image capture and no storage', () => {
    for (const f of ['./BarcodeScanner.tsx', './BarcodeLookup.tsx', '../../lib/barcode-scan.ts', '../../lib/barcode-lookup.ts', '../../lib/gtin.ts']) {
      expect(read(f), f).not.toMatch(/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|canvas|toDataURL|toBlob|ImageCapture|MediaRecorder|localStorage|sessionStorage|indexedDB)\b/i);
    }
  });
  it('the picker handles the three outcomes: one match opens the pre-filled form, several are listed to choose from, none offers manual entry with the code', () => {
    const view = read('./CatalogueView.tsx');
    expect(view).toContain("if (r.kind === 'one') { setBarcode(null); setChosenCode(r.gtin); setChosen(r.item); }");
    expect(view).toContain("barcode.kind === 'none' ? noMatch(barcode.gtin) : severalMatches(barcode.items.length, barcode.gtin)");
    expect(view).toContain('href={addOwnWithBarcode(barcode.gtin)}');
    expect(view).toContain('barcode={chosenCode}');
  });
  it('the barcode is saved with the item only as 14 digits (items.barcode, LLD 4.8)', () => {
    const base = { name: 'x', category: 'Tops', subType: 'T-shirt', rgb: [1, 2, 3], hex: '#010203', colourFamily: 'Black', fit: null, material: null, pattern: null, seasons: [], occasions: [], condition: null, favourite: false, neverWorn: false, status: 'active', archiveReason: null } as never;
    expect(itemRow({ ...(base as object), barcode: '04006381333931' } as never, 'u1', 'NOW')).toMatchObject({ barcode: '04006381333931' });
    for (const bad of ['4006381333931', '0400638133393x', '', "04006381333931'--"]) expect(itemRow({ ...(base as object), barcode: bad } as never, 'u1', 'NOW')).not.toHaveProperty('barcode');
    expect(itemRow(base, 'u1', 'NOW')).not.toHaveProperty('barcode');
  });
  it('the new-item page reads ?barcode= through padGtin and keeps only a real barcode number', () => {
    const page = read('../../app/items/new/page.tsx');
    expect(page).toContain("typeof barcode === 'string' ? padGtin(barcode) : null");
  });
});
