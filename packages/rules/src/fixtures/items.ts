import { categoryOfSubType } from '@sparta/taxonomy';
import type { ColourFamily, Occasion, SubType } from '@sparta/taxonomy';
import type { Ctx, Hemisphere, Item } from '../types.js';

/** A test item: navy and solid unless `o` says otherwise (the same helper the engine tests use). */
export const mk = (subType: SubType, id: string, o: Partial<Item> = {}): Item => ({
  id, name: id, category: categoryOfSubType(subType)!, subType, rgb: [31, 42, 68], colourFamily: 'Navy', pattern: 'Solid',
  seasons: [], occasions: [], condition: null, favourite: false, status: 'active', ...o,
});
export const grey = (v: number): Partial<Item> => ({ rgb: [v, v, v], colourFamily: 'Grey' as ColourFamily });
/** The 15th of `month` 2026 (1 to 12), UTC. */
export const at = (occasion: Occasion, month = 4, hemisphere: Hemisphere = 'north'): Ctx => ({ occasion, hemisphere, date: new Date(Date.UTC(2026, month - 1, 15)) });

/** Freezes the value and everything inside it, so an attempt to change it throws. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
