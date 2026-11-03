import { describe, expect, it } from 'vitest';
import slots from './slots.json';
import taxonomy from './taxonomy.json';
import {
  CATEGORIES,
  CONDITION_BANDS,
  FITS,
  MATERIALS,
  OCCASIONS,
  PATTERNS,
  SEASONS,
  SIZE_SYSTEMS,
  SUB_TYPES,
  assertTaxonomy,
  categoryOfSubType,
  conditionBandOf,
  isCategory,
  isColourFamily,
  isOccasion,
  isSubType,
  isSuggestable,
  slotAssignmentOf,
  slotsOfSubType,
  subTypesOf,
  taxonomyProblems,
} from './validators.js';
import * as api from './index.js';

describe('taxonomy consistency', () => {
  it('assertTaxonomy passes on the shipped data', () => {
    expect(taxonomyProblems()).toEqual([]);
    expect(() => assertTaxonomy()).not.toThrow();
  });
  it('lists the nine categories of FDD 13', () => {
    expect(CATEGORIES).toEqual([
      'Tops', 'Bottoms', 'Outerwear', 'Footwear', 'Accessories',
      'Underwear and socks', 'Activewear', 'Ethnic wear', 'Occasion wear',
    ]);
  });
  it('lists the sub-types of FDD 13 for each category', () => {
    expect(subTypesOf('Tops')).toEqual(['T-shirt', 'Shirt', 'Polo', 'Sweater', 'Cardigan', 'Hoodie']);
    expect(subTypesOf('Bottoms')).toEqual(['Jeans', 'Chinos', 'Trousers', 'Shorts', 'Joggers']);
    expect(subTypesOf('Outerwear')).toEqual(['Jacket', 'Blazer', 'Coat']);
    expect(subTypesOf('Footwear')).toEqual(['Sneakers', 'Formal shoes', 'Boots', 'Sandals']);
    expect(subTypesOf('Accessories')).toEqual(['Watch', 'Belt', 'Tie', 'Cap', 'Scarf', 'Bag']);
    expect(subTypesOf('Underwear and socks')).toEqual(['Briefs', 'Boxers', 'Vest', 'Socks']);
    expect(subTypesOf('Activewear')).toEqual(['Sports T-shirt', 'Track pants', 'Sports shorts', 'Track jacket']);
    expect(subTypesOf('Ethnic wear')).toEqual(['Kurta', 'Sherwani', 'Nehru jacket', 'Pyjama', 'Dhoti']);
    expect(subTypesOf('Occasion wear')).toEqual(['Suit', 'Tuxedo', 'Waistcoat']);
    expect(SUB_TYPES).toHaveLength(40);
  });
  it('flags the four draft categories of FDD 13', () => {
    const drafts = taxonomy.categories.filter((c) => c.draft).map((c) => c.name).sort();
    expect(drafts).toEqual(['Activewear', 'Ethnic wear', 'Occasion wear', 'Underwear and socks']);
  });
  it('fit, material, pattern, season, occasion and condition lists match FDD 13 and LLD 4.2', () => {
    expect(FITS).toEqual(['Slim', 'Regular', 'Relaxed', 'Oversized', 'Tailored']);
    expect(MATERIALS).toEqual(['Cotton', 'Linen', 'Wool', 'Denim', 'Polyester', 'Leather', 'Synthetic blend', 'Other']);
    expect(PATTERNS).toEqual(['Solid', 'Striped', 'Checked', 'Printed', 'Graphic', 'Other']);
    expect(SEASONS).toEqual(['Spring', 'Summer', 'Autumn', 'Winter', 'All year']);
    expect(OCCASIONS).toEqual(['Casual', 'Work', 'Formal', 'Party', 'Sport', 'Date', 'Travel']);
    expect(CONDITION_BANDS).toEqual(['Brand new', 'Like new', 'Good', 'Worn', 'Falling apart']);
    expect(SIZE_SYSTEMS).toEqual(['Letter', 'Waist and length', 'Shoe EU', 'Shoe UK', 'Shoe US', 'Shoe IN']);
  });
  it('the public API exposes the documented functions', () => {
    for (const name of ['colourFamily', 'rgbToLab', 'referenceSwatch', 'isCategory', 'isSubType',
      'isColourFamily', 'categoryOfSubType', 'slotsOfSubType', 'assertTaxonomy']) {
      expect(typeof (api as Record<string, unknown>)[name]).toBe('function');
    }
    expect('default' in api).toBe(false);
  });
});

