import { candidateList } from './unlock.js';
import type { UnlockOpts } from './unlock.js';
import { parsePrior } from './pairing.js';

/** What `engine_config` is built from: the four switch states (FR-59c). `prior`, `hm` are the data as loaded (a missing or invalid file counts as off). */
export interface EngineConfigOpts extends UnlockOpts { garmentModel?: 1 | 2; embeddingSwap?: boolean }

/** The `engine_config` string (LLD 12.3), for example `gm1;emb0;pair0;ul:fb;w:base`; `pair1` and `w:pairing` only when a valid prior is used, `ul:hm` only when the H&M list is asked for and valid. */
export function engineConfig(opts: EngineConfigOpts = {}): string {
  const pair = parsePrior(opts.prior) ? 1 : 0;
  return `gm${opts.garmentModel === 2 ? 2 : 1};emb${opts.embeddingSwap ? 1 : 0};pair${pair};ul:${candidateList(opts).source === 'hm' ? 'hm' : 'fb'};w:${pair ? 'pairing' : 'base'}`;
}
