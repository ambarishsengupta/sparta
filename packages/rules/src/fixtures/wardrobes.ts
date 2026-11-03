import { categoryOfSubType, colourFamily, hexToRgb } from '@sparta/taxonomy';
import type { Occasion, Pattern, Season, SubType } from '@sparta/taxonomy';
import type { Item } from '../types.js';

interface Extra { p?: Pattern; s?: Season[]; o?: Occasion[]; c?: number; f?: boolean; off?: boolean }
type Row = [subType: SubType, name: string, hex: string, extra?: Extra];

/** Build items from compact rows; the colour family comes from the taxonomy's own function, ids are `prefix-NN`. */
function wardrobe(prefix: string, rows: Row[]): Item[] {
  return rows.map(([subType, name, hex, x = {}], n) => {
    const rgb = hexToRgb(hex);
    return {
      id: `${prefix}-${String(n + 1).padStart(2, '0')}`, name, category: categoryOfSubType(subType)!, subType, rgb,
      colourFamily: colourFamily(...rgb)!, pattern: x.p ?? 'Solid', seasons: x.s ?? [], occasions: x.o ?? [],
      condition: x.c ?? null, favourite: x.f ?? false, status: x.off ? 'archived' : 'active',
    };
  });
}

const WARM: Season[] = ['Spring', 'Summer'];
const COOL: Season[] = ['Autumn', 'Winter'];

/** A first-year student: casual, mostly worn-in, one pair of smart shoes missing. */
export const starterStudent = wardrobe('stu', [
  ['T-shirt', 'White crew-neck tee', '#F4F4F4', { o: ['Casual', 'Travel'], c: 40 }],
  ['T-shirt', 'Grey marl tee', '#9A9A9A', { o: ['Casual'], c: 55 }],
  ['T-shirt', 'Navy band graphic tee', '#1F2A44', { p: 'Graphic', o: ['Casual', 'Party'], c: 35, f: true }],
  ['Shirt', 'Red and black flannel shirt', '#8B1A1A', { p: 'Checked', s: COOL, o: ['Casual'], c: 50 }],
  ['Hoodie', 'Charcoal pullover hoodie', '#4D4D4D', { s: COOL, o: ['Casual', 'Travel'], c: 45, f: true }],
  ['Jeans', 'Mid-blue straight jeans', '#1E5AA8', { o: ['Casual', 'Date', 'Travel'], c: 30, f: true }],
  ['Joggers', 'Black joggers', '#1A1A1A', { o: ['Casual', 'Travel'], c: 50 }],
  ['Shorts', 'Khaki cargo shorts', '#C3B091', { s: WARM, o: ['Casual'], c: 45 }],
  ['Sports shorts', 'Black running shorts', '#000000', { o: ['Sport'], c: 40 }],
  ['Sports T-shirt', 'Grey dry-fit tee', '#808080', { o: ['Sport'], c: 40 }],
  ['Sneakers', 'White canvas sneakers', '#F0F0F0', { o: ['Casual', 'Date', 'Travel'], c: 55 }],
  ['Sneakers', 'Black running shoes', '#1A1A1A', { o: ['Sport', 'Casual'], c: 50 }],
  ['Sandals', 'Brown leather sandals', '#8B5A2B', { s: WARM, o: ['Casual'], c: 45 }],
  ['Jacket', 'Olive bomber jacket', '#6B6B2F', { s: ['Spring', 'Autumn'], o: ['Casual', 'Travel'], c: 35 }],
  ['Cap', 'Black baseball cap', '#111111'],
  ['Bag', 'Navy backpack', '#1F2A44'],
]);

