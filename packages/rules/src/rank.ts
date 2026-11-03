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
 * pick the next, up to three; the third also avoids items in both earlier picks where an alternative exists.
 * Ties go to the smaller sorted item IDs, never to input order (FR-58).
 */
export function pickVariety(pool: readonly Scored[], limit = MAX_SUGGESTIONS): Scored[] {
  const chosen: Scored[] = [];
  const uses = new Map<string, number>();
  while (chosen.length < limit) {
    const shared = chosen.length >= 2 ? [...uses].filter(([, n]) => n === chosen.length).map(([id]) => id) : [];
    const choose = (strict: boolean): Scored | undefined => {
      let best: Scored | undefined;
      let bestScore = -Infinity;
      for (const c of pool) {
        if (chosen.includes(c) || (strict && c.ids.some((id) => shared.includes(id)))) continue;
        const score = c.evaluation.score - PENALTIES.variety_reuse * c.ids.filter((id) => uses.has(id)).length;
        const wins = !best || score > bestScore || (score === bestScore && (c.key < best.key || (c.key === best.key && c.order < best.order)));
        if (wins) [best, bestScore] = [c, score];
      }
      return best;
    };
    const next = choose(true) ?? choose(false);
    if (!next) break;
    chosen.push(next);
    for (const id of next.ids) uses.set(id, (uses.get(id) ?? 0) + 1);
  }
  return chosen;
}
