import { getLearned } from './engine-config';
import type { Learned } from './engine-config';

/** What the `useLearned` hook shows: the learned data so far, and whether loading has finished (or failed). */
export interface LearnedState { learned: Learned; ready: boolean }

/** Before any load has finished: whatever is already remembered, and not ready. */
export const startLearned = (): LearnedState => ({ learned: getLearned(), ready: false });

/**
 * Runs one load and reports the state when it ends. A load that finishes gives its data; one that fails (`loadLearned` itself never rejects, but a
 * rejection must not leave the page waiting) gives what is remembered. Either way `ready` becomes true, and never before the load has ended.
 */
export async function settleLearned(load: () => Promise<Learned>, report: (state: LearnedState) => void): Promise<void> {
  try {
    report({ learned: await load(), ready: true });
  } catch {
    report({ learned: getLearned(), ready: true });
  }
}
