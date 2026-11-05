import fc from 'fast-check';
import { FITS, MATERIALS, OCCASIONS, PATTERNS, SEASONS, SUB_TYPES, categoryOfSubType, colourFamily, rgbToHex } from '@sparta/taxonomy';
import type { ItemInput } from '../lib/repository';

/** Random wardrobe items for the mapping tests and the integration suite. The colour family is the one the colour function gives (the database derives it the same way). Test support only. */
const pick = <T>(xs: readonly T[]) => fc.constantFrom(...xs);
const byte = fc.integer({ min: 0, max: 255 });

export const itemInput: fc.Arbitrary<ItemInput> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 80 }), subType: pick(SUB_TYPES), rgb: fc.tuple(byte, byte, byte),
  fit: fc.option(pick(FITS), { nil: null }), material: fc.option(pick(MATERIALS), { nil: null }), pattern: fc.option(pick(PATTERNS), { nil: null }),
  seasons: fc.subarray([...SEASONS]), occasions: fc.subarray([...OCCASIONS]), condition: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
  favourite: fc.boolean(), neverWorn: fc.boolean(), status: pick(['active', 'archived'] as const),
  archiveReason: fc.option(pick(['sold', 'donated', 'discarded', 'lost'] as const), { nil: null }),
}).map((r) => ({ ...r, category: categoryOfSubType(r.subType)!, hex: rgbToHex(...r.rgb), colourFamily: colourFamily(...r.rgb)! }));
