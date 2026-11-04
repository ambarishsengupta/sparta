import { afterEach, describe, expect, it } from 'vitest';
import { parsePrior } from '@sparta/rules';
import prior from '../../../packages/rules/data/fixtures/pairing-prior.fixture.json';
import { setLearned } from './engine-config';
import type { Learned } from './engine-config';
import { settleLearned, startLearned } from './learned-state';
import type { LearnedState } from './learned-state';

const NONE: Learned = { prior: null, hm: null };
const loaded = (): Learned => ({ prior: parsePrior(prior), hm: null });
afterEach(() => setLearned(NONE));
const later = <T>() => { let done!: (v: T) => void; let fail!: (e: unknown) => void; const p = new Promise<T>((res, rej) => { done = res; fail = rej; }); return { p, done, fail }; };

describe('the useLearned state machine (Model QC Q24, Q25)', () => {
  it('starts not ready, holding whatever is already remembered', () => {
    expect(startLearned()).toEqual({ learned: NONE, ready: false });
    setLearned(loaded());
    expect(startLearned()).toEqual({ learned: loaded(), ready: false });
  });
  it('stays not ready while the load is pending: nothing is reported until it ends', async () => {
    const seen: LearnedState[] = [];
    const load = later<Learned>();
    const run = settleLearned(() => load.p, (s) => seen.push(s));
    await Promise.resolve();
    expect(seen).toEqual([]);
    load.done(loaded());
    await run;
    expect(seen).toEqual([{ learned: loaded(), ready: true }]);
  });
  it('turns ready with the loaded data when the load finishes, and with nulls when the files were missing', async () => {
    const seen: LearnedState[] = [];
    await settleLearned(async () => NONE, (s) => seen.push(s));
    expect(seen).toEqual([{ learned: NONE, ready: true }]);
  });
  it('turns ready, with what is remembered, when the load fails; it reports exactly once and never rejects', async () => {
    setLearned(loaded());
    const seen: LearnedState[] = [];
    await expect(settleLearned(() => Promise.reject(new Error('boom')), (s) => seen.push(s))).resolves.toBeUndefined();
    expect(seen).toEqual([{ learned: loaded(), ready: true }]);
    const again: LearnedState[] = [];
    await settleLearned(async () => loaded(), (s) => again.push(s));
    expect(again).toHaveLength(1);
  });
});
