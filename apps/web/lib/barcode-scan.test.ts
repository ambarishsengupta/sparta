import { describe, expect, it, vi } from 'vitest';
import { SCAN_INTERVAL_MS, startScan } from './barcode-scan';
import type { ScanDeps, ScanStream } from './barcode-scan';

// The camera scan (FR-26, CC9) with a fake MediaStream: started only on the call, every track stopped on stop and on every ending, nothing but the code text passed on.
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function rig(opts: { frames?: string[][]; media?: 'ok' | 'denied' | 'late'; playFails?: boolean } = {}) {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  const stream: ScanStream = { getTracks: () => tracks };
  let release: (s: ScanStream) => void = () => undefined;
  const getUserMedia = vi.fn(() => (opts.media === 'denied' ? Promise.reject(new Error('NotAllowedError')) : opts.media === 'late' ? new Promise<ScanStream>((r) => { release = r; }) : Promise.resolve(stream)));
  const frames = [...(opts.frames ?? [])];
  const detect = vi.fn(async (source: unknown) => { void source; return (frames.shift() ?? []).map((rawValue) => ({ rawValue })); });
  const video = { srcObject: null as unknown, play: vi.fn(async () => { if (opts.playFails) throw new Error('play failed'); }) };
  let tick: () => void = () => undefined;
  const cancel = vi.fn();
  const every = vi.fn((fn: () => void, ms: number) => { tick = fn; void ms; return cancel; });
  const deps: ScanDeps = { getUserMedia, detector: { detect }, video, every };
  return { deps, tracks, stream, getUserMedia, detect, video, every, cancel, tick: () => tick(), release: () => release(stream) };
}

describe('startScan', () => {
  it('asks for the rear camera with no audio, and only when called', async () => {
    const r = rig();
    expect(r.getUserMedia).not.toHaveBeenCalled();
    startScan(r.deps, () => undefined, () => undefined);
    expect(r.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' }, audio: false });
    await flush();
    expect(r.video.srcObject).toBe(r.stream);
    expect(r.video.play).toHaveBeenCalledTimes(1);
    expect(r.every).toHaveBeenCalledWith(expect.any(Function), SCAN_INTERVAL_MS);
  });
  it('stop() stops every track, ends the polling and detaches the stream; a second stop() changes nothing', async () => {
    const r = rig();
    const scan = startScan(r.deps, () => undefined, () => undefined);
    await flush();
    scan.stop();
    for (const t of r.tracks) expect(t.stop).toHaveBeenCalledTimes(1);
    expect(r.cancel).toHaveBeenCalledTimes(1);
    expect(r.video.srcObject).toBeNull();
    scan.stop();
    for (const t of r.tracks) expect(t.stop).toHaveBeenCalledTimes(1);
  });
  it('a code read ends the scan (all tracks stopped) and is passed on once, as text only', async () => {
    const r = rig({ frames: [[], ['not a barcode'], ['4006381333931', '12345670']] });
    const onCode = vi.fn();
    startScan(r.deps, onCode, () => undefined);
    await flush();
    for (let i = 0; i < 3; i++) { r.tick(); await flush(); }
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(onCode).toHaveBeenCalledWith('4006381333931');
    for (const t of r.tracks) expect(t.stop).toHaveBeenCalledTimes(1);
    expect(r.detect).toHaveBeenCalledTimes(3);
    expect(r.detect.mock.calls[0]![0]).toBe(r.video);
    r.tick(); await flush();
    expect(r.detect).toHaveBeenCalledTimes(3);   // no more frames are read once it ended
  });
  it('ignores values that are not barcode numbers (letters, wrong length)', async () => {
    const r = rig({ frames: [['https://shop.example.test/x'], ['123'], ['12345678901234567']] });
    const onCode = vi.fn();
    startScan(r.deps, onCode, () => undefined);
    await flush();
    for (let i = 0; i < 3; i++) { r.tick(); await flush(); }
    expect(onCode).not.toHaveBeenCalled();
    expect(r.tracks[0]!.stop).not.toHaveBeenCalled();
  });
  it('a stop() before the camera answers releases the stream the moment it arrives, and never starts reading', async () => {
    const r = rig({ media: 'late' });
    const scan = startScan(r.deps, () => undefined, () => undefined);
    scan.stop();
    r.release();
    await flush();
    for (const t of r.tracks) expect(t.stop).toHaveBeenCalledTimes(1);
    expect(r.every).not.toHaveBeenCalled();
    expect(r.video.srcObject).toBeNull();
  });
  it('a refused camera reports the error once and holds no track', async () => {
    const r = rig({ media: 'denied' });
    const onError = vi.fn();
    startScan(r.deps, () => undefined, onError);
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(r.every).not.toHaveBeenCalled();
  });
  it('a video that will not play stops every track and reports the error', async () => {
    const r = rig({ playFails: true });
    const onError = vi.fn();
    startScan(r.deps, () => undefined, onError);
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    for (const t of r.tracks) expect(t.stop).toHaveBeenCalledTimes(1);
  });
  it('a frame the detector cannot read is skipped and the next one is tried', async () => {
    const r = rig({ frames: [['9780201379624']] });
    r.detect.mockRejectedValueOnce(new Error('bad frame'));
    const onCode = vi.fn();
    startScan(r.deps, onCode, () => undefined);
    await flush();
    r.tick(); await flush();
    expect(onCode).not.toHaveBeenCalled();
    r.tick(); await flush();
    expect(onCode).toHaveBeenCalledWith('9780201379624');
  });
  it('reads one frame at a time: a tick while the detector is still busy does nothing', async () => {
    const r = rig();
    let done: (v: { rawValue: string }[]) => void = () => undefined;
    r.detect.mockImplementationOnce(() => new Promise((res) => { done = res; }));
    startScan(r.deps, () => undefined, () => undefined);
    await flush();
    r.tick(); r.tick(); r.tick();
    expect(r.detect).toHaveBeenCalledTimes(1);
    done([]); await flush();
    r.tick();
    expect(r.detect).toHaveBeenCalledTimes(2);
  });
});
