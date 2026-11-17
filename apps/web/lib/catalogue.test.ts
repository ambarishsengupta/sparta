import { isCategory, isColourFamily, isSubType } from '@sparta/taxonomy';
import { describe, expect, it } from 'vitest';
import {
  CATALOGUE_PAGE, CATALOGUE_SELECT, NO_CATALOGUE_FILTER, STYLES, attachmentOf, catalogueFromRow, checkPaid, cleanCatalogueFilter, emptyPaid, filterCatalogue,
  formFromCatalogue, parseStyle, paidEntered, sourceLink, styleLabel,
} from './catalogue';
import type { CatalogueItem } from './catalogue';
import { DEMO_CATALOGUE, DEMO_CATALOGUE_SYNTHETIC } from './demo-catalogue';
import { startPage } from './onboarding';
import { itemRow } from './supabase/mapping';
import { validateForm } from './item-form';

const ID = '5c1b3b52-0000-4000-8000-000000000001';
const row = (over: Record<string, unknown> = {}) => ({
  id: ID, name: 'Crew tee - Ink black', brand: 'Zorvane', category: 'Tops', sub_type: 'T-shirt', colour_hex: '#111111', colour_family: 'Black', fit: 'Regular', pattern: 'Solid',
  material: 'Cotton', seasons: ['Spring'], occasions: ['Casual'], sizes_available: ['S', 'M'], price: '799.00', currency: 'INR', product_url: 'https://example.test/x', ...over,
});

describe('catalogueFromRow (FR-21)', () => {
  it('reads one active row into the picker shape', () => {
    expect(catalogueFromRow(row())).toEqual({
      id: ID, name: 'Crew tee - Ink black', brand: 'Zorvane', category: 'Tops', subType: 'T-shirt', hex: '#111111', colourFamily: 'Black', fit: 'Regular', pattern: 'Solid', material: 'Cotton',
      seasons: ['Spring'], occasions: ['Casual'], sizes: ['S', 'M'], price: 799, currency: 'INR', productUrl: 'https://example.test/x',
    });
  });
  it('skips a row it cannot show: no id, name or link, an unknown category, or a sub-type of another category', () => {
    for (const bad of [{ id: 1 }, { name: null }, { product_url: null }, { category: 'Hats' }, { sub_type: 'Jeans' }, { category: null }]) expect(catalogueFromRow(row(bad))).toBeNull();
  });
  it('keeps a row without a colour (neutral grey), without a price, brand or sizes', () => {
    const c = catalogueFromRow(row({ colour_hex: null, colour_family: null, price: null, currency: null, brand: '', sizes_available: null, fit: 'Nonsense', seasons: ['Never', 'Summer'] }))!;
    expect(c).toMatchObject({ hex: '#808080', colourFamily: null, price: null, currency: null, brand: null, sizes: [], fit: null, seasons: ['Summer'] });
  });
  it('refuses a negative, infinite or non-numeric price and a currency that is not three letters', () => {
    for (const price of ['-1', 'Infinity', 'abc']) expect(catalogueFromRow(row({ price }))!.price).toBeNull();
    expect(catalogueFromRow(row({ currency: 'RUPEES' }))!.currency).toBeNull();
    expect(catalogueFromRow(row({ currency: ' inr ' }))!.currency).toBe('INR');
  });
  it('ignores any image-like column: nothing of the source picture is ever read (FR-24)', () => {
    expect(JSON.stringify(catalogueFromRow(row({ image_url: 'https://cdn.example.test/p.jpg', image: 'x' })))).not.toMatch(/jpg|image/i);
    expect(CATALOGUE_SELECT).not.toMatch(/image|img|photo/i);
  });
});

