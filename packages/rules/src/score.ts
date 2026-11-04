import { conditionBandOf, rgbToLab } from '@sparta/taxonomy';
import type { ColourFamily } from '@sparta/taxonomy';
import rulesJson from '../data/rules.json';
import type { Outfit } from './combinations.js';
import { RULES, styleRule } from './eligibility.js';
import { seasonFor } from './season.js';
import type { Ctx, Item } from './types.js';

/** Draft penalty magnitudes for R3 to R7 (rules.json `penalties`, owned by the style specialist). */
export const PENALTIES = rulesJson.penalties;

/** The five parts of the base score (LLD 9.5.1). There is no `pairing` part until the prior exists (R4). */
export const PART_NAMES = ['rule_fit', 'occasion_fit', 'completeness', 'condition', 'favourites'] as const;
export type ScoreParts = Record<(typeof PART_NAMES)[number], number>;

/** How an outfit scored, and what the reasons (R8) need to know about it. */
export interface Evaluation {
  score: number;
  parts: ScoreParts;
  /** R3 to R6, each 1 when fully met. */
  rules: { R3: number; R4: number; R5: number; R6: number };
  neutrals: ColourFamily[];
  cool: boolean;
  beltMatches: boolean;
}

const SLOTS = ['top', 'bottom', 'layer', 'footwear', 'accessory'] as const;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1);

/** The distinct items of an outfit in slot order (a Suit fills two slots but counts once). */
export function itemsOf(outfit: Outfit): Item[] {
  const out: Item[] = [];
  for (const s of SLOTS) {
    const item = outfit[s];
    if (item && !out.some((o) => o.id === item.id)) out.push(item);
  }
  return out;
}

/** A scorer for one request; `hasBelts` makes the belt check of `completeness` apply. Chroma is cached per item. */
export function createScorer(ctx: Ctx, hasBelts: boolean) {
  const cool = RULES.cool_seasons.includes(seasonFor(ctx.date, ctx.hemisphere));
  const profiles = new Map<string, { neutral: boolean; bold: boolean }>();
  const profile = (item: Item): { neutral: boolean; bold: boolean } => {
    let p = profiles.get(item.id);
    if (!p) {
      const [, a, b] = rgbToLab(...item.rgb);
      const chroma = Math.sqrt(a * a + b * b);
      const neutral = RULES.neutral_colour_families.includes(item.colourFamily) || chroma < RULES.thresholds.neutral_chroma_below;
      p = { neutral, bold: !neutral && chroma > RULES.thresholds.bold_chroma_above };
      profiles.set(item.id, p);
    }
    return p;
  };

  const maxFamilies = styleRule(ctx.occasion).max_non_neutral_families ?? 3;
  const clashes = rulesJson.clashing_family_pairs as [ColourFamily, ColourFamily][];
  /** R3: at most three non-neutral colour families (two for Work, Formal and Date), at most one bold item, no clashing pair of families. */
  const harmony = (items: readonly Item[]): number => {
    const families = new Set(items.filter((i) => !profile(i).neutral).map((i) => i.colourFamily));
    const bold = items.filter((i) => profile(i).bold).length;
    const clashing = clashes.filter(([a, b]) => families.has(a) && families.has(b)).length;
    return clamp01(1 - PENALTIES.families_over_three * Math.max(0, families.size - maxFamilies) - PENALTIES.extra_bold * Math.max(0, bold - 1) - PENALTIES.clashing_pair * clashing);
  };

  const evaluate = (outfit: Outfit): Evaluation => {
    const items = itemsOf(outfit);
    const { top, layer, footwear, accessory: belt } = outfit;
    const patterned = items.filter((i) => i.pattern !== null && i.pattern !== 'Solid').length;
    const beltMatches = !!belt && !!footwear && belt.colourFamily === footwear.colourFamily;
    const R3 = harmony(items);
    const R4 = clamp01(1 - PENALTIES.extra_pattern * Math.max(0, patterned - 1));
    const R5 = !cool ? 1 : !layer ? 1 - PENALTIES.missing_layer : layer.colourFamily === top?.colourFamily ? 1 - PENALTIES.layer_same_family : 1;
    const R6 = belt && !beltMatches ? 1 - PENALTIES.belt_shoe_mismatch : 1;
    const checks = [...(cool ? [layer ? 1 : 0] : []), ...(hasBelts ? [beltMatches ? 1 : 0] : [])];
    const parts: ScoreParts = {
      rule_fit: mean([R3, R4, R5, R6]),
      occasion_fit: mean(items.map((i) => (i.occasions.length === 0 ? 0.5 : i.occasions.includes(ctx.occasion) ? 1 : 0))),
      completeness: mean(checks),
      condition: mean(items.map((i) => (i.condition === null ? RULES.unrated_condition : conditionBandOf(i.condition) === 'Falling apart' ? 0 : 1 - i.condition / 100))),
      favourites: mean(items.map((i) => (i.favourite ? 1 : 0))),
    };
    const score = PART_NAMES.reduce((sum, k) => sum + (RULES.weights_base[k] ?? 0) * parts[k], 0);
    const neutrals = [...new Set(items.filter((i) => profile(i).neutral).map((i) => i.colourFamily))];
    return { score, parts, rules: { R3, R4, R5, R6 }, neutrals, cool, beltMatches };
  };

  return { evaluate, harmony };
}
