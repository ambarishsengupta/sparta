/// <reference types="node" />
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Nav } from './Nav';
import { FORBIDDEN_STRINGS, brandProblems, cssProblems, inlineStyleProblems, parseRules, tokensOf } from './design-rules';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

// WO-0093: the design system is held by source tests. They read the app's files from DESIGN_ROOT when it is set (the mutation harness points it at a
// scratch copy), otherwise from this app. They never write anything.
const ROOT = process.env.DESIGN_ROOT ?? new URL('..', import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const css = read('app/globals.css');
const moduleCss = read('components/outfits/outfits.module.css');

const TEXT_EXT = /\.(tsx?|css|md|json|svg|html|webmanifest|txt|mjs|js)$/;
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'coverage'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (TEXT_EXT.test(name) && name !== 'design-rules.ts' && name !== 'design.test.ts') out.push(p);
  }
  return out;
}
const sources = Object.fromEntries(walk(ROOT).map((p) => [relative(ROOT, p), readFileSync(p, 'utf8')]));
const tsx = Object.fromEntries(Object.entries(sources).filter(([p]) => p.endsWith('.tsx') && !p.includes('.test.')));

describe('the stylesheet follows the design direction', () => {
  it('passes every rule of cssProblems', () => { expect(cssProblems(css)).toEqual([]); });
  it('the outfit styles follow the same rules (no radius, shadow, gradient, small text or raw colour)', () => {
    const hits = cssProblems(`:root { --fs-body: 14px; } ${moduleCss}`).filter((p) => /^(radius:|shadow|gradient|font-size-below|colour-outside|quote|justified)/.test(p));
    expect(hits).toEqual([]);
  });
  it('the module styles use only tokens that the stylesheet defines', () => {
    const defined = new Set(Object.keys(tokensOf(parseRules(css))));
    const used = [...moduleCss.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]!);
    expect(used.filter((u) => !defined.has(u))).toEqual([]);
  });
  it('no component draws a radius, shadow, font or raw background of its own', () => { expect(inlineStyleProblems(tsx)).toEqual([]); });
  it('the font files named by the stylesheet exist and the licence and provenance notes sit with them', () => {
    const urls = [...css.matchAll(/url\('([^']+\.woff2)'\)/g)].map((m) => m[1]!);
    expect(urls.length).toBe(2);
    for (const u of urls) expect(existsSync(join(ROOT, 'app', u))).toBe(true);
    const readme = read('components/fonts/README.md');
    for (const must of ['IBM Plex Mono', 'SIL Open Font License 1.1', '@fontsource/ibm-plex-mono', '5.3.0']) expect(readme).toContain(must);
    expect(read('components/fonts/OFL.txt')).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });
});

describe('no brand, trademark symbol or proprietary font of the reference appears anywhere in apps/web', () => {
  it('scans every source, style, markup and note file', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(brandProblems(sources)).toEqual([]);
  });
  it('knows what to look for (the brand name in three spellings, the two trademark symbols and their entities, proprietary type names)', () => {
    expect(FORBIDDEN_STRINGS.length).toBeGreaterThanOrEqual(20);
    expect(brandProblems({ a: 'x ™' })).toHaveLength(1);
    expect(brandProblems({ a: 'x ®' })).toHaveLength(1);
    expect(brandProblems({ a: 'fine text, IBM Plex Mono, Helvetica, Arial' })).toEqual([]);
  });
});

describe('the header carries the wordmark and the DEMO label (Release 0)', () => {
  it('shows SPARTA and a visible DEMO tag before the navigation', () => {
    const html = renderToStaticMarkup(createElement(Nav));
    expect(html).toMatch(/class="brand"[^>]*>Sparta<\/a><span class="demo-tag">Demo<\/span><nav/);
    expect(rule('.brand', 'text-transform')).toBe('uppercase');
    expect(rule('.demo-tag', 'text-transform')).toBe('uppercase');
    expect(rule('.demo-tag', 'border')).toContain('solid var(--rule)');
  });
  it('the Nav source in this tree carries the label (the scratch-copy harness reads it from DESIGN_ROOT)', () => {
    expect(read('components/Nav.tsx')).toContain('<span className="demo-tag">Demo</span>');
  });
  it('the icon is not a brand mark and the wordmark is plain text in the page font', () => { expect(rule('.brand', 'font-weight')).toBe('500'); });
});
function rule(selector: string, prop: string): string | undefined {
  return parseRules(css).find((r) => r.selector === selector)?.decls.find(([p]) => p === prop)?.[1];
}

