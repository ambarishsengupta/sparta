/// <reference types="vite/client" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { a11yProblems } from '../../test-support/a11y';
import { catalogueFromRow, formFromCatalogue } from '../../lib/catalogue';
import { DEMO_CATALOGUE } from '../../lib/demo-catalogue';
import { cssProblems } from '../design-rules';
import { OnboardingForm } from '../consent/OnboardingForm';
import { ItemForm } from '../wardrobe/ItemForm';
import { ItemCard } from '../wardrobe/WardrobeList';
import { CatalogueTile, CatalogueView } from './CatalogueView';
import { SourceLink } from './SourceLink';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const item = catalogueFromRow({
  id: '5c1b3b52-0000-4000-8000-000000000001', name: 'Crew tee - Ink black', brand: 'Zorvane', category: 'Tops', sub_type: 'T-shirt', colour_hex: '#111111', colour_family: 'Black', fit: 'Regular',
  pattern: 'Solid', material: 'Cotton', seasons: [], occasions: [], sizes_available: ['S', 'M'], price: '799', currency: 'INR', product_url: 'https://example.test/p',
})!;

describe('the picker (FR-21, CC6)', () => {
  const out = html(createElement(CatalogueView));
  it('has one h1, a search form, the four filters and no unnamed control', () => {
    expect(out).toContain('<h1>Catalogue</h1>');
    expect(out).toContain('role="search"');
    for (const label of ['Search by name or brand', 'Category', 'Brand', 'Colour family', 'Style']) expect(out).toContain(label);
    expect(a11yProblems(out)).toEqual([]);
  });
  it('a tile shows the illustration with its name, the brand, the price through Intl and a Choose button named for the item', () => {
    const tile = html(createElement('ul', null, createElement(CatalogueTile, { item, onChoose: () => undefined })));
    expect(tile).toContain('role="img"');
    expect(tile).toContain('aria-label="T-shirt illustration"');
    expect(tile).toContain('Zorvane');
    expect(tile).toContain(new Intl.NumberFormat(undefined, { style: 'currency', currency: 'INR' }).format(799));
    expect(tile).toContain('aria-label="Choose Crew tee - Ink black"');
    expect(a11yProblems(tile)).toEqual([]);
  });
  it('the demo tiles never contain an img, an external address or an inline colour other than the illustration fill', () => {
    const tiles = html(createElement('ul', null, DEMO_CATALOGUE.slice(0, 5).map((i) => createElement(CatalogueTile, { key: i.id, item: i, onChoose: () => undefined }))));
    expect(tiles).not.toMatch(/<img|src=|http/);
  });
});

describe('the empty catalogue (CC6)', () => {
  it('says so in plain words and offers Add my own, inside the branch that runs only when a loaded list has no rows and no error', () => {
    const src = read('./CatalogueView.tsx');
    const block = /\{rows !== null && rows\.length === 0 && !error && \(([\s\S]*?)\n {6}\)\}/.exec(src)?.[1] ?? '';
    expect(block).toContain('The catalogue is empty for now.');
    expect(block).toContain('<Link href="/items/new" className="button">Add my own</Link>');
    expect(block).toContain('role="status"');
  });
});

describe('the flagged demo catalogue (re-cut of 2026-11-07)', () => {
  it('the browser-only (local) backend says in the picker that the items are invented demo data, and the account-backed one does not', () => {
    expect(read('./CatalogueView.tsx')).toContain("{dataBackend() === 'local' && <p className=\"muted\" data-demo=\"catalogue\">Demo catalogue: invented items and brands for trying the app.");
  });
});

describe('paging and retry (source checks: no DOM runs in these tests)', () => {
  it('"Show 40 more" appears only when the page gave a cursor and continues after exactly that cursor', () => {
    expect(read('./CatalogueView.tsx')).toContain('{next && <button type="button" onClick={() => void load(next)}>Show 40 more</button>}');
    expect(read('./CatalogueView.tsx')).toContain('repo.catalogue.page(applied, after)');
  });
  it('a save whose purchase failed is retried on the item it already made, never a second item', () => {
    const src = read('../wardrobe/ItemForm.tsx');
    expect(src).toContain('const id = made ?? (await createItemLogged(');
    expect(src).toContain('setMade(id);');
    expect(src.indexOf('setMade(id);')).toBeLessThan(src.indexOf('repo!.purchases.create({ ...bought.draft, itemId: id })'));
  });
});

