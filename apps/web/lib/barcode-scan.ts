import { normaliseGtin } from './gtin';

/** The camera scan of FR-26 (WO-0088), with everything it touches handed in so a test can use a fake stream. The camera starts only when `startScan` is called (the
 * person tapped "Scan with camera"); `stop()` stops EVERY track, ends the polling and detaches the stream, and is safe to call at any time and more than once, also
 * before the camera has answered. No frame is kept or sent anywhere: a frame is given to the detector and dropped; only the text of a code that looks like a barcode
 * number is passed on. */
export interface ScanStream { getTracks(): { stop(): void }[] }
export interface ScanDeps {
  getUserMedia(constraints: { video: { facingMode: string }; audio: false }): Promise<ScanStream>;
  detector: { detect(source: unknown): Promise<{ rawValue: string }[]> };
  video: { srcObject: unknown; play(): Promise<unknown> | void };
  /** Like setInterval; returns the function that cancels it. */
  every(fn: () => void, ms: number): () => void;
}
export const SCAN_INTERVAL_MS = 250;
export interface Scan { stop(): void }

export function startScan(deps: ScanDeps, onCode: (raw: string) => void, onError: () => void): Scan {
  let stopped = false;
  let stream: ScanStream | null = null;
  let cancel: (() => void) | null = null;
  const stop = () => {
    stopped = true;
    cancel?.(); cancel = null;
    stream?.getTracks().forEach((t) => t.stop()); stream = null;
    deps.video.srcObject = null;
  };
  deps.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(async (s) => {
    if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }   // closed before the camera answered: the camera is released at once
    stream = s;
    deps.video.srcObject = s;
    await deps.video.play();
    if (stopped) return;
    let busy = false;
    cancel = deps.every(() => {
      if (busy || stopped) return;
      busy = true;
      deps.detector.detect(deps.video).then((found) => {
        const code = found.map((f) => f.rawValue).find((v) => normaliseGtin(v) !== null);
        if (code !== undefined && !stopped) { stop(); onCode(code); }
      }, () => { /* a frame that cannot be read is skipped */ }).finally(() => { busy = false; });
    }, SCAN_INTERVAL_MS);
  }).catch(() => { if (!stopped) { stop(); onError(); } else stop(); });
  return { stop };
}
