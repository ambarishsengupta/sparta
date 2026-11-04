import { describe, expect, it } from 'vitest';
import { CATEGORIES, SUB_TYPES, colourFamily, hexToRgb, isSubType } from '@sparta/taxonomy';
import { autoName, emptyForm, familyOfHex, formFromItem, subTypeChoices, updateForm, validateForm } from './item-form';
import type { ItemFormValues } from './item-form';
import type { StoredItem } from './repository';

const filled = (over: Partial<ItemFormValues> = {}): ItemFormValues =>
  updateForm(emptyForm(), { category: 'Tops', subType: 'Shirt', hex: '#00008B', ...over });

describe('item form: automatic name (FDD 13)', () => {
  it('is the colour family plus the sub-type', () => {
    expect(autoName('#00008B', 'Shirt')).toBe('Navy Shirt');
    expect(autoName('#1560BD', 'T-shirt')).toBe('Blue T-shirt');
  });
  it('is empty until a sub-type is chosen or when the hex is invalid', () => {
    expect(autoName('#00008B', '')).toBe('');
    expect(autoName('blue', 'Shirt')).toBe('');
  });
  it('follows the colour and sub-type until the user edits it', () => {
    let v = filled();
    expect(v.name).toBe('Navy Shirt');
    v = updateForm(v, { hex: '#800020' });
    expect(v.name).toBe('Maroon Shirt');
    v = updateForm(v, { name: 'Wedding shirt' });
    v = updateForm(v, { hex: '#00008B', subType: 'Polo' });
    expect(v.name).toBe('Wedding shirt');
  });
  it('goes back to automatic when the user clears the name', () => {
    const v = updateForm(updateForm(filled(), { name: 'Mine' }), { name: '' });
    expect(v.nameEdited).toBe(false);
    expect(v.name).toBe('Navy Shirt');
  });
  it('is kept as typed when an existing item is opened for editing', () => {
    const item = { ...validOk(filled({ name: 'Wedding shirt' })), id: 'i1', createdAt: '', updatedAt: '' } as StoredItem;
    expect(formFromItem(item)).toMatchObject({ name: 'Wedding shirt', nameEdited: true });
  });
});

function validOk(v: ItemFormValues) {
  const r = validateForm(v);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.input;
}

describe('item form: colour family on save', () => {
  it.each([['#00008B', 'Navy'], ['#1560BD', 'Blue'], ['#C0C0C0', 'Grey'], ['#36454F', 'Grey'], ['#800020', 'Maroon']])(
    '%s is %s', (hex, family) => {
      expect(familyOfHex(hex)).toBe(family);
      expect(validOk(filled({ hex })).colourFamily).toBe(family);
    },
  );
  it('stores rgb and an upper-case hex that agree with the taxonomy function', () => {
    const input = validOk(filled({ hex: '#1e5aa8' }));
    expect(input.hex).toBe('#1E5AA8');
    expect(input.rgb).toEqual(hexToRgb('#1E5AA8'));
    expect(input.colourFamily).toBe(colourFamily(...input.rgb));
  });
  it('has no family for text that is not a hex colour', () => {
    expect(familyOfHex('#12345')).toBeNull();
    expect(familyOfHex('')).toBeNull();
  });
});

describe('item form: validation', () => {
  it('accepts the minimum: category, sub-type, colour', () => {
    const input = validOk(filled());
    expect(input).toMatchObject({ name: 'Navy Shirt', category: 'Tops', subType: 'Shirt', status: 'active', condition: null, fit: null, pattern: null, seasons: [], favourite: false });
  });
  it('requires a category, then a sub-type', () => {
    expect(validateForm(emptyForm())).toEqual({ ok: false, errors: { category: expect.any(String) } });
    const r = validateForm(updateForm(emptyForm(), { category: 'Tops' }));
    expect(r).toEqual({ ok: false, errors: { subType: expect.any(String) } });
  });
  it('clears a sub-type that does not belong to a newly chosen category', () => {
    const v = updateForm(filled(), { category: 'Footwear' });
    expect(v.subType).toBe('');
  });
  it('keeps a sub-type when the category change still contains it', () => {
    expect(updateForm(filled(), { category: 'Tops' }).subType).toBe('Shirt');
  });
  it('rejects a sub-type from another category', () => {
    const r = validateForm({ ...filled(), subType: 'Jeans' });
    expect(r.ok).toBe(false);
  });
  it('rejects a bad hex', () => {
    const r = validateForm({ ...filled(), hex: 'navy' });
    expect(r).toMatchObject({ ok: false, errors: { hex: expect.any(String) } });
  });
  it.each([-1, 101, 40.5, Number.NaN])('rejects condition %s', (condition) => {
    expect(validateForm(filled({ condition }))).toMatchObject({ ok: false, errors: { condition: expect.any(String) } });
  });
  it.each([0, 1, 100])('accepts condition %s', (condition) => {
    expect(validOk(filled({ condition })).condition).toBe(condition);
  });
  it('rejects an over-long name', () => {
    expect(validateForm(filled({ name: 'x'.repeat(81) }))).toMatchObject({ ok: false, errors: { name: expect.any(String) } });
  });
  it('rejects unknown seasons and occasions', () => {
    const r = validateForm({ ...filled(), seasons: ['Monsoon' as never], occasions: ['Gala' as never] });
    expect(r).toMatchObject({ ok: false, errors: { seasons: expect.any(String), occasions: expect.any(String) } });
  });
  it('carries the optional choices through', () => {
    const input = validOk(filled({ fit: 'Slim', material: 'Cotton', pattern: 'Striped', seasons: ['Summer'], occasions: ['Work', 'Date'], favourite: true, neverWorn: true }));
    expect(input).toMatchObject({ fit: 'Slim', material: 'Cotton', pattern: 'Striped', seasons: ['Summer'], occasions: ['Work', 'Date'], favourite: true, neverWorn: true });
  });
});

describe('item form: taxonomy choices', () => {
  it('offers every sub-type of the chosen category and none before one is chosen', () => {
    expect(subTypeChoices('')).toEqual([]);
    expect(subTypeChoices('Footwear')).toEqual(['Sneakers', 'Formal shoes', 'Boots', 'Sandals']);
  });
  it('every offered sub-type validates for its category', () => {
    for (const category of CATEGORIES) for (const s of subTypeChoices(category)) expect(isSubType(category, s)).toBe(true);
    expect(SUB_TYPES.length).toBeGreaterThan(30);
  });
});