describe('View at source (FR-24)', () => {
  it('an https address gives a link that opens in a new tab with noopener, noreferrer and nofollow', () => {
    const a = html(createElement(SourceLink, { url: 'https://example.test/p' }));
    expect(a).toBe('<a href="https://example.test/p" target="_blank" rel="noopener noreferrer nofollow">View at source</a>');
  });
  it('anything else gives no link at all', () => {
    for (const url of ['http://example.test/p', 'javascript:alert(1)', 'data:text/html;base64,AAAA', 'example.test']) expect(html(createElement(SourceLink, { url })), url).toBe('');
  });
  it('the tile and the form show the link only through SourceLink (no other anchor to the product address)', () => {
    for (const f of ['./CatalogueView.tsx', './CatalogueFields.tsx']) expect(read(f), f).not.toMatch(/href=\{[^}]*productUrl/);
    expect(read('./CatalogueFields.tsx')).toContain('<SourceLink url={item.productUrl} />');
    expect(read('../wardrobe/ItemForm.tsx')).not.toMatch(/href=\{[^}]*productUrl/);
    expect(read('./CatalogueView.tsx')).toContain('<SourceLink url={item.productUrl} />');
  });
});

describe('the item form from the catalogue (FR-21)', () => {
  const out = html(createElement(ItemForm, { catalogueStart: { item, onCancel: () => undefined } }));
  it('is pre-filled with the catalogue name and colour, shows the illustration, the source link, the brand and the listed price', () => {
    expect(out).toContain('value="Crew tee - Ink black"');
    expect(out).toContain('value="#111111"');
    expect(out).toContain('aria-label="T-shirt illustration"');
    expect(out).toContain('From the catalogue: Zorvane');
    expect(out).toContain('View at source');
    expect(out).toContain('listed at');
  });
  it('puts the picture and source first and the size and price paid last, just before Save', () => {
    const at = (s: string) => out.indexOf(s);
    expect([at('role="img"'), at('Category'), at('Name'), at('>Size<'), at('Price paid (optional)'), at('Save item')]).toEqual([...[at('role="img"'), at('Category'), at('Name'), at('>Size<'), at('Price paid (optional)'), at('Save item')]].sort((a, b) => a - b));
    expect(at('Save item')).toBeGreaterThan(at('Price paid (optional)'));
  });
  it('offers size, price paid, currency, date and store, every control named', () => {
    for (const label of ['Size', 'Price paid (optional)', 'Price of one piece', 'Currency', 'Date', 'Store', 'Rate condition', 'Save item']) expect(out, label).toContain(label);
    expect(a11yProblems(out)).toEqual([]);
  });
  it('shows no size field for an item without sizes, and no catalogue block in the plain form', () => {
    expect(html(createElement(ItemForm, { catalogueStart: { item: { ...item, sizes: [] }, onCancel: () => undefined } }))).not.toContain('>Size<');
    const plain = html(createElement(ItemForm));
    expect(plain).not.toContain('Price paid');
    expect(plain).not.toContain('role="img"');
    expect(formFromCatalogue(item).name).toBe('Crew tee - Ink black');
  });
  it('the save path records the purchase with origin catalogue, only when a price or date was typed', () => {
    const src = read('../wardrobe/ItemForm.tsx');
    expect(src).toContain("'catalogue')).id");
    expect(src).toContain("logPurchase(log, 'catalogue')");
    expect(src).toMatch(/if \(bought\?\.ok && bought\.draft\)/);
  });
});

