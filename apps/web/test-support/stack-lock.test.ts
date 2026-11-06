import { existsSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCK_GIVE_UP_MS, LOCK_REFRESH_MS, LOCK_STALE_MS, lockStack, type LockEnv } from './stack';

// WO-0074 item 4: the lock of the integration suites is refreshed while it is held. A fake clock and a fake interval timer; the lock directory is a real
// temporary one whose mtime is set from the fake clock, so the take-over rule is exercised on real files. Nothing really sleeps or waits.
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

type Timer = { fn: () => void; ms: number; next: number; unrefd: boolean; cleared: boolean; unref: () => void };
function world() {
  const base = mkdtempSync(join(tmpdir(), 'sparta-lock-test-'));
  dirs.push(base);
  const dir = join(base, 'lock');
  const clock = { now: Date.now() };   // starts at the real time so a directory made now has a believable mtime
  const timers: Timer[] = [];
  /** Advances the clock to `to`, running every live interval at the moment it falls due. */
  const tick = (to: number) => {
    for (;;) {
      const due = timers.filter((t) => !t.cleared && t.next <= to).sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      clock.now = due.next; due.next += due.ms; due.fn();
    }
    clock.now = to;
  };
  const env: LockEnv = {
    dir, now: () => clock.now,
    sleep: async (ms) => { tick(clock.now + ms); },
    every: (fn, ms) => { const t: Timer = { fn, ms, next: clock.now + ms, unrefd: false, cleared: false, unref() { t.unrefd = true; } }; timers.push(t); return t; },
    stop: (h) => { (h as Timer).cleared = true; },
  };
  const touch = (atMs: number) => utimesSync(dir, atMs / 1000, atMs / 1000);
  return { env, clock, timers, tick, dir, touch, mtime: () => statSync(dir).mtimeMs };
}

describe('lockStack keeps the lock fresh while it is held', () => {
  it('the three numbers are 10 s (refresh), 60 s (stale) and 100 s (give up)', () => {
    expect([LOCK_REFRESH_MS, LOCK_STALE_MS, LOCK_GIVE_UP_MS]).toEqual([10_000, 60_000, 100_000]);
  });
  it('touches the directory every 10 seconds from one unref\'d timer', async () => {
    const w = world();
    await lockStack(w.env);
    expect(w.timers.length).toBe(1); expect(w.timers[0]!.ms).toBe(10_000); expect(w.timers[0]!.unrefd).toBe(true);
    const t0 = w.clock.now;
    w.tick(t0 + 9_999); expect(Math.abs(w.mtime() - t0)).toBeLessThan(2_000);                  // not yet: still the creation time
    w.tick(t0 + 10_000); expect(Math.abs(w.mtime() - (t0 + 10_000))).toBeLessThan(5);
    w.tick(t0 + 95_000); expect(Math.abs(w.mtime() - (t0 + 90_000))).toBeLessThan(5);           // the last tick at or before 95 s is the one at 90 s
  });
  it('a suite that holds the lock for 150 s is never taken over by waiters that give up after 100 s', async () => {
    const w = world();
    await lockStack(w.env);
    await expect(lockStack(w.env)).rejects.toThrow('not released within 100 seconds');
    expect(existsSync(w.dir)).toBe(true);
    w.tick(w.clock.now + 50_000);                                                                // the holder is still going 150 s after it started
    await expect(lockStack(w.env)).rejects.toThrow('not released within 100 seconds');
    expect(existsSync(w.dir)).toBe(true);
  });
  it('a waiter gets the lock as soon as the holder releases it; the release clears the holder\'s timer', async () => {
    const w = world();
    const release = await lockStack(w.env);
    let got = false;
    const waiter = lockStack(w.env).then((r) => { got = true; return r; });
    await Promise.resolve();
    expect(got).toBe(false);
    release();
    expect(w.timers[0]!.cleared).toBe(true); expect(existsSync(w.dir)).toBe(false);
    const release2 = await waiter;
    expect(w.timers.length).toBe(2); expect(existsSync(w.dir)).toBe(true);
    release2(); expect(w.timers[1]!.cleared).toBe(true); expect(existsSync(w.dir)).toBe(false);
  });
  it('after the release no timer runs and the directory stays gone when the clock moves on', async () => {
    const w = world();
    const release = await lockStack(w.env); release();
    w.tick(w.clock.now + 120_000);
    expect(existsSync(w.dir)).toBe(false);
    expect(w.timers.every((t) => t.cleared)).toBe(true);
  });
  it('a refresh that finds the directory gone does not throw (released or taken over)', async () => {
    const w = world();
    await lockStack(w.env);
    rmSync(w.dir, { recursive: true });
    expect(() => w.tick(w.clock.now + 30_000)).not.toThrow();
  });
});

describe('a lock whose holder died is still taken over', () => {
  it('a directory untouched for more than 60 s is taken at once; one touched 59 s ago only after it passes 60 s', async () => {
    // the waiter polls every 250 ms and sleeps once more after it has removed the stale directory, so each wait has up to 500 ms of slack
    for (const [age, expectedWait] of [[61_000, 0], [59_000, 1_000]] as const) {
      const w = world();
      await lockStack(w.env);
      w.timers[0]!.cleared = true;                          // the holder died: no more refreshes
      w.touch(w.clock.now - age);
      const start = w.clock.now;
      const release = await lockStack(w.env);
      expect(w.clock.now - start).toBeGreaterThanOrEqual(expectedWait - 1); expect(w.clock.now - start).toBeLessThanOrEqual(expectedWait + 750);
      expect(w.timers.length).toBe(2); expect(existsSync(w.dir)).toBe(true);
      release();
    }
  });
  it('the take-over waits for the whole 60 s of silence when the holder simply stops refreshing', async () => {
    const w = world();
    await lockStack(w.env);
    const start = w.clock.now;
    w.timers[0]!.cleared = true;
    await lockStack(w.env);
    expect(w.clock.now - start).toBeGreaterThan(60_000); expect(w.clock.now - start).toBeLessThanOrEqual(60_000 + 1_000);
  });
});
