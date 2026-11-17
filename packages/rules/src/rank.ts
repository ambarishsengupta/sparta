import type { Outfit } from './combinations.js';
import { PENALTIES, itemsOf } from './score.js';
import type { Evaluation } from './score.js';

export const MAX_SUGGESTIONS = 3;
const SEP = '\u0001';
const SLOTS = ['top', 'bottom', 'layer', 'footwear', 'accessory'] as const;

/** A scored outfit with its tie-break keys: the sorted item IDs, then the IDs in slot order. */
export interface Scored {
  outfit: Outfit;
  evaluation: Evaluation;
  ids: string[];
  key: string;
  order: string;
}

export function toScored(outfit: Outfit, evaluation: Evaluation): Scored {
  const ids = itemsOf(outfit).map((i) => i.id);
  return { outfit, evaluation, ids, key: [...ids].sort().join(SEP), order: SLOTS.map((s) => outfit[s]?.id ?? '').join(SEP) };
}

/**
 * R7 variety: pick the best outfit, then take `variety_reuse` off any outfit for each item already chosen and
 * pick the next, up to three. An outfit whose item set was already chosen is skipped. The third pick first
 * avoids the items in both earlier picks that some remaining outfit can avoid (fewest of them, then score).
 * Ties go to the smaller sorted item IDs, never to input order (FR-58).
 */
export function pickVariety(pool: readonly Scored[], limit = MAX_SUGGESTIONS): Scored[] {
  const chosen: Scored[] = [];
  const uses = new Map<string, number>();
  const sets = new Set<string>();
  while (chosen.length < limit) {
    const rest = pool.filter((c) => !sets.has(c.key));
    const shared = new Set(chosen.length >= 2 ? [...uses].filter(([id, n]) => n === chosen.length && rest.some((c) => !c.ids.includes(id))).map(([id]) => id) : []);
    let best: Scored | undefined;
    let [bestShared, bestScore] = [0, -Infinity];
    for (const c of rest) {
      const avoidable = c.ids.filter((id) => shared.has(id)).length;
      const score = c.evaluation.score - PENALTIES.variety_reuse * c.ids.filter((id) => uses.has(id)).length;
      const wins = !best || avoidable < bestShared || (avoidable === bestShared && (score > bestScore || (score === bestScore && (c.key < best.key || (c.key === best.key && c.order < best.order)))));
      if (wins) [best, bestShared, bestScore] = [c, avoidable, score];
    }
    if (!best) break;
    chosen.push(best);
    sets.add(best.key);
    for (const id of best.ids) uses.set(id, (uses.get(id) ?? 0) + 1);
  }
  return chosen;
}