describe('illustrated tiles in the wardrobe and on the item page (FR-24)', () => {
  const stored = {
    id: 'item-1', name: 'Navy Shirt', category: 'Tops', subType: 'Shirt', rgb: [0, 0, 139], hex: '#00008B', colourFamily: 'Navy', fit: null, material: null, pattern: null, seasons: [], occasions: [], condition: null,
    favourite: false, neverWorn: false, status: 'active', archiveReason: null, createdAt: '', updatedAt: '',
  } as never;
  it('every wardrobe tile draws the category illustration tinted in the stored colour', () => {
    const tile = html(createElement('ul', null, createElement(ItemCard, { item: stored, onArchive: () => undefined, onRestore: () => undefined })));
    expect(tile).toContain('data-category="Tops"');
    expect(tile).toContain('#00008b');
    expect(tile).toContain('aria-label="Shirt illustration"');
    expect(tile).not.toContain('<img');
  });
  it('the old flat colour square is gone and the item page draws the illustration for a loaded item', () => {
    expect(read('../wardrobe/WardrobeList.tsx')).not.toMatch(/style=\{\{ background: item\.hex/);
    expect(read('../wardrobe/ItemForm.tsx')).toMatch(/\{existing && <div className="art">.*CategoryIllustration category=\{existing\.category\} hex=\{existing\.hex\}/);
  });
});

describe('onboarding choice (FR-7)', () => {
  const out = html(createElement(OnboardingForm, { countries: [{ value: 'IN', label: 'India' }], currencies: [{ value: 'INR', label: 'INR - Indian Rupee' }] }));
  it('offers Start from popular items, Add my own and Skip after the questions, all as submit buttons, and no accessibility problem', () => {
    const order = ['id="ob-country"', 'id="ob-currency"', 'Occasions you dress for most', 'Where do you want to start?', 'Start from popular items', 'Add my own', '>Skip<'].map((s) => out.indexOf(s));
    expect(order.every((n) => n > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out.match(/<button type="submit"/g)).toHaveLength(3);
    expect(a11yProblems(out)).toEqual([]);
  });
  it('the country is still checked before any of the three goes anywhere, and each button records its choice and its page', () => {
    const src = read('../consent/OnboardingForm.tsx');
    expect(src.indexOf('validateOnboarding(')).toBeLessThan(src.indexOf('completeOnboarding('));
    expect(src).toContain("start.current = 'popular'");
    expect(src).toContain("start.current = 'own'");
    expect(src).toContain("start.current = 'skip'");
    expect(src).toContain('window.location.assign(startPage(start.current))');
    expect(src).toContain("useRef<StartChoice>('skip')");
  });
});

describe('the thin-wardrobe message links to the catalogue (FR-54)', () => {
  it('the missing-items notice has a link to /catalogue as well as to the wardrobe', () => {
    const src = read('../outfits/OutfitsView.tsx');
    expect(src).toContain('href="/catalogue"');
    expect(src).toContain('Go to your wardrobe to add items');
  });
});

describe('no source image, no external picture (FR-24, BR-41)', () => {
  const sources = (dir: string): string[] => readdirSync(new URL(dir, import.meta.url)).flatMap((n) => {
    const p = `${dir}${n}`;
    return statSync(new URL(p, import.meta.url)).isDirectory() ? (n === 'node_modules' || n === '.next' ? [] : sources(`${p}/`)) : /\.(tsx?|css)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
  const all = [...sources('../../app/'), ...sources('../../components/'), ...sources('../../lib/')];
  it('the scan reads the real source tree', () => { expect(all.length).toBeGreaterThan(60); });
  it('every <img> in the app takes its src from the person\'s own preview or signed storage address, never a literal or catalogue address', () => {
    for (const f of all) {
      for (const m of read(f).matchAll(/<img\b[^>]*>/g)) {
        expect(m[0], f).toMatch(/src=\{(shown|urls\[path\])\}/);
        expect(m[0], f).not.toMatch(/https?:|catalog|productUrl|product_url/i);
      }
    }
  });
  it('the catalogue code has no <img>, no image field, no next/image and no fetch', () => {
    for (const f of all.filter((p) => /catalogue/.test(p) || /demo-catalogue/.test(p))) {
      expect(read(f), f).not.toMatch(/<img|next\/image|\bfetch\(|imageUrl|image_url|<image|background-image|url\(/);
    }
  });
  it('the catalogue and demo files hold no address literal at all (the strict no-network scan covers them)', () => {
    for (const f of all.filter((p) => /catalogue|CatalogueFields|SourceLink/.test(p))) expect(read(f), f).not.toMatch(/https?:\/\//);
  });
});

describe('the new styles follow the design system (WO-0093)', () => {
  const css = read('../../app/globals.css');
  it('every class the catalogue components use is defined in the stylesheet, and nothing sets a style of its own', () => {
    const used = new Set<string>();
    for (const f of ['./CatalogueView.tsx', './CatalogueFields.tsx', './SourceLink.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/style=\{/);
      for (const m of src.matchAll(/className="([^"]+)"/g)) m[1]!.split(/\s+/).forEach((c) => used.add(c));
    }
    for (const c of ['art', 'swatch', 'filters', 'six', 'tiles', 'item', 'list', 'row', 'between', 'muted', 'error', 'grow', 'title', 'card', 'button', 'secondary']) expect(used.has(c) ? css.includes(`.${c}`) : true, c).toBe(true);
    expect([...used].filter((c) => !css.includes(`.${c}`))).toEqual([]);
    expect(css).toMatch(/\.art \{[^}]*width: 10rem/);
    expect(css).toMatch(/\.swatch \{[^}]*background: var\(--paper\)/);
  });
  it('the stylesheet still passes the design rules with the new lines in it', () => { expect(cssProblems(css)).toEqual([]); });
});