describe('the source name comes from the embedded source (WO-0130 part 4)', () => {
  it('is read from sources.name and from nothing else, whatever the link looks like', () => {
    const local = { sku: '0990000001', product_url: 'http://127.0.0.1/hm-demo/0990000001' };
    expect(catalogueFromRow(row({ ...local, sources: { name: 'Some Shop' } }))!.source).toBe('Some Shop');
    expect(catalogueFromRow(row({ ...local }))!.source).toBeUndefined();
    expect(catalogueFromRow(row({ ...local, sources: null }))!.source).toBeUndefined();
    expect(catalogueFromRow(row({ ...local, sources: [{ name: 'Some Shop' }] }))!.source).toBeUndefined();
    expect(catalogueFromRow(row({ sources: { name: 'Some Shop' } }))!.source).toBe('Some Shop');
  });
  it('the catalogue reads ask for the name through the foreign key and no other source column', () => {
    expect(CATALOGUE_SELECT).toContain(',sources(name)');
    expect(CATALOGUE_SELECT).not.toMatch(/sources\((?!name\))/);
    expect(CATALOGUE_SELECT).not.toMatch(/site_url|terms_note|takedown|contact/);
  });
});

describe('sourceLink: https only (FR-24)', () => {
  it('gives the address for https and nothing for anything else', () => {
    expect(sourceLink('https://example.test/p?id=1')).toBe('https://example.test/p?id=1');
    for (const u of ['http://example.test/p', 'javascript:alert(1)', 'data:text/html,x', 'ftp://example.test', '//example.test', 'not a url', '', 'HTTP://EXAMPLE.TEST', 'https://user:pw@example.test/']) expect(sourceLink(u), u).toBeNull();
  });
});

describe('filter checks', () => {
  it('drops values the taxonomy does not know, trims and caps the text', () => {
    expect(cleanCatalogueFilter({ q: `  ${'x'.repeat(100)} `, category: 'Hats', brand: ` ${'b'.repeat(200)}`, colourFamily: 'Plaid', style: 'fit:Wide-ish' })).toEqual({ q: 'x'.repeat(80), category: '', brand: 'b'.repeat(120), colourFamily: '', style: '' });
    expect(cleanCatalogueFilter({ q: 'tee', category: 'Tops', brand: 'Zorvane', colourFamily: 'Black', style: 'fit:Slim' })).toEqual({ q: 'tee', category: 'Tops', brand: 'Zorvane', colourFamily: 'Black', style: 'fit:Slim' });
  });
  it('a style is one fit, pattern or occasion tag, and says which', () => {
    expect(parseStyle('fit:Slim')).toEqual({ kind: 'fit', value: 'Slim' });
    expect(parseStyle('pattern:Solid')).toEqual({ kind: 'pattern', value: 'Solid' });
    expect(parseStyle('occasion:Casual')).toEqual({ kind: 'occasion', value: 'Casual' });
    for (const bad of ['', 'fit:Solid', 'pattern:Slim', 'colour:Black', 'Slim', 'occasion:']) expect(parseStyle(bad), bad).toBeNull();
    expect(STYLES.every((s) => parseStyle(s))).toBe(true);
    expect(styleLabel('fit:Slim')).toBe('Slim (fit)');
  });
});

