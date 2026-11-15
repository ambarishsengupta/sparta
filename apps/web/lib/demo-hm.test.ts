import { describe, expect, it, vi } from 'vitest';
import { hmPhotoId, sourceLink } from './catalogue';
import { hmCatalogue, hmWardrobes, parseHmArticles } from './demo-hm';
import type { HmArticle } from './demo-hm';
import { hmDemoArticles } from './pilot-config';
import { LocalRepository } from './local-repository';
import type { StorageLike } from './local-repository';

// WO-0122: the no-login H&M mode. Every article here is INVENTED (ids 099xxxxxxx, made-up names); nothing is read from the H&M folder.
const SUBS: [HmArticle['category'], HmArticle['subType']][] = [['Tops', 'T-shirt'], ['Tops', 'Shirt'], ['Bottoms', 'Trousers'], ['Footwear', 'Sneakers'], ['Outerwear', 'Jacket'], ['Accessories', 'Belt'], ['Bottoms', 'Shorts'], ['Footwear', 'Sandals']];
const articles: HmArticle[] = Array.from({ length: 120 }, (_, n) => {
  const [category, subType] = SUBS[n % SUBS.length]!;
  return { sku: `099${String(n).padStart(7, '0')}`, name: `Zzyx ${subType} ${n}`, category, subType, rgb: n % 10 === 0 ? null : [n * 2 % 256, 90, 140] };
});
const raw = JSON.stringify(articles.map((a) => [a.sku, a.name, a.category, a.subType, ...(a.rgb ?? [null, null, null])]));
const mem = (): StorageLike => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };

describe('parseHmArticles', () => {
  it('reads the generated rows and drops every row that is not exactly well formed', () => {
    expect(parseHmArticles(raw)).toEqual(articles);
    const bad = [['12345', 'Zzyx short id', 'Tops', 'T-shirt', 1, 2, 3], ['0990000001', '', 'Tops', 'T-shirt', 1, 2, 3], ['0990000002', 'Zzyx', 'Tops', 'Jeans', 1, 2, 3],
      ['0990000003', 'Zzyx', 'Tops', 'T-shirt', 1, 2, 300], ['0990000004', 'Zzyx', 'Tops', 'T-shirt', 1, 2], ['0990000005', 'Zzyx', 'Tops', 'T-shirt', 1, null, 3], 'text', null];
    expect(parseHmArticles(JSON.stringify([...bad, ['0990000006', 'Zzyx ok', 'Tops', 'T-shirt', 1, 2, 3]]))).toHaveLength(1);
  });
  it.each([null, '', 'not json', '{"a":1}', '42'])('gives an empty list for %j', (v) => { expect(parseHmArticles(v)).toEqual([]); });
  it('is empty when the build has no list: the demo stays synthetic', () => {
    vi.stubEnv('NEXT_PUBLIC_HM_DEMO_ARTICLES', '');
    expect(hmDemoArticles()).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_HM_DEMO_ARTICLES', raw);
    expect(hmDemoArticles()).toBe(raw);
    vi.unstubAllEnvs();
    expect(hmWardrobes([])).toEqual({});
  });
});

