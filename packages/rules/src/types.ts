import type { Category, ColourFamily, Occasion, Pattern, Season, SubType } from '@sparta/taxonomy';

export type ItemId = string;
export type Hemisphere = 'north' | 'south';
/** Outfit slots (LLD 9.5). The taxonomy's capitalised slot names map to these by lower-casing. */
export type Slot = 'top' | 'bottom' | 'layer' | 'footwear' | 'accessory';
/** The four seasons a date can fall in (a date is never "All year"). */
export type CurrentSeason = Exclude<Season, 'All year'>;

/** A wardrobe item as plain data (LLD 4.4 `app.items`, camel-cased, only what the engine reads). */
export interface Item {
  id: ItemId;
  name: string;
  category: Category;
  subType: SubType;
  rgb: readonly [r: number, g: number, b: number];
  colourFamily: ColourFamily;
  pattern: Pattern | null;
  seasons: readonly Season[];
  occasions: readonly Occasion[];
  condition: number | null;
  favourite: boolean;
  status: 'active' | 'archived';
}

export interface Ctx {
  occasion: Occasion;
  date: Date;
  hemisphere: Hemisphere;
}

export interface Suggestion {
  items: Record<Slot, ItemId | null>;
  score: number;
  reasons: string[];
  ruleIds: string[];
}

/** Returned instead of suggestions when the wardrobe is too thin (FR-54). */
export interface Missing {
  missing: string[];
}

/** R1 for one occasion. A slot with no list accepts any sub-type that can fill it. */
export interface OccasionRule {
  slots: Partial<Record<Exclude<Slot, 'accessory'>, SubType[]>>;
  forbidden_pairs: [footwear: SubType, bottom: SubType][];
  top_colour: 'dark_or_bold' | null;
}

export interface Rules {
  thresholds: { neutral_chroma_below: number; bold_chroma_above: number; dark_lightness_below: number };
  neutral_colour_families: ColourFamily[];
  cool_seasons: CurrentSeason[];
  unrated_condition: number;
  season_rules: Partial<Record<CurrentSeason, { excluded_sub_types: SubType[] }>>;
  occasions: Record<Occasion, OccasionRule | { uses: Occasion }>;
  weights_base: Record<string, number>;
  weights_with_pairing: Record<string, number>;
  unlock_min_rule_fit: number;
  /** Wardrobe unlock (LLD 9.5.2): the most items per slot that are tried with a pretend item. */
  unlock_bound_per_slot: number;
}

/** What `suggest` takes besides items and context (LLD 9.5.2, 7.9). `prior` is plain data, parsed defensively; the engine never fetches. */
export interface SuggestOpts {
  prior?: unknown;
  anchor?: ItemId;
}
