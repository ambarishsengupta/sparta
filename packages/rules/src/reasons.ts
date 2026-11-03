import rulesJson from '../data/rules.json';
import type { Evaluation } from './score.js';
import { seasonFor } from './season.js';
import type { Ctx } from './types.js';

/** The fixed sentence templates of R8 (rules.json `reason_templates`). */
export const REASON_TEMPLATES = rulesJson.reason_templates;
type TemplateKey = Exclude<keyof typeof REASON_TEMPLATES, 'note'>;

const fill = (key: TemplateKey, values: Record<string, string>): string =>
  REASON_TEMPLATES[key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');

/** "Navy", "Navy and grey", "Navy, grey and white". */
function listColours(families: readonly string[]): string {
  const names = families.map((f, i) => (i === 0 ? f : f.toLowerCase()));
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** R8: one fixed sentence per rule met. R1 and R2 always hold, so there is at least one reason. */
export function reasonsFor(evaluation: Evaluation, ctx: Ctx): { reasons: string[]; ruleIds: string[] } {
  const { rules, neutrals, cool, beltMatches } = evaluation;
  const season = seasonFor(ctx.date, ctx.hemisphere);
  const found: [string, string][] = [
    ['R1', fill('r1', { occasion: ctx.occasion })],
    ['R2', fill('r2', { season })],
  ];
  if (rules.R3 === 1) {
    found.push(['R3', neutrals.length === 0 ? fill('r3_harmony', {}) : fill(neutrals.length === 1 ? 'r3_neutral_one' : 'r3_neutral_many', { colours: listColours(neutrals) })]);
  }
  if (rules.R4 === 1) found.push(['R4', fill('r4', {})]);
  if (cool && rules.R5 === 1) found.push(['R5', fill('r5', {})]);
  if (beltMatches && rules.R6 === 1) found.push(['R6', fill('r6', {})]);
  return { reasons: found.map((f) => f[1]), ruleIds: found.map((f) => f[0]) };
}
