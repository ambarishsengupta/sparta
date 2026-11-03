import slots from './slots.json';
import taxonomy from './taxonomy.json';
import type {
  Category,
  ColourFamily,
  ConditionBand,
  Fit,
  Material,
  Occasion,
  Pattern,
  Season,
  SizeSystem,
  Slot,
  SlotAssignment,
  SlotFill,
  SubType,
} from './types.js';

export const CATEGORIES = taxonomy.categories.map((c) => c.name) as Category[];
export const COLOUR_FAMILIES = taxonomy.colourFamilies.map((c) => c.family) as ColourFamily[];
export const FITS = taxonomy.fit as Fit[];
export const MATERIALS = taxonomy.material as Material[];
export const PATTERNS = taxonomy.pattern as Pattern[];
export const SEASONS = taxonomy.seasons as Season[];
export const OCCASIONS = taxonomy.occasions as Occasion[];
export const CONDITION_BANDS = taxonomy.conditionBands.map((c) => c.code) as ConditionBand[];
export const SIZE_SYSTEMS = taxonomy.sizeSystems.map((s) => s.code) as SizeSystem[];
export const SLOTS = slots.slots as Slot[];

const subTypesByCategory = new Map<string, readonly string[]>(
  taxonomy.categories.map((c) => [c.name, c.subTypes]),
);
const categoryBySubType = new Map<string, Category>(
  taxonomy.categories.flatMap((c) => c.subTypes.map((s) => [s, c.name as Category] as const)),
);

/** All sub-types of a category, in dictionary order. */
export function subTypesOf(category: Category): readonly SubType[] {
  return (subTypesByCategory.get(category) ?? []) as SubType[];
}

export const SUB_TYPES = [...categoryBySubType.keys()] as SubType[];

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && subTypesByCategory.has(value);
}

/** True when subType is a sub-type of the given category (a sub-type belongs to one category). */
export function isSubType(category: unknown, subType: unknown): subType is SubType {
  return (
    typeof category === 'string' &&
    typeof subType === 'string' &&
    (subTypesByCategory.get(category) ?? []).includes(subType)
  );
}

/** The category a sub-type belongs to, or undefined if it is not a known sub-type. */
export function categoryOfSubType(subType: string): Category | undefined {
  return categoryBySubType.get(subType);
}

export function isColourFamily(value: unknown): value is ColourFamily {
  return typeof value === 'string' && (COLOUR_FAMILIES as string[]).includes(value);
}
export const isFit = (v: unknown): v is Fit => typeof v === 'string' && (FITS as string[]).includes(v);
export const isMaterial = (v: unknown): v is Material =>
  typeof v === 'string' && (MATERIALS as string[]).includes(v);
export const isPattern = (v: unknown): v is Pattern =>
  typeof v === 'string' && (PATTERNS as string[]).includes(v);
export const isSeason = (v: unknown): v is Season =>
  typeof v === 'string' && (SEASONS as string[]).includes(v);
export const isOccasion = (v: unknown): v is Occasion =>
  typeof v === 'string' && (OCCASIONS as string[]).includes(v);
export const isSizeSystem = (v: unknown): v is SizeSystem =>
  typeof v === 'string' && (SIZE_SYSTEMS as string[]).includes(v);

/** Condition band for a 0-100 score (LLD 4.2 seed), or undefined if out of range. */
export function conditionBandOf(score: number): ConditionBand | undefined {
  if (!Number.isInteger(score)) return undefined;
  const band = taxonomy.conditionBands.find((b) => score >= b.min && score <= b.max);
  return band?.code as ConditionBand | undefined;
}

// Slot map (FDD 14.1) indexed by sub-type.
const slotBySubType = new Map<string, SlotAssignment>();
for (const group of slots.groups) {
  for (const member of group.members) {
    const names =
      member.subTypes === 'all' ? (subTypesByCategory.get(member.category) ?? []) : member.subTypes;
    for (const name of names) {
      slotBySubType.set(name, {
        slots: group.slots as Slot[],
        fill: group.fill as SlotFill,
        suggested: group.suggested,
      });
    }
  }
}

/** How a sub-type fills the outfit slots (FDD 14.1), or undefined for an unknown sub-type. */
export function slotAssignmentOf(subType: string): SlotAssignment | undefined {
  return slotBySubType.get(subType);
}