describe('the bundled SYNTHETIC demo catalogue (browser-only prototype)', () => {
  it('is 40 invented items, flagged synthetic, with the taxonomy and no https link', () => {
    expect(DEMO_CATALOGUE_SYNTHETIC).toBe(true);
    expect(DEMO_CATALOGUE).toHaveLength(40);
    expect(new Set(DEMO_CATALOGUE.map((i) => i.id)).size).toBe(40);
    expect([...new Set(DEMO_CATALOGUE.map((i) => i.brand))].sort()).toEqual(['Brindlewick', 'Fenwrath', 'Ostrelle', 'Pemberlow', 'Quillibrook', 'Tallowmere', 'Wexmarrow', 'Zorvane']);
    for (const i of DEMO_CATALOGUE) {
      expect(isCategory(i.category) && isSubType(i.category, i.subType) && isColourFamily(i.colourFamily), i.id).toBe(true);
      expect(i.id).toMatch(/^demo-\d{4}$/);
      expect(sourceLink(i.productUrl), i.id).toBeNull();
      expect(i.hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
  it('contains no real retailer or brand name (the invented brands only)', () => {
    const text = JSON.stringify(DEMO_CATALOGUE);
    expect(text).not.toMatch(/h\s*&\s*m|hennes|hm\.com|zara|nike|adidas|levi|uniqlo|gap\b|fabindia|myntra|amazon/i);
  });
});

describe('filterCatalogue: the same search in memory', () => {
  const all = DEMO_CATALOGUE;
  const f = (patch: Partial<typeof NO_CATALOGUE_FILTER>, after = null as { name: string; id: string } | null) => filterCatalogue(all, { ...NO_CATALOGUE_FILTER, ...patch }, after);
  it('lists 40 at a time by name then id and gives the cursor of the last row shown; the last page has none', () => {
    const many: CatalogueItem[] = Array.from({ length: 95 }, (_, n) => ({ ...all[0]!, id: `x-${String(n).padStart(3, '0')}`, name: `Item ${String(n).padStart(3, '0')}` }));
    const p1 = filterCatalogue(many, NO_CATALOGUE_FILTER);
    expect(p1.rows).toHaveLength(CATALOGUE_PAGE);
    expect(p1.next).toEqual({ name: 'Item 039', id: 'x-039' });
    const p2 = filterCatalogue(many, NO_CATALOGUE_FILTER, p1.next);
    expect(p2.rows[0]!.name).toBe('Item 040');
    const p3 = filterCatalogue(many, NO_CATALOGUE_FILTER, p2.next);
    expect([p3.rows.length, p3.next]).toEqual([15, null]);
    expect(filterCatalogue(many.slice(0, 40), NO_CATALOGUE_FILTER).next).toBeNull();
    const names = [...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.name);
    expect(new Set(names).size).toBe(95);
  });
  it('two rows with one name keep one order across the page break (the id breaks the tie)', () => {
    const twins = Array.from({ length: 42 }, (_, n) => ({ ...all[0]!, id: `t-${String(n).padStart(2, '0')}`, name: 'Same name' }));
    const a = filterCatalogue(twins, NO_CATALOGUE_FILTER);
    const b = filterCatalogue(twins, NO_CATALOGUE_FILTER, a.next);
    expect([...a.rows, ...b.rows].map((r) => r.id)).toEqual(twins.map((r) => r.id));
  });
  it('searches name or brand, ignoring case', () => {
    expect(f({ q: 'ZORVANE' }).rows.length).toBeGreaterThan(0);
    expect(f({ q: 'ZORVANE' }).rows.every((i) => i.brand === 'Zorvane')).toBe(true);
    expect(f({ q: 'oxford' }).rows.every((i) => i.name.toLowerCase().includes('oxford'))).toBe(true);
    expect(f({ q: 'oxford' }).rows).toHaveLength(5);
    expect(f({ q: 'no such thing' }).rows).toEqual([]);
  });
  it('filters by category, brand, colour family and each kind of style', () => {
    expect(f({ category: 'Footwear' }).rows).toHaveLength(5);
    expect(f({ brand: 'Fenwrath' }).rows.every((i) => i.brand === 'Fenwrath')).toBe(true);
    expect(f({ colourFamily: 'Navy' }).rows.every((i) => i.colourFamily === 'Navy')).toBe(true);
    expect(f({ colourFamily: 'Navy' }).rows.length).toBe(8);
    expect(f({ style: 'fit:Slim' }).rows).toHaveLength(10);
    expect(f({ style: 'pattern:Solid' }).rows).toHaveLength(40);
    expect(f({ style: 'pattern:Striped' }).rows).toHaveLength(0);
    expect(f({ style: 'occasion:Casual' }).rows).toHaveLength(40);
    expect(f({ style: 'occasion:Work' }).rows).toHaveLength(0);
    expect(f({ category: 'Tops', colourFamily: 'Navy', style: 'fit:Slim' }).rows).toHaveLength(1);
  });
  it('an empty catalogue gives no rows and no cursor', () => { expect(filterCatalogue([], NO_CATALOGUE_FILTER)).toEqual({ rows: [], next: null }); });
});

describe('from the picker to the item (FR-21, FDD 13)', () => {
  const c = catalogueFromRow(row())!;
  it('the form starts with the catalogue name, colour, category, sub-type and attributes, and saves as that', () => {
    const v = formFromCatalogue(c);
    expect(v).toMatchObject({ category: 'Tops', subType: 'T-shirt', hex: '#111111', name: 'Crew tee - Ink black', nameEdited: true, fit: 'Regular', material: 'Cotton', pattern: 'Solid', seasons: ['Spring'], occasions: ['Casual'] });
    const r = validateForm(v);
    expect(r.ok && r.input.name).toBe('Crew tee - Ink black');
    expect(r.ok && r.input.hex).toBe('#111111');
  });
  it('the attachment carries the id, brand and the size picked (trimmed, none when empty)', () => {
    expect(attachmentOf(c, ' M ')).toEqual({ id: ID, brand: 'Zorvane', sizeValue: 'M' });
    expect(attachmentOf(c, '')).toEqual({ id: ID, brand: 'Zorvane', sizeValue: null });
  });
  it('the item row has origin catalogue, the link, the brand and the size; without an attachment it stays manual with no link', () => {
    const r = validateForm(formFromCatalogue(c));
    if (!r.ok) throw new Error('form');
    expect(itemRow({ ...r.input, catalogue: attachmentOf(c, 'M') }, 'u1', 'NOW')).toMatchObject({ origin: 'catalogue', catalog_item_id: ID, brand: 'Zorvane', size_value: 'M', name: 'Crew tee - Ink black' });
    const plain = itemRow(r.input, 'u1', 'NOW');
    expect(plain.origin).toBe('manual');
    expect(Object.keys(plain)).not.toContain('catalog_item_id');
  });
  it('a price paid or a date makes a purchase, and both are then needed; nothing typed makes none', () => {
    const today = '2026-11-10';
    expect(paidEntered(emptyPaid('INR'))).toBe(false);
    expect(checkPaid({ ...emptyPaid('INR'), store: 'Corner shop' }, today)).toEqual({ ok: true, draft: null });
    expect(checkPaid({ price: '799', currency: 'INR', date: '2026-11-01', store: ' Corner ' }, today)).toEqual({ ok: true, draft: { date: '2026-11-01', store: 'Corner', price: 799, currency: 'INR', quantity: 1, notes: null } });
    const onlyPrice = checkPaid({ ...emptyPaid('INR'), price: '799' }, today);
    expect(onlyPrice.ok === false && Object.keys(onlyPrice.errors)).toEqual(['date']);
    const onlyDate = checkPaid({ ...emptyPaid('INR'), date: '2026-11-01' }, today);
    expect(onlyDate.ok === false && Object.keys(onlyDate.errors)).toEqual(['price']);
    for (const price of ['NaN', 'Infinity', '-5', '1e3', '12.345']) expect(checkPaid({ price, currency: 'INR', date: '2026-11-01', store: '' }, today).ok, price).toBe(false);
    expect(checkPaid({ price: '5', currency: 'INR', date: '2026-11-11', store: '' }, today).ok).toBe(false); // in the future
  });
  it('onboarding sends each choice to its page', () => {
    expect([startPage('popular'), startPage('own'), startPage('skip')]).toEqual(['/catalogue', '/items/new', '/']);
    expect(startPage('x' as never)).toBeUndefined(); // a value outside the table gives no page: the form can only ever send the three fixed ones
  });
});
