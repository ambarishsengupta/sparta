// Writes workflow/evidence/R1/review-pack.md for the style reviewer (FDD 14.4). Run: npm run review-pack -w @sparta/rules
import { mkdirSync, writeFileSync } from 'node:fs';
import { OCCASIONS, rgbToLab } from '@sparta/taxonomy';
import type { Occasion } from '@sparta/taxonomy';
import { independentProblems } from '../src/fixtures/checker.js';
import { WARDROBES } from '../src/fixtures/wardrobes.js';
import { PART_NAMES, isMissing, seasonFor, suggest } from '../src/index.js';
import type { Ctx, Item, Slot } from '../src/index.js';

const MONTHS = [1, 4, 7, 10]; // northern hemisphere: winter, spring, summer, autumn (the 15th of each month, 2026)
const LABEL: Record<Slot, string> = { top: 'Top', bottom: 'Bottom', layer: 'Layer', footwear: 'Shoes', accessory: 'Belt' };
const cell = (s: string): string => s.replace(/\|/g, '/');
let total = 0, missing = 0;
const producing: string[] = []; // wardrobes that gave at least one suggestion; only these count towards the target

/** One suggestion row with the items it uses, so the self-check can look at it. */
interface Row { wardrobe: string; ctx: Ctx; season: string; outfit: Record<Slot, Item | null>; reasons: string[]; items: Item[] }
const rows: Row[] = [];

const sections = Object.entries(WARDROBES).map(([name, items]) => {
  const before = total;
  const byId = new Map(items.map((i) => [i.id, i]));
  const table = ['| Occasion | Season | # | Outfit | Score | rule_fit | occasion_fit | completeness | condition | favourites | Reasons | OK? |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const occasion of OCCASIONS) {
    for (const month of MONTHS) {
      const ctx: Ctx = { occasion, hemisphere: 'north', date: new Date(Date.UTC(2026, month - 1, 15)) };
      const season = seasonFor(ctx.date, ctx.hemisphere);
      const result = suggest(items, ctx);
      if (isMissing(result)) {
        missing++;
        table.push(`| ${occasion} | ${season} | - | Nothing to suggest: missing ${result.missing.join(', ')} | | | | | | | | |`);
        continue;
      }
      result.forEach((s, n) => {
        total++;
        rows.push({ wardrobe: name, ctx, season, reasons: s.reasons, items, outfit: Object.fromEntries((Object.keys(LABEL) as Slot[]).map((k) => [k, byId.get(s.items[k] ?? '') ?? null])) as Record<Slot, Item | null> });
        const seen = new Set<string>();
        const outfit = (Object.keys(LABEL) as Slot[]).flatMap((slot) => {
          const id = s.items[slot];
          if (!id || seen.has(id)) return [];
          seen.add(id);
          const both = slot === 'bottom' && s.items.layer === id ? ' (also layer)' : '';
          return [`${LABEL[slot]}: ${(byId.get(id) as Item).name}${both}`];
        });
        const parts = PART_NAMES.map((k) => s.parts[k].toFixed(2));
        table.push(`| ${occasion} | ${season} | ${n + 1} | ${cell(outfit.join('; '))} | ${s.score.toFixed(3)} | ${parts.join(' | ')} | ${cell(s.reasons.join('; '))} | |`);
      });
    }
  }
  if (total > before) producing.push(name);
  const list = items.map((i) => `- ${i.name} (${i.subType}, ${i.colourFamily}${i.pattern && i.pattern !== 'Solid' ? `, ${i.pattern}` : ''}${i.status === 'archived' ? ', archived' : ''})`);
  return [`## ${name}`, '', `${items.length} items:`, '', ...list, '', ...table, ''].join('\n');
});

/**
 * The self-check (WO-0007): counts rows that still hit each of the five problems of the AI style review. The predicates are written
 * here from the review's wording and read nothing from rules.json or the engine, so a rule the engine lost shows up as a count above zero.
 */