/** Someone who dresses for an office five days a week: shirts, trousers, blazers and two pairs of formal shoes. */
export const officeRegular = wardrobe('off', [
  ['Shirt', 'White cotton shirt', '#F7F7F7', { o: ['Work', 'Formal'], c: 15, f: true }],
  ['Shirt', 'Light blue oxford shirt', '#ADD8E6', { o: ['Work', 'Formal'], c: 20 }],
  ['Shirt', 'Blue and white striped shirt', '#6FA8DC', { p: 'Striped', o: ['Work'], c: 25 }],
  ['Shirt', 'Pale pink shirt', '#F4A6C0', { o: ['Work', 'Date'], c: 20 }],
  ['Polo', 'Navy polo', '#191970', { o: ['Work', 'Casual'], c: 25 }],
  ['T-shirt', 'Grey weekend tee', '#A9A9A9', { o: ['Casual'], c: 40 }],
  ['Sweater', 'Charcoal merino sweater', '#4D4D4D', { s: COOL, o: ['Work', 'Casual'], c: 20, f: true }],
  ['Cardigan', 'Camel cardigan', '#B5895A', { s: COOL, o: ['Work'], c: 30 }],
  ['Trousers', 'Charcoal wool trousers', '#4D4D4D', { o: ['Work', 'Formal'], c: 15, f: true }],
  ['Trousers', 'Navy trousers', '#1F2A44', { o: ['Work', 'Formal', 'Party'], c: 20 }],
  ['Chinos', 'Beige chinos', '#D9C7A0', { o: ['Work', 'Casual', 'Date'], c: 25 }],
  ['Chinos', 'Olive chinos', '#6B6B2F', { o: ['Work', 'Casual'], c: 30 }],
  ['Jeans', 'Dark indigo jeans', '#1B2A4A', { o: ['Casual', 'Date', 'Party'], c: 20 }],
  ['Blazer', 'Navy blazer', '#1F2A44', { o: ['Work', 'Formal', 'Date'], c: 15, f: true }],
  ['Blazer', 'Grey herringbone blazer', '#808080', { p: 'Checked', s: COOL, o: ['Work', 'Formal'], c: 25 }],
  ['Coat', 'Charcoal overcoat', '#3C3C3C', { s: ['Winter'], o: ['Work', 'Formal'], c: 15 }],
  ['Suit', 'Navy two-piece suit', '#1F2A44', { o: ['Formal', 'Work'], c: 10, f: true }],
  ['Formal shoes', 'Black oxfords', '#111111', { o: ['Work', 'Formal'], c: 15, f: true }],
  ['Formal shoes', 'Brown brogues', '#5C4033', { o: ['Work', 'Formal'], c: 25 }],
  ['Sneakers', 'White leather sneakers', '#F0F0F0', { o: ['Casual', 'Date', 'Work'], c: 20 }],
  ['Belt', 'Black leather belt', '#111111', { o: ['Work', 'Formal'], c: 20 }],
  ['Belt', 'Brown leather belt', '#5C4033', { o: ['Work', 'Formal'], c: 25 }],
  ['Tie', 'Maroon silk tie', '#7B1E3A', { o: ['Formal', 'Work'] }],
  ['Watch', 'Steel dress watch', '#C0C0C0'],
]);

/** Black, white, grey, beige: everything goes with everything, so the engine has to be picky about shape and season. */
export const minimalistNeutrals = wardrobe('min', [
  ['T-shirt', 'Black tee', '#111111', { o: ['Casual', 'Party', 'Date'], c: 20, f: true }],
  ['T-shirt', 'White tee', '#FAFAFA', { o: ['Casual', 'Travel'], c: 20 }],
  ['T-shirt', 'Grey tee', '#9A9A9A', { o: ['Casual'], c: 25 }],
  ['Shirt', 'White linen shirt', '#F5F2EA', { s: WARM, o: ['Casual', 'Work', 'Date'], c: 15 }],
  ['Shirt', 'Beige overshirt', '#E8DCC2', { o: ['Casual', 'Date'], c: 25 }],
  ['Sweater', 'Oatmeal wool sweater', '#D9C7A0', { s: COOL, o: ['Casual', 'Date'], c: 15, f: true }],
  ['Chinos', 'Stone chinos', '#D9C7A0', { o: ['Casual', 'Work', 'Travel'], c: 20 }],
  ['Trousers', 'Black tailored trousers', '#111111', { o: ['Work', 'Formal', 'Party', 'Date'], c: 15, f: true }],
  ['Jeans', 'Black jeans', '#1A1A1A', { o: ['Casual', 'Party', 'Date'], c: 25 }],
  ['Jacket', 'Black bomber jacket', '#111111', { s: ['Spring', 'Autumn'], o: ['Casual', 'Party'], c: 20 }],
  ['Coat', 'Grey wool coat', '#808080', { s: ['Winter'], o: ['Casual', 'Work', 'Date'], c: 15 }],
  ['Sneakers', 'White minimal sneakers', '#F5F5F5', { o: ['Casual', 'Work', 'Date', 'Travel'], c: 15, f: true }],
  ['Boots', 'Black leather boots', '#111111', { s: COOL, o: ['Party', 'Date', 'Casual'], c: 20 }],
  ['Belt', 'Black belt', '#111111', { c: 20 }],
  ['Watch', 'Black minimalist watch', '#1A1A1A'],
]);