describe('validators', () => {
  it('isCategory accepts known categories only', () => {
    expect(isCategory('Tops')).toBe(true);
    expect(isCategory('Hats')).toBe(false);
    expect(isCategory(undefined)).toBe(false);
  });
  it('isSubType checks the sub-type belongs to the category', () => {
    expect(isSubType('Tops', 'Shirt')).toBe(true);
    expect(isSubType('Bottoms', 'Shirt')).toBe(false);
    expect(isSubType('Nope', 'Shirt')).toBe(false);
    expect(isSubType('Tops', 42)).toBe(false);
  });
  it('categoryOfSubType finds the category', () => {
    expect(categoryOfSubType('Kurta')).toBe('Ethnic wear');
    expect(categoryOfSubType('Suit')).toBe('Occasion wear');
    expect(categoryOfSubType('Fez')).toBeUndefined();
  });
  it('isColourFamily accepts the 18 families and nothing else', () => {
    expect(isColourFamily('Navy')).toBe(true);
    expect(isColourFamily('Multi')).toBe(true);
    expect(isColourFamily('Turquoise')).toBe(false);
    expect(isOccasion('Date')).toBe(true);
    expect(isOccasion('Wedding')).toBe(false);
  });
  it('conditionBandOf follows the LLD 4.2 seed at the band edges', () => {
    expect(conditionBandOf(0)).toBe('Brand new');
    expect(conditionBandOf(9)).toBe('Brand new');
    expect(conditionBandOf(10)).toBe('Like new');
    expect(conditionBandOf(29)).toBe('Like new');
    expect(conditionBandOf(30)).toBe('Good');
    expect(conditionBandOf(59)).toBe('Good');
    expect(conditionBandOf(60)).toBe('Worn');
    expect(conditionBandOf(84)).toBe('Worn');
    expect(conditionBandOf(85)).toBe('Falling apart');
    expect(conditionBandOf(100)).toBe('Falling apart');
    expect(conditionBandOf(101)).toBeUndefined();
    expect(conditionBandOf(-1)).toBeUndefined();
  });
});

describe('slot map (FDD 14.1)', () => {
  it('covers every sub-type exactly once', () => {
    for (const s of SUB_TYPES) {
      expect(slotAssignmentOf(s), `${s} has no slot entry`).toBeDefined();
    }
    const listed = slots.groups.flatMap((g) =>
      g.members.flatMap((m) => (m.subTypes === 'all' ? subTypesOf(m.category as never) : m.subTypes)),
    );
    expect(listed.sort()).toEqual([...SUB_TYPES].sort());
  });
  it('covers every non-excluded sub-type with at least one slot', () => {
    for (const s of SUB_TYPES) {
      if (categoryOfSubType(s) === 'Underwear and socks') continue;
      expect(slotsOfSubType(s).length, s).toBeGreaterThan(0);
      expect(isSuggestable(s)).toBe(true);
    }
  });
  it('never suggests Underwear and socks', () => {
    for (const s of subTypesOf('Underwear and socks')) {
      expect(slotsOfSubType(s)).toEqual([]);
      expect(isSuggestable(s)).toBe(false);
      expect(slotAssignmentOf(s)?.fill).toBe('none');
    }
  });
  it('maps representative sub-types to the slots in the FDD table', () => {
    expect(slotsOfSubType('T-shirt')).toEqual(['Top']);
    expect(slotsOfSubType('Kurta')).toEqual(['Top']);
    expect(slotsOfSubType('Sports T-shirt')).toEqual(['Top']);
    expect(slotsOfSubType('Hoodie')).toEqual(['Top', 'Layer']);
    expect(slotAssignmentOf('Hoodie')?.fill).toBe('either');
    expect(slotsOfSubType('Jeans')).toEqual(['Bottom']);
    expect(slotsOfSubType('Dhoti')).toEqual(['Bottom']);
    expect(slotsOfSubType('Track pants')).toEqual(['Bottom']);
    expect(slotsOfSubType('Blazer')).toEqual(['Layer']);
    expect(slotsOfSubType('Sherwani')).toEqual(['Layer']);
    expect(slotsOfSubType('Waistcoat')).toEqual(['Layer']);
    expect(slotsOfSubType('Track jacket')).toEqual(['Layer']);
    expect(slotsOfSubType('Boots')).toEqual(['Footwear']);
    expect(slotsOfSubType('Belt')).toEqual(['Accessory']);
  });
  it('Suit and Tuxedo fill Layer and Bottom at once', () => {
    for (const s of ['Suit', 'Tuxedo']) {
      expect(slotsOfSubType(s)).toEqual(['Layer', 'Bottom']);
      expect(slotAssignmentOf(s)?.fill).toBe('both');
    }
  });
  it('the occasion table lists all seven occasions; Date and Travel use the Casual rule', () => {
    expect(slots.occasionRules.map((o) => o.occasion)).toEqual(OCCASIONS);
    const byOcc = Object.fromEntries(slots.occasionRules.map((o) => [o.occasion, o.usesRuleOf]));
    expect(byOcc['Date']).toBe('Casual');
    expect(byOcc['Travel']).toBe('Casual');
    expect(byOcc['Work']).toBeNull();
  });
  it('unknown sub-types have no slots', () => {
    expect(slotsOfSubType('Fez')).toEqual([]);
    expect(slotAssignmentOf('Fez')).toBeUndefined();
  });
});