const NEUTRAL = ['Black', 'White', 'Grey', 'Navy', 'Beige', 'Khaki', 'Olive', 'Brown'];
const CLASH = [['Red', 'Purple'], ['Red', 'Yellow'], ['Pink', 'Yellow'], ['Pink', 'Purple'], ['Green', 'Red']];
const chroma = (i: Item): number => Math.hypot(rgbToLab(...i.rgb)[1], rgbToLab(...i.rgb)[2]);
const colourful = (i: Item): boolean => !NEUTRAL.includes(i.colourFamily) && chroma(i) >= 10;
const families = (r: Row): Set<string> => new Set(Object.values(r.outfit).filter((i): i is Item => !!i && colourful(i)).map((i) => i.colourFamily));
const worn = (r: Row, ...subs: string[]): boolean => Object.values(r.outfit).some((i) => !!i && subs.includes(i.subType));
const inOcc = (r: Row, ...o: Occasion[]): boolean => o.includes(r.ctx.occasion);
const bolds = (r: Row, slots: Slot[]): number => new Set(slots.map((s) => r.outfit[s]).filter((i) => i && !NEUTRAL.includes(i.colourFamily) && chroma(i) > 50)).size;
const CHECKS: [problem: string, kind: string, test: (r: Row) => boolean][] = [
  ['1. Two colour families that clash (Red/Purple, Red/Yellow, Pink/Yellow, Pink/Purple, Green/Red)', 'scored (R3 -0.3)', (r) => CLASH.some(([a, b]) => families(r).has(a!) && families(r).has(b!))],
  ['1. More than two non-neutral colour families in Work, Formal or Date', 'scored (R3 -0.34)', (r) => inOcc(r, 'Work', 'Formal', 'Date') && families(r).size > 2],
  ['2. Sports T-shirt, Sports shorts or Track pants in Date or Travel', 'hard', (r) => inOcc(r, 'Date', 'Travel') && worn(r, 'Sports T-shirt', 'Sports shorts', 'Track pants')],
  ['2. A Sport layer other than Track jacket, Hoodie or Jacket', 'hard', (r) => inOcc(r, 'Sport') && !!r.outfit.layer && !['Track jacket', 'Hoodie', 'Jacket'].includes(r.outfit.layer.subType)],
  ['3. Shorts or Sandals in Winter, Sports shorts in Winter outside Sport, Sandals in Autumn', 'hard', (r) => (r.season === 'Winter' && (worn(r, 'Shorts', 'Sandals') || (!inOcc(r, 'Sport') && worn(r, 'Sports shorts')))) || (r.season === 'Autumn' && worn(r, 'Sandals'))],
  ['3. No layer in Autumn or Winter although the wardrobe can make a layered outfit', 'hard', (r) => ['Autumn', 'Winter'].includes(r.season) && independentProblems(r.outfit, r.ctx, r.items).includes('LAYER')],
  ['4. Suit or Tuxedo as a Casual or Travel bottom', 'hard', (r) => inOcc(r, 'Casual', 'Travel') && worn(r, 'Suit', 'Tuxedo')],
  ['4. Formal shoes with a T-shirt, Polo or Hoodie in Casual, Date or Travel', 'hard', (r) => inOcc(r, 'Casual', 'Date', 'Travel') && worn(r, 'Formal shoes') && worn(r, 'T-shirt', 'Polo', 'Hoodie')],
  ['4. Formal without a blazer or suit although the wardrobe has one', 'hard', (r) => inOcc(r, 'Formal') && independentProblems(r.outfit, r.ctx, r.items).includes('LAYER')],
  ['5. Work layer that is a Hoodie, Track jacket or Jacket', 'hard', (r) => inOcc(r, 'Work') && !!r.outfit.layer && ['Hoodie', 'Track jacket', 'Jacket'].includes(r.outfit.layer.subType)],
  ['5. Printed or Graphic top in Work', 'hard', (r) => inOcc(r, 'Work') && ['Printed', 'Graphic'].includes(r.outfit.top?.pattern ?? '')],
  ['5. More than one bold item in Work (top, bottom, layer, shoes)', 'hard', (r) => inOcc(r, 'Work') && bolds(r, ['top', 'bottom', 'layer', 'footwear']) > 1],
  ['5. More than one bold item in Work, counting the belt', 'scored (R3 -0.34)', (r) => inOcc(r, 'Work') && bolds(r, ['top', 'bottom', 'layer', 'footwear', 'accessory']) > 1],
  ['5. A reason that says "Every piece is tagged" while a piece is not tagged for the occasion', 'reason text', (r) => r.reasons.some((x) => x.startsWith('Every piece is tagged')) && r.items.length > 0 && Object.values(r.outfit).some((i) => !!i && !i.occasions.includes(r.ctx.occasion))],
  ['5. A reason in the old wording ("Every piece suits ...")', 'reason text', (r) => r.reasons.some((x) => x.startsWith('Every piece suits'))],
  ['Any hard rule, by the independent checker (with the wardrobe, so the layer rule too)', 'hard', (r) => independentProblems(r.outfit, r.ctx, r.items).length > 0],
];
const found = CHECKS.map(([problem, kind, test]) => ({ problem, kind, hits: rows.filter(test) }));
const selfCheck = `## Self-check (computed by the script)

Counts the suggestions in this pack (${total}) that still hit each problem of the AI style review (2026-11-04, pending Arpan Shah). Hard rules must show 0; scored rules (colour) can show rows where the wardrobe has no better outfit.

| Problem | Kind | Rows | Share of ${total} |
|---|---|---|---|
${found.map((f) => `| ${f.problem} | ${f.kind} | ${f.hits.length} | ${((100 * f.hits.length) / total).toFixed(1)}% |`).join('\n')}

${found.some((f) => f.hits.length > 0) ? 'Rows hit:\n\n' + found.filter((f) => f.hits.length > 0).map((f) => `- ${f.problem}: ${f.hits.slice(0, 8).map((r) => `${r.wardrobe} / ${r.ctx.occasion} / ${r.season}`).join('; ')}${f.hits.length > 8 ? `; and ${f.hits.length - 8} more` : ''}`).join('\n') : 'No row hits any problem.'}

`;

