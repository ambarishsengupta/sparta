import { engineConfig, parseCandidates, parsePrior } from '@sparta/rules';
import type { Candidate, PairingPrior, SuggestOpts, UnlockOpts } from '@sparta/rules';

/**
 * The learned-part switches of FR-59c that the web app owns. Defaults: pairing prior OFF, unlock list `fallback`, embedding swap OFF.
 * `NEXT_PUBLIC_EMBEDDING_SWAP_ENABLED` is a NO-OP for now: no look embeddings exist, so it only changes the `engine_config` string.
 * (`GARMENT_MODEL_VERSION` is worker-only and is not read here.)
 */
export interface Switches { pairingPrior: boolean; unlockList: 'fallback' | 'hm'; embeddingSwap: boolean }
const on = (v: string | undefined): boolean => v === 'true' || v === '1';
export function parseSwitches(env: Record<string, string | undefined>): Switches {
  return {
    pairingPrior: on(env.NEXT_PUBLIC_PAIRING_PRIOR_ENABLED),
    unlockList: env.NEXT_PUBLIC_UNLOCK_LIST === 'hm' ? 'hm' : 'fallback',
    embeddingSwap: on(env.NEXT_PUBLIC_EMBEDDING_SWAP_ENABLED),
  };
}
// Next inlines NEXT_PUBLIC_* only where `process.env.NAME` is written out, so each is spelled out here.
export const SWITCHES: Switches = parseSwitches({
  NEXT_PUBLIC_PAIRING_PRIOR_ENABLED: process.env.NEXT_PUBLIC_PAIRING_PRIOR_ENABLED,
  NEXT_PUBLIC_UNLOCK_LIST: process.env.NEXT_PUBLIC_UNLOCK_LIST,
  NEXT_PUBLIC_EMBEDDING_SWAP_ENABLED: process.env.NEXT_PUBLIC_EMBEDDING_SWAP_ENABLED,
});

/** What was loaded at run time. A missing or invalid file is `null`, which means that part is off. */
export interface Learned { prior: PairingPrior | null; hm: Candidate[] | null }
let learned: Learned = { prior: null, hm: null };
export const getLearned = (): Learned => learned;
export const setLearned = (next: Learned): void => { learned = next; };

// The only two network calls in the app: fixed GET URLs for the app's own static files, no body, no cookies, nothing about the wardrobe.
export const PRIOR_URL = '/pairing-prior-v1.json';
export const UNLOCK_URL = '/unlock-candidates.json';
const init = (): RequestInit => ({ method: 'GET', credentials: 'omit', signal: AbortSignal.timeout(5000) });

async function read<T>(get: () => Promise<Response>, parse: (raw: unknown) => T | null): Promise<T | null> {
  try {
    const res = await get();
    return res.ok ? parse(await res.json()) : null;
  } catch {
    return null; // missing, unreachable, not JSON or the wrong shape: that part stays off, nothing is shown to the person
  }
}
/** Fetches `/pairing-prior-v1.json` only when the pairing switch is on; null when it is off, missing or invalid. */
export const loadPrior = (s: Switches = SWITCHES): Promise<PairingPrior | null> =>
  s.pairingPrior ? read(() => fetch(PRIOR_URL, init()), parsePrior) : Promise.resolve(null);
/** Fetches `/unlock-candidates.json` only when `NEXT_PUBLIC_UNLOCK_LIST=hm`; null when off, missing or invalid. */
export const loadHmList = (s: Switches = SWITCHES): Promise<Candidate[] | null> =>
  s.unlockList === 'hm' ? read(() => fetch(UNLOCK_URL, init()), parseCandidates) : Promise.resolve(null);

/** Loads both files (when switched on) and remembers them. Never rejects. */
export async function loadLearned(s: Switches = SWITCHES): Promise<Learned> {
  const [prior, hm] = await Promise.all([loadPrior(s), loadHmList(s)]);
  return (learned = { prior, hm });
}

/** The engine's options for these switches and loaded data, and the `engine_config` string that describes them (FDD 16). */
export function engineOpts(s: Switches = SWITCHES, l: Learned = learned): { suggest: SuggestOpts; unlock: UnlockOpts; config: string } {
  const prior = s.pairingPrior ? l.prior : null;
  const unlock: UnlockOpts = { unlockList: s.unlockList, hm: l.hm, prior };
  return { suggest: { prior }, unlock, config: engineConfig({ ...unlock, embeddingSwap: s.embeddingSwap }) };
}
export const currentEngineConfig = (): string => engineOpts().config;
