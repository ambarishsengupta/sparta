/// <reference types="node" />
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Nav } from './Nav';
import { FORBIDDEN_STRINGS, brandProblems, cssProblems, inlineStyleProblems, parseRules, tokensOf, vendorTableProblems } from './design-rules';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

// WO-0093: the design system is held by source tests. They read the app's files from DESIGN_ROOT when it is set (the mutation harness points it at a
// scratch copy), otherwise from this app. They never write anything.
const ROOT = process.env.DESIGN_ROOT ?? new URL('..', import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const css = read('app/globals.css');
const moduleCss = read('components/outfits/outfits.module.css');
const vendorCss = read('components/ui/vendor/vendor-charts.module.css');

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
  it('the sign-in link row carries the label style (the stylesheet rule is .auth-links a)', () => {
    expect(read('components/auth/AuthForm.tsx')).toContain('<p className="auth-links">');
    expect(read('components/Nav.tsx')).toContain('buttonClassName="linklike"');
  });
  it('the icon is not a brand mark and the wordmark is plain text in the page font', () => { expect(rule('.brand', 'font-weight')).toBe('500'); });
});
function rule(selector: string, prop: string): string | undefined {
  return parseRules(css).find((r) => r.selector === selector)?.decls.find(([p]) => p === prop)?.[1];
}