/** The slots a sub-type can fill. Empty for sub-types that are never suggested. */
export function slotsOfSubType(subType: string): readonly Slot[] {
  return slotBySubType.get(subType)?.slots ?? [];
}

/** True when the sub-type may appear in suggestions (false for Underwear and socks). */
export function isSuggestable(subType: string): boolean {
  return slotBySubType.get(subType)?.suggested ?? false;
}

function duplicates(values: readonly string[]): string[] {
  return values.filter((v, i) => values.indexOf(v) !== i);
}

/**
 * Runtime consistency check of the taxonomy and slot map. Returns the list of problems
 * (empty when consistent); assertTaxonomy throws if there are any.
 */
export function taxonomyProblems(): string[] {
  const problems: string[] = [];
  const dup = (label: string, values: readonly string[]): void => {
    for (const d of duplicates(values)) problems.push(`duplicate ${label}: ${d}`);
  };

  dup('category', CATEGORIES);
  dup('sub-type', taxonomy.categories.flatMap((c) => c.subTypes));
  dup('colour family', COLOUR_FAMILIES);
  dup('fit', FITS);
  dup('material', MATERIALS);
  dup('pattern', PATTERNS);
  dup('season', SEASONS);
  dup('occasion', OCCASIONS);
  dup('condition band', CONDITION_BANDS);
  dup('size system', SIZE_SYSTEMS);
  dup('swatch', taxonomy.colourFamilies.flatMap((c) => c.swatches));

  if (COLOUR_FAMILIES.length !== 18) {
    problems.push(`expected 18 colour families, found ${COLOUR_FAMILIES.length}`);
  }
  for (const f of taxonomy.colourFamilies) {
    if (f.family === 'Multi') {
      if (f.swatches.length !== 0) problems.push('Multi must have no swatch');
    } else if (f.swatches.length === 0) {
      problems.push(`colour family ${f.family} has no swatch`);
    }
    for (const hex of f.swatches) {
      if (!/^#[0-9A-F]{6}$/.test(hex)) problems.push(`bad swatch hex for ${f.family}: ${hex}`);
    }
  }

  // Condition bands must tile 0-100 without gaps or overlaps.
  let expectedMin = 0;
  for (const b of taxonomy.conditionBands) {
    if (b.min !== expectedMin) problems.push(`condition band ${b.code} starts at ${b.min}, expected ${expectedMin}`);
    expectedMin = b.max + 1;
  }
  if (expectedMin !== 101) problems.push('condition bands do not end at 100');

  // Slot map: every member category and sub-type exists, each sub-type is mapped exactly once.
  const seen: string[] = [];
  for (const group of slots.groups) {
    for (const slot of group.slots) {
      if (!(SLOTS as string[]).includes(slot)) problems.push(`group ${group.id}: unknown slot ${slot}`);
    }
    for (const member of group.members) {
      const subs = subTypesByCategory.get(member.category);
      if (!subs) {
        problems.push(`group ${group.id}: unknown category ${member.category}`);
        continue;
      }
      const names = member.subTypes === 'all' ? subs : member.subTypes;
      for (const name of names) {
        if (!subs.includes(name)) {
          problems.push(`group ${group.id}: sub-type ${name} is not in category ${member.category}`);
        }
        seen.push(name);
      }
    }
  }
  dup('slot map entry', seen);
  for (const s of SUB_TYPES) {
    if (!seen.includes(s)) problems.push(`sub-type ${s} is missing from the slot map`);
  }

  // Occasion table: every occasion exists, each occasion listed once, all occasions covered.
  const tableOccasions = slots.occasionRules.map((o) => o.occasion);
  dup('occasion rule', tableOccasions);
  for (const o of slots.occasionRules) {
    if (!isOccasion(o.occasion)) problems.push(`occasion table: unknown occasion ${o.occasion}`);
    if (o.usesRuleOf !== null && !isOccasion(o.usesRuleOf)) {
      problems.push(`occasion table: ${o.occasion} uses unknown occasion ${o.usesRuleOf}`);
    }
  }
  for (const o of OCCASIONS) {
    if (!tableOccasions.includes(o)) problems.push(`occasion ${o} is missing from the occasion table`);
  }

  return problems;
}

/** Throws if the taxonomy or slot map is internally inconsistent. */
export function assertTaxonomy(): void {
  const problems = taxonomyProblems();
  if (problems.length > 0) {
    throw new Error(`Taxonomy is inconsistent:\n- ${problems.join('\n- ')}`);
  }
}
