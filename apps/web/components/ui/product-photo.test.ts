/// <reference types="vite/client" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { a11yProblems } from '../../test-support/a11y';
import { CATALOGUE_SELECT, catalogueFromRow, hmPhotoId } from '../../lib/catalogue';
import { itemFromRow } from '../../lib/supabase/mapping';
import { CatalogueTile } from '../catalogue/CatalogueView';
import { ItemCard } from '../wardrobe/WardrobeList';
import { ProductPhoto } from './ProductPhoto';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const ID = '0990000001';
const row = { id: '5c1b3b52-0000-4000-8000-000000000002', name: 'Zzyx tee', brand: 'H&M', category: 'Tops', sub_type: 'T-shirt', colour_hex: '#111111', colour_family: 'Black', seasons: [], occasions: [], sizes_available: [], product_url: 'x' };
const hm = catalogueFromRow({ ...row, sku: ID, product_url: `http://127.0.0.1/hm-demo/${ID}`, sources: { name: 'hm-demo' } })!;
const other = catalogueFromRow({ ...row, sku: ID, product_url: 'https://example.test/p', sources: { name: 'other-shop' } })!;

describe('the catalogue row knows its sku and source (WO-0121)', () => {
  it('takes the source name from the embedded source, never from the shape of the product link', () => {
    expect(hm).toMatchObject({ sku: ID, source: 'hm-demo' });
    expect(other).toMatchObject({ sku: ID, source: 'other-shop' });
    // a link in the loader's local shape without an embedded source (or with an empty or malformed one) names no source
    for (const sources of [undefined, null, {}, { name: '' }, { name: 7 }, [{ name: 'hm-demo' }], 'hm-demo']) {
      expect(catalogueFromRow({ ...row, sku: ID, product_url: `http://127.0.0.1/hm-demo/${ID}`, sources })!.source).toBeUndefined();
    }
    expect(CATALOGUE_SELECT).toContain('sources(name)');
  });
  it('gives a photo id only for the hm-demo source and a 10-digit sku', () => {
    expect(hmPhotoId(hm.sku, hm.source)).toBe(ID);
    expect(hmPhotoId(other.sku, other.source)).toBeNull();
    expect(hmPhotoId('123', 'hm-demo')).toBeNull();
    expect(hmPhotoId(undefined, 'hm-demo')).toBeNull();
  });
  it('a stored item carries catalogueId when it has catalog_item_id, and nothing when it has none', () => {
    const base = { id: 'i1', name: 'n', category: 'Tops', sub_type: 'T-shirt', colour_r: 1, colour_g: 2, colour_b: 3, colour_hex: '#010203', colour_family: 'Black', fit: null, material: null, pattern: null, seasons: [], occasions: [], condition: null, never_worn: false, favourite: false, status: 'active', archive_reason: null, created_at: 'a', updated_at: 'b' };
    expect(itemFromRow({ ...base, catalog_item_id: row.id }).catalogueId).toBe(row.id);
    expect('catalogueId' in itemFromRow({ ...base, catalog_item_id: null })).toBe(false);
  });
});

describe('ProductPhoto and the three places that use it', () => {
  it('shows a square-ready, lazy, named photograph from the same-origin path', () => {
    const out = html(createElement(ProductPhoto, { id: ID, name: 'Zzyx tee', children: createElement('svg') }));
    expect(out).toContain(`src="/hm-image/${ID}"`);
    expect(out).toContain('alt="Zzyx tee"');
    expect(out).toContain('loading="lazy"');
    expect(out).not.toContain('<svg');
    expect(a11yProblems(out)).toEqual([]);
  });
  it.each([null, undefined, '', '123', '099000000a', '0990000001/../x'])('shows the illustration for the id %j', (id) => {
    const out = html(createElement(ProductPhoto, { id, name: 'n', children: createElement('svg') }));
    expect(out).toBe('<svg></svg>');
  });
  it('falls back to the illustration when the photograph fails to load', () => {
    const src = ProductPhoto.toString();
    expect(src).toContain('setFailed(true)');
    expect(src).toMatch(/failed/);
  });
  it('catalogue tiles: a photograph for an hm-demo row, the illustration for any other row', () => {
    const tile = (i: typeof hm) => html(createElement('ul', null, createElement(CatalogueTile, { item: i, onChoose: () => undefined })));
    expect(tile(hm)).toContain(`<img class="photo" src="/hm-image/${ID}" alt="Zzyx tee"`);
    expect(tile(hm)).not.toContain('<svg');
    expect(tile(other)).not.toContain('<img');
    expect(tile(other)).toContain('aria-label="T-shirt illustration"');
    expect(a11yProblems(tile(hm))).toEqual([]);
  });
  it('wardrobe tiles: a photograph for an item with photoId, the illustration otherwise', () => {
    const base = { id: 'i1', name: 'Zzyx tee', category: 'Tops', subType: 'T-shirt', hex: '#010203', colourFamily: 'Black', condition: null, favourite: false, status: 'active', archiveReason: null, seasons: [], occasions: [], rgb: [1, 2, 3] } as unknown as Parameters<typeof ItemCard>[0]['item'];
    const card = (item: typeof base) => html(createElement('ul', null, createElement(ItemCard, { item, onArchive: () => undefined, onRestore: () => undefined })));
    expect(card({ ...base, photoId: ID })).toContain(`src="/hm-image/${ID}" alt="Zzyx tee"`);
    expect(card(base)).not.toContain('<img');
    expect(card(base)).toContain('illustration');
  });
});