/** Someone who wears colour on purpose: many bold and patterned pieces, so R3 and R4 have work to do. */
export const colourfulCasual = wardrobe('col', [
  ['T-shirt', 'Mustard yellow tee', '#F7D038', { o: ['Casual', 'Travel'], c: 25, f: true }],
  ['T-shirt', 'Pink tee', '#F4A6C0', { o: ['Casual', 'Date'], c: 30 }],
  ['T-shirt', 'Teal and white striped tee', '#008080', { p: 'Striped', o: ['Casual'], c: 25 }],
  ['Polo', 'Red polo', '#D62828', { o: ['Casual', 'Party'], c: 30 }],
  ['Shirt', 'Orange floral print shirt', '#F28C28', { p: 'Printed', s: WARM, o: ['Casual', 'Party', 'Travel'], c: 20, f: true }],
  ['Shirt', 'Green checked shirt', '#2E8B57', { p: 'Checked', o: ['Casual', 'Date'], c: 25 }],
  ['Hoodie', 'Purple hoodie', '#6A3D9A', { s: COOL, o: ['Casual'], c: 30 }],
  ['Jeans', 'Light blue jeans', '#6FA8DC', { o: ['Casual', 'Date', 'Travel'], c: 25 }],
  ['Jeans', 'Black jeans', '#1A1A1A', { o: ['Casual', 'Party', 'Date'], c: 20 }],
  ['Chinos', 'Olive chinos', '#6B6B2F', { o: ['Casual', 'Work'], c: 30 }],
  ['Shorts', 'Maroon patterned shorts', '#7B1E3A', { p: 'Printed', s: WARM, o: ['Casual', 'Travel'], c: 35 }],
  ['Shorts', 'Blue board shorts', '#1E5AA8', { s: ['Summer'], o: ['Casual', 'Travel'], c: 30 }],
  ['Jacket', 'Yellow windcheater', '#F7D038', { s: ['Spring', 'Autumn'], o: ['Casual', 'Travel'], c: 25 }],
  ['Sneakers', 'White sneakers', '#F0F0F0', { o: ['Casual', 'Date', 'Party', 'Travel'], c: 25, f: true }],
  ['Sneakers', 'Red high-tops', '#D62828', { o: ['Casual', 'Party'], c: 30 }],
  ['Sandals', 'Tan sandals', '#8B5A2B', { s: WARM, o: ['Casual', 'Travel'], c: 40 }],
  ['Formal shoes', 'Brown loafers', '#8B5A2B', { o: ['Work', 'Date'], c: 25 }],
  ['Cap', 'Teal cap', '#008080'],
]);

/** Too little to dress from: no footwear (the only pair is archived), so every occasion must say what is missing. */
export const thinWardrobe = wardrobe('thin', [
  ['T-shirt', 'White tee', '#F4F4F4', { o: ['Casual'], c: 30 }],
  ['Jeans', 'Blue jeans', '#1E5AA8', { o: ['Casual'], c: 30 }],
  ['Sneakers', 'Retired white sneakers', '#F0F0F0', { c: 90, off: true }],
  ['Watch', 'Digital watch', '#1A1A1A'],
]);

export const WARDROBES: Record<string, Item[]> = {
  'Starter student': starterStudent, 'Office regular': officeRegular, 'Minimalist neutrals': minimalistNeutrals,
  'Colourful casual': colourfulCasual, 'Thin wardrobe': thinWardrobe,
};
