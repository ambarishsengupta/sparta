import {
  CATEGORIES, colourFamily, hexToRgb, isCategory, isFit, isMaterial, isOccasion, isPattern, isSeason, isSubType, subTypesOf,
} from '@sparta/taxonomy';
import type { Category, ColourFamily, Fit, Material, Occasion, Pattern, Season, SubType } from '@sparta/taxonomy';
import type { ItemInput, StoredItem } from './repository';

export const NAME_MAX = 80;
export const DEFAULT_HEX = '#808080';

/** What the add/edit form holds. Empty strings mean "not chosen". */
export interface ItemFormValues {
  category: Category | '';
  subType: SubType | '';
  hex: string;
  name: string;
  /** True once the user typed a name; until then the name follows colour and sub-type (FDD 13). */
  nameEdited: boolean;
  fit: Fit | '';
  material: Material | '';
  pattern: Pattern | '';
  seasons: Season[];
  occasions: Occasion[];
  condition: number | null;
  favourite: boolean;
  neverWorn: boolean;
}

export type FormErrors = Partial<Record<'category' | 'subType' | 'hex' | 'name' | 'condition' | 'fit' | 'material' | 'pattern' | 'seasons' | 'occasions', string>>;
export type FormResult = { ok: true; input: ItemInput } | { ok: false; errors: FormErrors };

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Colour family of a `#rrggbb` string, or null when it is not a valid hex colour. */
export function familyOfHex(hex: string): ColourFamily | null {
  return HEX.test(hex) ? colourFamily(...hexToRgb(hex)) : null;
}

/** Default name: colour family plus sub-type, e.g. "Navy Shirt". Empty until both are known. */
export function autoName(hex: string, subType: SubType | ''): string {
  const family = familyOfHex(hex);
  return family && subType ? `${family} ${subType}` : '';
}

export function emptyForm(): ItemFormValues {
  return {
    category: '', subType: '', hex: DEFAULT_HEX, name: '', nameEdited: false, fit: '', material: '', pattern: '',
    seasons: [], occasions: [], condition: null, favourite: false, neverWorn: false,
  };
}

export function formFromItem(item: StoredItem): ItemFormValues {
  return {
    category: item.category, subType: item.subType, hex: item.hex, name: item.name,
    nameEdited: item.name !== autoName(item.hex, item.subType), fit: item.fit ?? '', material: item.material ?? '',
    pattern: item.pattern ?? '', seasons: [...item.seasons], occasions: [...item.occasions], condition: item.condition,
    favourite: item.favourite, neverWorn: item.neverWorn,
  };
}

/** Apply a change and keep the dependent fields right: sub-type must belong to the category; the name follows until edited. */
export function updateForm(values: ItemFormValues, patch: Partial<ItemFormValues>): ItemFormValues {
  const next: ItemFormValues = { ...values, ...patch };
  if (patch.category !== undefined && next.subType && !isSubType(next.category, next.subType)) next.subType = '';
  if ('name' in patch) next.nameEdited = next.name.trim() !== '';
  if (!next.nameEdited) next.name = autoName(next.hex, next.subType);
  return next;
}

/** Validate the form. On success returns the item to store, with the colour family derived from the hex (never typed by the user). */
export function validateForm(values: ItemFormValues): FormResult {
  const errors: FormErrors = {};
  if (!isCategory(values.category)) errors.category = 'Choose a category.';
  else if (!isSubType(values.category, values.subType)) errors.subType = 'Choose a sub-type for this category.';
  if (!HEX.test(values.hex)) errors.hex = 'Pick a colour.';
  const name = values.name.trim() || autoName(values.hex, values.subType);
  if (name.length > NAME_MAX) errors.name = `Keep the name to ${NAME_MAX} characters.`;
  const c = values.condition;
  if (c !== null && !(Number.isInteger(c) && c >= 0 && c <= 100)) errors.condition = 'Condition is a whole number from 0 to 100.';
  if (values.fit !== '' && !isFit(values.fit)) errors.fit = 'Unknown fit.';
  if (values.material !== '' && !isMaterial(values.material)) errors.material = 'Unknown material.';
  if (values.pattern !== '' && !isPattern(values.pattern)) errors.pattern = 'Unknown pattern.';
  if (!values.seasons.every(isSeason)) errors.seasons = 'Unknown season.';
  if (!values.occasions.every(isOccasion)) errors.occasions = 'Unknown occasion.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const hex = values.hex.toUpperCase();
  const rgb = hexToRgb(hex);
  return {
    ok: true,
    input: {
      name, category: values.category as Category, subType: values.subType as SubType, hex, rgb,
      colourFamily: colourFamily(...rgb) as ColourFamily,
      fit: values.fit || null, material: values.material || null, pattern: values.pattern || null,
      seasons: [...values.seasons], occasions: [...values.occasions], condition: c,
      favourite: values.favourite, neverWorn: values.neverWorn, status: 'active', archiveReason: null,
    },
  };
}

/** Choices for the category and sub-type dropdowns. */
export const categoryChoices = (): readonly Category[] => CATEGORIES;
export const subTypeChoices = (category: Category | ''): readonly SubType[] => (isCategory(category) ? subTypesOf(category) : []);