const header = `# R1 style review pack

Generated by \`npm run review-pack -w @sparta/rules\` from the five synthetic menswear wardrobes in \`packages/rules/src/fixtures/wardrobes.ts\`.
Deterministic: the same command always writes the same file. Northern hemisphere; one date per season (15 January, April, July, October 2026).

**This pack has ${total} suggestions from ${producing.length} wardrobes that each produced at least one suggestion.** ${Object.keys(WARDROBES).length} wardrobes were run; a wardrobe with no suggestion is not counted${producing.length < Object.keys(WARDROBES).length ? ` (none from ${Object.keys(WARDROBES).filter((n) => !producing.includes(n)).join(', ')})` : ''}. ${missing} occasion-and-season cases returned "missing" instead (no valid outfit exists for that occasion in that wardrobe). Acceptance target (FDD 14.4): at least 50 suggestions from at least 5 wardrobes, about 80% acceptable.

## What the style reviewer checks

Read every row as a man looking at the outfit on a bed. Mark the last column \`Y\` (acceptable) or \`N\` (not), with a short note for each N. Then report acceptable / total.

1. **Occasion.** Does every piece suit the occasion (a hard rule, R1)? Work: shirt or polo (no Printed or Graphic), chinos or trousers, closed shoes, a layer other than Hoodie, Track jacket or Jacket, at most one bold item. Formal: shirt, tailored trousers or suit, formal shoes. Party: dark or bold top, jeans or trousers, sneakers or boots. Sport: activewear and sneakers, a layer only Track jacket, Hoodie or Jacket. Casual, Date and Travel: no formal shoes with shorts, T-shirt, Polo or Hoodie; Casual has no Suit or Tuxedo; Date has no activewear; Travel has neither activewear nor Suit or Tuxedo.
2. **Season.** Nothing too heavy in summer (no coats, sweaters, cardigans), no shorts or sandals in winter (Sport keeps sports shorts), no sandals in autumn, and nothing in the wrong season tag (R2). In autumn and winter, and for Formal, there must be a layer wherever the wardrobe has one (decision D-A); R5 scores the layer.
3. **Colour.** Neutrals with at most one bold item, no more than three colour families, two for Work, Formal and Date, and no Red/Purple, Red/Yellow, Pink/Yellow, Pink/Purple or Green/Red pair (R3, scored). Flag clashing colours the rule cannot see.
4. **Pattern.** At most one patterned item (R4). Flag two busy patterns that slip through (for example stripes with a print).
5. **Shoes and belt.** Belt and shoes in the same colour family (R6). Flag shoes that are technically allowed but wrong (sandals with a blazer, running shoes with trousers).
6. **Variety.** The up-to-three suggestions for one occasion and season should differ, not be one outfit with a sock swapped (R7).
7. **Reasons.** Each reason must be true for the outfit and read naturally (R8); "Every piece is tagged for ..." appears only when every piece carries the occasion tag.
8. **Score parts.** rule_fit, occasion_fit, completeness, condition and favourites are each 0 to 1; the score is 0.50, 0.20, 0.10, 0.10, 0.10 of them. Flag any outfit whose score looks wrong against how good it looks.

Draft data note: the penalty sizes, the neutral colour list and the sub-type choices behind the rules are drafts owned by the style specialist; findings here feed those values. The rules adopted from the AI style review (2026-11-04) are pending Arpan Shah's review.

`;

const out = new URL('../../../workflow/evidence/R1/review-pack.md', import.meta.url);
mkdirSync(new URL('./', out), { recursive: true });
writeFileSync(out, `${header}${selfCheck}${sections.join('\n')}`);
console.log(`review pack: ${total} suggestions from ${producing.length} of ${Object.keys(WARDROBES).length} wardrobes, ${missing} missing cases -> workflow/evidence/R1/review-pack.md`);
console.log(found.map((f) => `${String(f.hits.length).padStart(3)}  ${f.problem}`).join('\n'));
