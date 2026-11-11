/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '@sparta/taxonomy';
import type { Category } from '@sparta/taxonomy';
import { brandProblems, inlineStyleProblems } from '../../design-rules';
import { CategoryIllustration, GARMENTS } from './CategoryIllustration';
import { contrast, luminance, normaliseHex } from './colour';
import { TILE_PAPER, paintFor, pickDetail, pickOutline } from './paint';

// WO-0084: the nine category illustrations. The contrast maths below is written again here, on purpose, so a slip in colour.ts cannot hide itself.
const HERE = new URL('.', import.meta.url);
const files = readdirSync(HERE).filter((f) => /\.(tsx?|css|svg)$/.test(f) && !f.includes('.test.'));
const source = Object.fromEntries(files.map((f) => [f, readFileSync(new URL(f, HERE), 'utf8')]));
const css = readFileSync(new URL('../../../app/globals.css', import.meta.url), 'utf8');

const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (h: string) => 0.2126 * lin(parseInt(h.slice(1, 3), 16)) + 0.7152 * lin(parseInt(h.slice(3, 5), 16)) + 0.0722 * lin(parseInt(h.slice(5, 7), 16));
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
const lightTokens = tokens(/^:root\s*\{([^}]*)\}/m.exec(css)![1]!);
const darkTokens = { ...lightTokens, ...tokens(/prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)![1]!) };
const PAPER = { light: lightTokens.paper!, dark: darkTokens.paper! };

