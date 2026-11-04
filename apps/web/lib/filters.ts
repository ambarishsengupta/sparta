import type { Category, ColourFamily } from '@sparta/taxonomy';
import type { StoredItem } from './repository';

export interface WardrobeFilter {
  category: Category | '';
  colourFamily: ColourFamily | '';
  /** false = the active wardrobe, true = archived items only (FR-11, FR-15). */
  archived: boolean;
  favourite: boolean;
  neverWorn: boolean;
}
export const NO_FILTER: WardrobeFilter = { category: '', colourFamily: '', archived: false, favourite: false, neverWorn: false };

/** A flagged item, or one whose condition rating is 0, counts as never worn (FR-14). */
export const isNeverWorn = (item: StoredItem): boolean => item.neverWorn || item.condition === 0;

/** Filters combine with AND; the order of the list is kept. */
export function filterItems(items: readonly StoredItem[], f: WardrobeFilter): StoredItem[] {
  return items.filter(
    (i) =>
      (i.status === 'archived') === f.archived &&
      (!f.category || i.category === f.category) &&
      (!f.colourFamily || i.colourFamily === f.colourFamily) &&
      (!f.favourite || i.favourite) &&
      (!f.neverWorn || isNeverWorn(i)),
  );
}