describe('the H&M catalogue and wardrobes', () => {
  it('gives every picker row a sku and the hm-demo source, so its tile shows the photograph, and a plain id', () => {
    const rows = hmCatalogue(articles);
    expect(rows).toHaveLength(120);
    expect(rows.every((r) => hmPhotoId(r.sku, r.source) === r.sku && r.brand === 'H&M' && /^hm-099[0-9]{7}$/.test(r.id) && /^#[0-9A-F]{6}$/.test(r.hex))).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(120);
    expect(rows.every((r) => r.productUrl === '' && sourceLink(r.productUrl) === null)).toBe(true);   // no "View at source" link, no address
    expect(rows.every((r) => r.source === 'hm-demo' && /^099[0-9]{7}$/.test(r.sku ?? ''))).toBe(true);
  });
  it('builds a 60-item and a 12-item wardrobe of men\'s categories only, each item from an article with its photograph', () => {
    const w = Object.values(hmWardrobes(articles));
    expect(w.map((x) => x.length)).toEqual([60, 12]);
    const skus = new Set(articles.map((a) => a.sku));
    for (const items of w) {
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
      expect(items.every((i) => skus.has(i.photoId) && i.catalogueId === `hm-${i.photoId}` && i.status === 'active')).toBe(true);
    }
    expect(new Set(w[0]!.map((i) => i.category))).toEqual(new Set(['Tops', 'Bottoms', 'Footwear', 'Outerwear', 'Accessories']));
    expect(new Set(w[1]!.map((i) => i.category))).toEqual(new Set(['Tops', 'Bottoms', 'Footwear']));
    expect(hmWardrobes(articles)).toEqual(hmWardrobes([...articles].reverse()));   // no randomness, no dependence on order
  });
  it('gives every picker row and wardrobe item seasons by the accounts-mode rule', () => {
    const items = [...Object.values(hmWardrobes(articles)).flat(), ...hmCatalogue(articles)];
    for (const i of items) {
      const sub = 'subType' in i ? i.subType : '';
      expect(i.seasons).toEqual(i.category === 'Outerwear' ? ['Autumn', 'Winter'] : ['Shorts', 'Sandals', 'T-shirt'].includes(sub) ? ['Spring', 'Summer'] : ['All year']);
    }
  });
  it('skips a slot whose category has no article instead of failing', () => {
    expect(Object.values(hmWardrobes(articles.filter((a) => a.category !== 'Footwear')))[1]!.every((i) => i.category !== 'Footwear')).toBe(true);
  });
});

describe('local repository with H&M articles', () => {
  it('an item picked from an H&M row keeps the photograph id; one picked from another row does not', async () => {
    const rows = hmCatalogue(articles);
    const repo = new LocalRepository(mem(), undefined, rows);
    const base = { name: 'x', category: 'Tops', subType: 'T-shirt', rgb: [1, 2, 3], hex: '#010203', colourFamily: 'Black', pattern: 'Solid', seasons: [], occasions: [], condition: null, favourite: false, status: 'active', fit: null, material: null, neverWorn: false, archiveReason: null } as const;
    const made = await repo.items.create({ ...base, catalogue: { id: rows[0]!.id, brand: 'H&M', sizeValue: 'M' } });
    expect([made.photoId, made.catalogueId]).toEqual([rows[0]!.sku, rows[0]!.id]);
    expect((await repo.items.create({ ...base, catalogue: { id: 'nope', brand: null, sizeValue: null } })).photoId).toBeUndefined();
    expect((await repo.items.create(base)).photoId).toBeUndefined();
  });
  it('with a list in the build, the demo wardrobe list starts with the two H&M wardrobes, drops Office regular from the list (still loadable) and keeps the photograph ids; without one it is unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_HM_DEMO_ARTICLES', raw);
    vi.resetModules();
    const hm = await import('./demo');
    expect((await import('./demo-catalogue')).DEMO_CATALOGUE).toHaveLength(120);   // the picker lists the H&M articles in place of the 40 synthetic items
    expect(hm.DEMO_WARDROBE_NAMES).toHaveLength(6);
    expect(hm.DEMO_WARDROBE_NAMES.slice(0, 2).every((n) => n.startsWith('H&M'))).toBe(true);
    expect(hm.DEMO_WARDROBE_NAMES).not.toContain('Office regular');
    const repo = new LocalRepository(mem());
    expect(await hm.loadDemoWardrobe(repo, hm.DEMO_WARDROBE_NAMES[0]!)).toBe(60);
    expect((await repo.items.list()).every((i) => /^099[0-9]{7}$/.test(i.photoId ?? ''))).toBe(true);
    expect(await hm.loadDemoWardrobe(repo, 'Office regular')).toBeGreaterThan(20);
    vi.unstubAllEnvs();
    vi.resetModules();
    const plain = await import('./demo');
    expect((await import('./demo-catalogue')).DEMO_CATALOGUE).toHaveLength(40);
    expect(plain.DEMO_WARDROBE_NAMES).toHaveLength(5);
    expect(plain.DEMO_WARDROBE_NAMES).toContain('Office regular');
  });
});