function mulberry32(seed: number) { let a = seed; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(0x5eed0084);
const RANDOM = Array.from({ length: 200 }, () => '#' + [0, 0, 0].map(() => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join(''));
const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', 'mid-grey': '#808080', 'dark mid-grey': '#777777', navy: '#00008b', yellow: '#ffd400' };
const GREYS = Array.from({ length: 256 }, (_, i) => '#' + i.toString(16).padStart(2, '0').repeat(3));

const render = (category: Category, hex: string, label = 'A garment', tile?: string) => renderToStaticMarkup(createElement(CategoryIllustration, { category, hex, label, tile }));
const strokes = (markup: string) => [...markup.matchAll(/stroke="(#[0-9a-f]{6})"/g)].map((m) => m[1]!);

describe('every category has its own illustration', () => {
  it('the registry holds exactly the nine categories of the taxonomy, each a distinct component', () => {
    expect(CATEGORIES).toHaveLength(9);
    expect(Object.keys(GARMENTS).sort()).toEqual([...CATEGORIES].sort());
    expect(new Set(Object.values(GARMENTS)).size).toBe(9);
  });
  it.each(CATEGORIES)('%s renders an svg with role img, the given label and a filled shape', (category) => {
    const html = render(category, '#1560bd', `Blue ${category}`);
    expect(html).toMatch(/^<svg [^>]*viewBox="0 0 100 100"/);
    expect(html).toContain('role="img"');
    expect(html).toContain(`aria-label="Blue ${category}"`);
    expect(html).toContain(`data-category="${category}"`);
    expect(html).toMatch(/<polygon [^>]*points="[\d, ]+"/);
  });
  it('the nine silhouettes differ from each other', () => {
    const shapes = CATEGORIES.map((c) => /<polygon [^>]*points="([^"]+)"/.exec(render(c, '#ffffff'))![1]);
    expect(new Set(shapes).size).toBe(9);
  });
  it('an empty label falls back to the category name, an unknown category still draws a labelled placeholder', () => {
    expect(render('Tops', '#ffffff', '')).toContain('aria-label="Tops"');
    const html = renderToStaticMarkup(createElement(CategoryIllustration, { category: 'Hats' as Category, hex: '#336699', label: 'Hat' }));
    expect(html).toContain('role="img"');
    expect(html).toContain('fill="#336699"');
  });
  it('the label is escaped, never markup', () => {
    const html = render('Tops', '#ffffff', '"><script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('the garment is tinted in the stored colour', () => {
  it.each(CATEGORIES)('%s: the stored colour is the fill of the silhouette', (category) => {
    for (const hex of ['#1560bd', '#c0392b', '#00008b']) expect(render(category, hex)).toMatch(new RegExp(`<polygon [^>]*fill="${hex}"`));
  });
  it('upper case and three-digit codes are normalised, nothing else is accepted', () => {
    expect(render('Tops', '#1560BD')).toContain('fill="#1560bd"');
    expect(render('Tops', '#f0a')).toContain('fill="#ff00aa"');
    expect(normaliseHex('  #ABCDEF ')).toBe('#abcdef');
    for (const bad of ['', 'red', '#12345', '#1234567', '#gggggg', 'url(#x)', '#fff" onload="x', null, undefined, 42]) expect(normaliseHex(bad)).toBeNull();
  });
  it('a missing or hostile colour gives the neutral fallback and never reaches the markup', () => {
    for (const bad of ['', 'url(https://example.test/x)', '#fff" onload="alert(1)', 'javascript:alert(1)']) {
      const html = render('Bottoms', bad);
      expect(html).toContain('fill="#d4d4d4"');
      expect(html).not.toMatch(/onload|javascript|example\.test|url\(/);
    }
    expect(renderToStaticMarkup(createElement(CategoryIllustration, { category: 'Tops', hex: null, label: 'x' }))).toContain('fill="#d4d4d4"');
  });
});

describe('the outline keeps 3:1 against the tile background (WCAG 1.4.11)', () => {
  it('the tile is the paper token, white in the light and the dark theme', () => {
    expect(PAPER).toEqual({ light: '#ffffff', dark: '#ffffff' });
    expect(TILE_PAPER).toBe(PAPER.light);
    expect(TILE_PAPER).toBe(PAPER.dark);
  });
  it('the contrast maths matches known values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 6);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 6);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 6);
    expect(luminance('#808080')).toBeCloseTo(0.2159, 4);
    expect(luminance('#ff0000')).toBeCloseTo(0.2126, 4);
    expect(luminance('#00ff00')).toBeCloseTo(0.7152, 4);
    expect(luminance('#0000ff')).toBeCloseTo(0.0722, 4);
    expect(luminance('#0a0a0a')).toBeCloseTo(0.003035, 5); // the linear segment of the curve
    for (const [a, b] of [['#1560bd', '#ffd400'], ['#00008b', '#c0c0c0'], ['#123456', '#fedcba']] as const) expect(contrast(a, b)).toBeCloseTo(ratio(a, b), 9);
  });
  describe.each(Object.entries(PAPER))('%s theme, tile %s', (_theme, paper) => {
    it.each(Object.entries(NAMED))('%s tint: the drawn outline is black or white and at least 3:1', (_n, hex) => {
      const used = strokes(render('Tops', hex))[0]!;
      expect(['#000000', '#ffffff']).toContain(used);
      expect(ratio(used, paper)).toBeGreaterThanOrEqual(3);
    });
    it('200 seeded random tints, in every category: at least 3:1, and the markup uses the colour paintFor chose', () => {
      expect(new Set(RANDOM).size).toBeGreaterThan(190);
      RANDOM.forEach((hex, i) => {
        const category = CATEGORIES[i % CATEGORIES.length]!;
        const used = strokes(render(category, hex))[0]!;
        expect(ratio(used, paper), `${category} ${hex}`).toBeGreaterThanOrEqual(3);
        expect(used).toBe(paintFor(hex).outline);
      });
    });
    it('all 256 greys', () => { for (const hex of GREYS) expect(ratio(pickOutline(hex), paper), hex).toBeGreaterThanOrEqual(3); });
  });
  it('the outline is the first stroke drawn and only black or white strokes exist besides the detail line', () => {
    for (const c of CATEGORIES) for (const hex of Object.values(NAMED)) {
      const s = strokes(render(c, hex));
      expect(s.length).toBeGreaterThanOrEqual(2);
      s.forEach((x) => expect(['#000000', '#ffffff']).toContain(x));
      expect(s).toContain(pickDetail(hex));
    }
  });
  it('a different tile still gets 3:1: the choice follows the tile, then the tint (hypothetical dark and mid-grey tiles)', () => {
    const tiles = ['#000000', '#ffffff', '#777777', '#808080', '#1b2bff', '#8c96ff', ...RANDOM.slice(0, 100)];
    for (const tile of tiles) for (const hex of [...Object.values(NAMED), ...RANDOM.slice(100, 130)]) {
      const used = strokes(render('Footwear', hex, 'x', tile))[0]!;
      expect(ratio(used, tile), `tint ${hex} on ${tile}`).toBeGreaterThanOrEqual(3);
    }
    expect(pickOutline('#ffffff', '#000000')).toBe('#ffffff');
    expect(pickOutline('#000000', '#000000')).toBe('#ffffff');
    expect(pickOutline('#000000', '#ffffff')).toBe('#000000');
    expect(pickOutline('#ffffff', '#ffffff')).toBe('#000000');
  });
  it('where both colours qualify (a mid-grey tile) the tint decides: the outline stands out from the garment', () => {
    expect(pickOutline('#000000', '#777777')).toBe('#ffffff');
    expect(pickOutline('#ffffff', '#777777')).toBe('#000000');
    expect(pickOutline('#1b2bff', '#777777')).toBe('#ffffff');
    expect(pickOutline('#ffd400', '#777777')).toBe('#000000');
  });
  it('the detail line inside the garment is black or white by the tint and at least 3:1 against it', () => {
    for (const hex of [...Object.values(NAMED), ...RANDOM, ...GREYS]) {
      expect(ratio(pickDetail(hex), hex), hex).toBeGreaterThanOrEqual(3);
      expect(ratio(pickDetail(hex), hex)).toBeGreaterThanOrEqual(Math.max(ratio('#000000', hex), ratio('#ffffff', hex)) - 1e-9);
    }
    expect(pickDetail('#000000')).toBe('#ffffff');
    expect(pickDetail('#ffffff')).toBe('#000000');
    expect(pickDetail('#ffd400')).toBe('#000000');
    expect(pickDetail('#00008b')).toBe('#ffffff');
  });
});

describe('no external reference, and the drawing is sharp and small', () => {
  const EXTERNAL = /<image|<use|<foreignObject|<script|<style|<link|xlink|href|\burl\(|https?:|\/\/|\bsrc=|\bstyle=|@import|data:|javascript:/i;
  const SOURCE_EXTERNAL = /<image|<use|<foreignObject|<script|<style|xlink|href|\burl\(|https?:|\bsrc=|\bstyle=|@import|data:|javascript:/i; // a source file may hold // comments, so the bare // test is for the markup only
  it('no source file of the directory refers to anything outside itself except react and the taxonomy types', () => {
    expect(files.length).toBeGreaterThanOrEqual(13);
    for (const [name, text] of Object.entries(source)) {
      expect(text, name).not.toMatch(SOURCE_EXTERNAL);
      for (const m of text.matchAll(/(?:from|import)\s+'([^']+)'/g)) expect(m[1]!, name).toMatch(/^(\.\/|react$|@sparta\/taxonomy$)/);
    }
  });
  it('the markup of every category in every test colour has none either', () => {
    for (const c of CATEGORIES) for (const hex of [...Object.values(NAMED), ...RANDOM.slice(0, 20)]) expect(render(c, hex, 'Label')).not.toMatch(EXTERNAL);
  });
  it('only svg, g, polygon and path elements are drawn, with straight segments only (no curves, arcs, circles or rounded joins)', () => {
    for (const c of CATEGORIES) {
      const html = render(c, '#1560bd');
      expect([...new Set([...html.matchAll(/<([a-z]+)/g)].map((m) => m[1]))].sort()).toEqual(['g', 'path', 'polygon', 'svg'].filter((t) => html.includes(`<${t}`)));
      for (const d of [...html.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]!)) expect(d, c).toMatch(/^[MLHVZ\d., -]+$/);
      expect(html).not.toMatch(/stroke-linejoin="(round|bevel)"|stroke-linecap="round"|\brx=|\bry=|<circle|<ellipse|<rect/);
    }
    expect(source['CategoryIllustration.tsx']).toContain('strokeLinejoin="miter"');
  });
  it('each component file is under 2 KB (2,048 bytes)', () => {
    for (const name of ['Tops', 'Bottoms', 'Outerwear', 'Footwear', 'Accessories', 'Underwear', 'Activewear', 'EthnicWear', 'OccasionWear', 'CategoryIllustration']) {
      expect(source[`${name}.tsx`], name).toBeDefined();
    }
    for (const [name, text] of Object.entries(source)) expect(Buffer.byteLength(text), name).toBeLessThan(2048);
  });
  it('the markup of one illustration is small too', () => { for (const c of CATEGORIES) expect(render(c, '#1560bd', 'Label').length).toBeLessThan(1200); });
});

describe('the design rules still hold for these files', () => {
  it('no brand, trademark symbol or proprietary font, no inline radius, shadow or background', () => {
    expect(brandProblems(source)).toEqual([]);
    expect(inlineStyleProblems(source)).toEqual([]);
  });
  it('the scanners really catch what they are for', () => {
    expect(brandProblems({ 'a.tsx': `// ${String.fromCharCode(0x2122)}` })).toHaveLength(1);
    expect(inlineStyleProblems({ 'a.tsx': '<svg style={{ borderRadius: 4 }} />' })).toHaveLength(1);
  });
});
