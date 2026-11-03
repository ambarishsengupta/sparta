// Types for the taxonomy. The unions are written by hand (JSON imports widen to string)
// and src/taxonomy.test.ts checks them against taxonomy.json so they cannot drift.

export type Category =
  | 'Tops'
  | 'Bottoms'
  | 'Outerwear'
  | 'Footwear'
  | 'Accessories'
  | 'Underwear and socks'
  | 'Activewear'
  | 'Ethnic wear'
  | 'Occasion wear';

export type SubType =
  | 'T-shirt' | 'Shirt' | 'Polo' | 'Sweater' | 'Cardigan' | 'Hoodie'
  | 'Jeans' | 'Chinos' | 'Trousers' | 'Shorts' | 'Joggers'
  | 'Jacket' | 'Blazer' | 'Coat'
  | 'Sneakers' | 'Formal shoes' | 'Boots' | 'Sandals'
  | 'Watch' | 'Belt' | 'Tie' | 'Cap' | 'Scarf' | 'Bag'
  | 'Briefs' | 'Boxers' | 'Vest' | 'Socks'
  | 'Sports T-shirt' | 'Track pants' | 'Sports shorts' | 'Track jacket'
  | 'Kurta' | 'Sherwani' | 'Nehru jacket' | 'Pyjama' | 'Dhoti'
  | 'Suit' | 'Tuxedo' | 'Waistcoat';

export type ColourFamily =
  | 'Black' | 'White' | 'Grey' | 'Navy' | 'Blue' | 'Teal' | 'Green' | 'Olive' | 'Khaki'
  | 'Beige' | 'Brown' | 'Maroon' | 'Red' | 'Orange' | 'Yellow' | 'Pink' | 'Purple' | 'Multi';

/** A family that has reference swatches (every family except Multi). */
export type SwatchFamily = Exclude<ColourFamily, 'Multi'>;

export type Fit = 'Slim' | 'Regular' | 'Relaxed' | 'Oversized' | 'Tailored';
export type Material =
  | 'Cotton' | 'Linen' | 'Wool' | 'Denim' | 'Polyester' | 'Leather' | 'Synthetic blend' | 'Other';
export type Pattern = 'Solid' | 'Striped' | 'Checked' | 'Printed' | 'Graphic' | 'Other';
export type Season = 'Spring' | 'Summer' | 'Autumn' | 'Winter' | 'All year';
export type Occasion = 'Casual' | 'Work' | 'Formal' | 'Party' | 'Sport' | 'Date' | 'Travel';
export type ConditionBand = 'Brand new' | 'Like new' | 'Good' | 'Worn' | 'Falling apart';
export type SizeSystem =
  | 'Letter' | 'Waist and length' | 'Shoe EU' | 'Shoe UK' | 'Shoe US' | 'Shoe IN';

export type Slot = 'Top' | 'Bottom' | 'Layer' | 'Footwear' | 'Accessory';

/**
 * How a sub-type uses the slots in an outfit:
 * - one:    fills the single slot listed
 * - either: fills one of the listed slots in a given outfit (Top or Layer)
 * - both:   fills all listed slots at once (Suit, Tuxedo)
 * - none:   never suggested
 */
export type SlotFill = 'one' | 'either' | 'both' | 'none';

export interface SlotAssignment {
  readonly slots: readonly Slot[];
  readonly fill: SlotFill;
  readonly suggested: boolean;
}

export interface Swatch {
  readonly family: SwatchFamily;
  readonly hex: string;
}

export type Lab = readonly [l: number, a: number, b: number];