describe('each mutant of the design rules is caught (in memory; the scratch-copy run is in workflow/evidence/Demo/WO-0093-mutation.md)', () => {
  const mutants: [string, (c: string) => string, RegExp][] = [
    ['accent too light (not blue enough)', (c) => c.replace('--accent: #1b2bff', '--accent: #cccccc'), /accent-is-blue/],
    ['focus ring removed', (c) => c.replace(':focus-visible { outline: var(--ring) solid var(--focus); outline-offset: 2px; }', ':focus-visible { outline: none; }'), /outline-removed|focus-ring-visible/],
    ['focus ring 1px', (c) => c.replace('--ring: 2px', '--ring: 1px'), /token-focus-ring|focus-ring-visible/],
    ['label text 11px', (c) => c.replace('--fs-label: 12px', '--fs-label: 11px'), /font-size-below-12|token-label-size/],
    ['rem text below 12px', (c) => c.replace('.muted { color', '.muted { font-size: 0.7rem; color'), /font-size-below-12/],
    ['radius token not zero', (c) => c.replace('--radius: 0;', '--radius: 6px;'), /token-radius-zero/],
    ['radius set in a component', (c) => c.replace('.card { display: flex;', '.card { border-radius: 8px; display: flex;'), /radius:8px/],
    ['forbidden font family', (c) => c.replace("--font: 'IBM Plex Mono', Helvetica, Arial, sans-serif", "--font: 'Gotham', Georgia, serif"), /font-family:/],
    ['family inside a font shorthand', (c) => c.replace('.skip {', ".skip { font: 12px Futura;"), /font-family-in-shorthand/],
    ['gradient background', (c) => c.replace('.demo { margin-top', '.demo { background: repeating-linear-gradient(45deg, var(--bg), var(--surface) 4px); margin-top'), /gradient/],
    ['box shadow', (c) => c.replace('.card { display: flex;', '.card { box-shadow: 0 1px 4px var(--text); display: flex;'), /shadow/],
    ['raw hex colour in a rule', (c) => c.replace('.locked { color: var(--muted); }', '.locked { color: #777777; }'), /colour-outside-tokens/],
    ['justified text', (c) => c.replace('text-align: left; overflow-wrap', 'text-align: justify; overflow-wrap'), /justified-text/],
    ['touch target 40px on buttons', (c) => c.replace('--target: 44px', '--target: 40px'), /token-touch-target|touch-target-buttons/],
    ['body type 16px', (c) => c.replace('--fs-body: 14px', '--fs-body: 16px'), /token-body-size/],
    ['headings not uppercase', (c) => c.replace('h1, h2, h3 { font-weight: 500; text-transform: uppercase;', 'h1, h2, h3 { font-weight: 500; text-transform: none;'), /headings-uppercase/],
    ['motion without a reduced-motion rule', (c) => c.replace(/@media \(prefers-reduced-motion: reduce\)[^\n]*/, ''), /reduced-motion/],
    ['quotation-mark styling', (c) => c.replace('.locked { color: var(--muted); }', ".locked::before { content: '\"'; }"), /quote-styling/],
    ['remote font file', (c) => c.replace("url('../components/fonts/ibm-plex-mono-latin-400-normal.woff2')", "url('https://fonts.example.com/x.woff2')"), /font-face-remote/],
    ['wrong @font-face family', (c) => c.replace("font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 500", "font-family: 'Futura'; font-style: normal; font-weight: 500"), /font-face-family/],
  ];
  it.each(mutants)('%s', (_name, mutate, expected) => {
    const mutated = mutate(css);
    expect(mutated).not.toBe(css); // the mutation really changed the file
    expect(cssProblems(mutated).join(' ')).toMatch(expected);
  });
  it('a brand string, a trademark symbol and a proprietary font name are each caught in a component or note', () => {
    expect(brandProblems({ 'x.tsx': `<p>${['Off', 'White'].join('-')}</p>` })).toHaveLength(1);
    expect(brandProblems({ 'x.tsx': '<p>Sparta™</p>' })).toHaveLength(1);
    expect(brandProblems({ 'x.css': `font-family: ${['Neue', 'Haas'].join(' ')};` })).toHaveLength(1);
  });
  it('an inline radius or shadow in a component is caught', () => {
    expect(inlineStyleProblems({ 'a.tsx': '<span style={{ borderRadius: 4 }} />' })).toHaveLength(1);
    expect(inlineStyleProblems({ 'a.tsx': "<span style={{ background: item.hex }} />" })).toEqual([]);
  });
});