/** WO-0094: a mutant anchors on a selector, not on an exact line. `inRule` swaps `from` for `to` inside the one rule `sel` (found wherever it sits on its line) and fails loudly when the rule or the text is missing. */
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function inRule(c: string, sel: string, from: string | RegExp, to: string): string {
  const m = new RegExp(`(^|[}{;/\\n])(\\s*)(${esc(sel)})(\\s*\\{)([^}]*)(\\})`).exec(c);
  if (!m) throw new Error(`mutant anchor: no rule ${sel}`);
  const body = m[5]!.replace(from, to);
  if (body === m[5]) throw new Error(`mutant anchor: rule ${sel} has no ${String(from)}`);
  return c.slice(0, m.index) + m[1] + m[2] + m[3] + m[4] + body + m[6] + c.slice(m.index + m[0].length);
}
describe('each mutant of the design rules is caught (in memory; the scratch-copy run is in workflow/evidence/Demo/WO-0093-mutation.md and WO-0094-mutation.md)', () => {
  const mutants: [string, (c: string) => string, RegExp][] = [
    ['accent too light (not blue enough)', (c) => inRule(c, ':root', '--accent: #1b2bff', '--accent: #cccccc'), /accent-is-blue/],
    ['focus ring removed', (c) => inRule(c, ':focus-visible', /outline:[^;]*;/, 'outline: none;'), /outline-removed|focus-ring-visible/],
    ['focus ring 1px', (c) => inRule(c, ':root', '--ring: 2px', '--ring: 1px'), /token-focus-ring|focus-ring-visible/],
    ['label text 11px', (c) => inRule(c, ':root', '--fs-label: 12px', '--fs-label: 11px'), /font-size-below-12|token-label-size/],
    ['rem text below 12px', (c) => inRule(c, '.muted', 'color:', 'font-size: 0.7rem; color:'), /font-size-below-12/],
    ['radius token not zero', (c) => inRule(c, ':root', '--radius: 0;', '--radius: 6px;'), /token-radius-zero/],
    ['radius set in a component', (c) => inRule(c, '.card', 'display: flex;', 'border-radius: 8px; display: flex;'), /radius:8px/],
    ['forbidden font family', (c) => inRule(c, ':root', /--font:[^;]*;/, "--font: 'Gotham', Georgia, serif;"), /font-family:/],
    ['family inside a font shorthand', (c) => inRule(c, '.skip', 'position: absolute;', 'position: absolute; font: 12px Futura;'), /font-family-in-shorthand/],
    ['gradient background', (c) => inRule(c, '.demo', 'margin-top', 'background: repeating-linear-gradient(45deg, var(--bg), var(--surface) 4px); margin-top'), /gradient/],
    ['box shadow', (c) => inRule(c, '.card', 'display: flex;', 'box-shadow: 0 1px 4px var(--text); display: flex;'), /shadow/],
    ['raw hex colour in a rule', (c) => inRule(c, '.locked', 'color: var(--muted)', 'color: #777777'), /colour-outside-tokens/],
    ['justified text', (c) => inRule(c, 'body', 'text-align: left', 'text-align: justify'), /justified-text/],
    ['touch target 40px on buttons', (c) => inRule(c, ':root', '--target: 44px', '--target: 40px'), /token-touch-target|touch-target-buttons/],
    ['body type 16px', (c) => inRule(c, ':root', '--fs-body: 14px', '--fs-body: 16px'), /token-body-size/],
    ['headings not uppercase', (c) => inRule(c, 'h1, h2, h3', 'text-transform: uppercase', 'text-transform: none'), /headings-uppercase/],
    ['motion without a reduced-motion rule', (c) => c.replace(/@media \(prefers-reduced-motion: reduce\)[^\n]*/, ''), /reduced-motion/],
    ['quotation-mark styling', (c) => inRule(c, '.locked', 'color: var(--muted);', "content: '\"';"), /quote-styling/],
    ['remote font file', (c) => inRule(c, '@font-face', /url\('[^']+'\)/, "url('https://fonts.example.com/x.woff2')"), /font-face-remote/],
    ['wrong @font-face family', (c) => inRule(c, '@font-face', "font-family: 'IBM Plex Mono'", "font-family: 'Futura'"), /font-face-family/],
    // WO-0094
    ['X09 button.linklike min-height 30px', (c) => inRule(c, 'button.linklike', 'min-height: 44px', 'min-height: 30px'), /touch-target-linklike/],
    ['X10 .foot a min-height 20px', (c) => inRule(c, '.foot a', 'min-height: var(--target)', 'min-height: 20px'), /touch-target-foot/],
    ['X11 tile focus ring outside the white box (outline-offset 2px)', (c) => inRule(c, '.item a.button.secondary:focus-visible', 'outline-offset: -5px', 'outline-offset: 2px'), /focus-on-tile-inside-box/],
    ['X12 outline-offset 40px on the base focus rule', (c) => inRule(c, ':focus-visible', 'outline-offset: 2px', 'outline-offset: 40px'), /focus-offset-out-of-bounds/],
    ['X13 tile focus rule removed', (c) => inRule(c, '.item a.button.secondary:focus-visible', 'outline-offset: -5px;', 'color: var(--text);'), /focus-on-tile-inside-box/],
    ['X14 .item .title min-height 20px', (c) => inRule(c, '.item .title', 'min-height: var(--target)', 'min-height: 20px'), /touch-target-item-title/],
    ['X15 invalid border 1px', (c) => inRule(c, "input[aria-invalid='true'], select[aria-invalid='true']", 'border-width: 2px', 'border-width: 1px'), /invalid-border-2px/],
    ['X16 wordmark 14px', (c) => inRule(c, ':root', '--fs-brand: 18px', '--fs-brand: 14px'), /wordmark-18px/],
    ['X17 line length 90ch', (c) => inRule(c, ':root', '--measure: 66ch', '--measure: 90ch'), /line-length-under-70/],
    ['X18 Sign out blue again', (c) => inRule(c, '.bar button.linklike', 'color: var(--text)', 'color: var(--link)'), /signout-like-nav-item/],
    ['X19 auth link 14px sentence case', (c) => inRule(c, '.auth-links a', 'text-transform: uppercase', 'text-transform: none'), /touch-target-auth-links/],
    ['X21 tile focus ring in the theme colour (fails on the white box in the dark theme)', (c) => inRule(c, '.item a.button.secondary:focus-visible', 'outline-color: var(--focus-box)', 'outline-color: var(--focus)'), /focus-tile-colours/],
    ['X22 hovered tile button keeps a black ring on black', (c) => inRule(c, '.item a.button.secondary:hover:focus-visible', 'outline-color: var(--paper)', 'outline-color: var(--black)'), /focus-tile-colours/],
    ['X20 nav can leave an orphan row', (c) => inRule(c, '.bar nav', 'justify-content: space-between', 'justify-content: flex-start'), /nav-row-without-orphan/],
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

// WO-0112: the vendor chart styles are a CSS module (the stylesheet is outside that work order's scope); the same rules apply to them, and each mutant of them is caught
describe('the vendor chart styles follow the design rules (WO-0112)', () => {
  const check = (c: string) => cssProblems(`:root { --fs-body: 14px; } ${c}`).filter((p) => /^(radius:|shadow|gradient|font-size-below|colour-outside|quote|justified)/.test(p));
  it('draw no radius, shadow, gradient, small text or raw colour, and use only tokens that the stylesheet defines', () => {
    expect(check(vendorCss)).toEqual([]);
    const defined = new Set(Object.keys(tokensOf(parseRules(css))));
    expect([...vendorCss.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]!).filter((u) => !defined.has(u))).toEqual([]);
  });
  it.each([
    ['track with a radius', (c: string) => inRule(c, '.track', 'display: block;', 'display: block; border-radius: 4px;'), /radius:4px/],
    ['fill in a raw colour', (c: string) => inRule(c, '.track > span', 'background: var(--accent)', 'background: #1b2bff'), /colour-outside-tokens/],
    ['track with a shadow', (c: string) => inRule(c, '.track', 'display: block;', 'display: block; box-shadow: 0 1px 2px var(--text);'), /shadow/],
    ['value text 11px', (c: string) => inRule(c, '.value', 'font-weight: 500;', 'font-weight: 500; font-size: 11px;'), /font-size-below-12/],
    ['gradient fill', (c: string) => inRule(c, '.track > span', 'background: var(--accent)', 'background: linear-gradient(var(--accent), var(--text))'), /gradient/],
  ])('mutant: %s is caught', (_n, mutate, expected) => {
    const mutated = mutate(vendorCss);
    expect(mutated).not.toBe(vendorCss);
    expect(check(mutated).join(' ')).toMatch(expected);
  });
});

// WO-0114: the global th rule draws a black rule under a header cell; in a vendor table a row header takes the cells' hairline instead
describe('the vendor tables draw one hairline under every row (WO-0114)', () => {
  it('has a row-header override in the vendor module, and the global th rule is still the black one it overrides', () => {
    expect(vendorTableProblems(vendorCss)).toEqual([]);
    expect(parseRules(css).find((r) => r.selector === 'th')?.decls).toContainEqual(['border-bottom-color', 'var(--rule)']);
  });
  it.each([
    ['override removed', (c: string) => c.replace(/\.trend tbody th \{[^}]*\}/, '')],
    ['override in the rule colour', (c: string) => c.replace('.trend tbody th { border-bottom-color: var(--hairline)', '.trend tbody th { border-bottom-color: var(--rule)')],
  ])('mutant: %s is caught', (_n, mutate) => {
    expect(mutate(vendorCss)).not.toBe(vendorCss);
    expect(vendorTableProblems(mutate(vendorCss))).toEqual(['vendor-row-header-rule']);
  });
});

describe('the tab icon and the web manifest follow the design (WO-0094)', () => {
  const icon = read('public/icon.svg');
  const manifest = JSON.parse(read('public/manifest.webmanifest')) as Record<string, unknown>;
  const OLD_GREEN = /#2f4f4f|#faf8f5/i;
  it('icon.svg is a black square with a white S: no corner radius, no old green, no gradient', () => {
    expect(icon).toMatch(/<rect[^>]*width="64"[^>]*height="64"[^>]*fill="#000000"/);
    expect(icon).toMatch(/stroke="#ffffff"/);
    expect(icon).not.toMatch(/\brx=|\bry=|gradient|filter|<text/i);
    expect(icon).not.toMatch(OLD_GREEN);
  });
  it('the manifest is black on white and names the icon', () => {
    expect([manifest.theme_color, manifest.background_color]).toEqual(['#000000', '#ffffff']);
    expect(manifest.icons).toEqual([{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }]);
  });
  it('no file in public/ or the layout brings back the old green', () => {
    for (const [path, text] of Object.entries(sources)) if (path.startsWith('public/') || path === 'app/layout.tsx') expect(text, path).not.toMatch(OLD_GREEN);
  });
  it('mutants: a rounded icon, the old green and the old manifest colour are each caught', () => {
    const bad = (t: string) => /\brx=|#2f4f4f/i.test(t);
    expect(bad(icon.replace('<rect ', '<rect rx="14" '))).toBe(true);
    expect(bad(icon.replace('#000000', '#2f4f4f'))).toBe(true);
    expect(OLD_GREEN.test(JSON.stringify({ ...manifest, theme_color: '#2f4f4f' }))).toBe(true);
  });
});
