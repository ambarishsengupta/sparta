import { COLOUR_FAMILIES, SUB_TYPES } from '@sparta/taxonomy';
import type { Outfit } from './combinations.js';
import type { Item } from './types.js';

/** The four slot pairs of the pairing prior (LLD 7.9); the first slot supplies the first item. */
export const SLOT_PAIRS = ['Top+Bottom', 'Top+Footwear', 'Bottom+Footwear', 'Layer+Top'] as const;
export type SlotPair = (typeof SLOT_PAIRS)[number];
type Table = Partial<Record<SlotPair, Record<string, Record<string, number>>>>;
/** `pairing-prior-v1.json`: each x is sigmoid(clip(ln lift, -2, 2)); a missing entry is neutral (0.5). */
export interface PairingPrior { version: 1; min_pairs: number; type_pairs: Table; colour_pairs: Table }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
const logit = (x: number): number => Math.log(Math.max(x, 1e-6) / Math.max(1 - x, 1e-6));

/** A copy of a slot pair table, or null if a slot pair, a key or a number is not valid (keys must be taxonomy values, numbers 0 to 1). */
function table(raw: unknown, keys: readonly string[]): Table | null {
  if (!isObj(raw)) return null;
  const out: Record<string, Record<string, Record<string, number>>> = {};
  for (const [pair, firsts] of Object.entries(raw)) {
    if (!(SLOT_PAIRS as readonly string[]).includes(pair) || !isObj(firsts)) return null;
    const rows: Record<string, Record<string, number>> = (out[pair] = {});
    for (const [a, seconds] of Object.entries(firsts)) {
      if (!keys.includes(a) || !isObj(seconds)) return null;
      const row: Record<string, number> = (rows[a] = {});
      for (const [b, x] of Object.entries(seconds)) {
        if (!keys.includes(b) || typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) return null;
        row[b] = x;
      }
    }
  }
  return out as Table;
}

/** Reads a prior defensively: anything that is not exactly the documented format (missing, wrong version, unknown key, bad number) gives null, which means the prior is off. */
export function parsePrior(raw: unknown): PairingPrior | null {
  if (!isObj(raw) || Object.keys(raw).sort().join() !== 'colour_pairs,min_pairs,type_pairs,version') return null;
  const min = raw.min_pairs;
  const [type_pairs, colour_pairs] = [table(raw.type_pairs, SUB_TYPES), table(raw.colour_pairs, COLOUR_FAMILIES)];
  return raw.version === 1 && typeof min === 'number' && Number.isFinite(min) && min >= 0 && type_pairs && colour_pairs
    ? { version: 1, min_pairs: min, type_pairs, colour_pairs }
    : null;
}

/** The pair score of two items in a slot pair: sigmoid(logit(type x) + logit(colour x)), 0.5 when both are neutral or unknown. */
export function pairScore(prior: PairingPrior, pair: SlotPair, a: Item, b: Item): number {
  const type = prior.type_pairs[pair]?.[a.subType]?.[b.subType] ?? 0.5;
  const colour = prior.colour_pairs[pair]?.[a.colourFamily]?.[b.colourFamily] ?? 0.5;
  return sigmoid(logit(type) + logit(colour));
}

/** The `pairing` part of an outfit: the mean of the pair scores over its available slot pairs (a Suit counts in each slot it fills). */
export function outfitPairing(prior: PairingPrior, o: Outfit): number {
  const scores = SLOT_PAIRS.flatMap((pair) => {
    const [a, b] = pair.toLowerCase().split('+').map((s) => o[s as keyof Outfit]);
    return a && b ? [pairScore(prior, pair, a, b)] : [];
  });
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}
