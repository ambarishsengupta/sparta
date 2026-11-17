import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// DESIGN_ROOT points the mutation harness (WO-0093) at a scratch copy of the app; unset, the real stylesheet is read.
const css = readFileSync(process.env.DESIGN_ROOT ? join(process.env.DESIGN_ROOT, 'app/globals.css') : new URL('../app/globals.css', import.meta.url), 'utf8');

// CC6: text must reach 4.5:1 (WCAG 2.2 AA) and control borders 3:1, in the light and the dark token set.
// Checked by reading the CSS variables from globals.css and applying the WCAG relative-luminance formula.
const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const tokens = (block: string): Record<string, string> =>
  Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]));

const dark = /prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)![1]!;
const light = /^:root\s*\{([^}]*)\}/m.exec(css)![1]!;
const themes = { light: tokens(light), dark: { ...tokens(light), ...tokens(dark) } };

const TEXT: [string, string][] = [
  ['text', 'bg'], ['text', 'surface'], ['muted', 'bg'], ['muted', 'surface'], ['link', 'bg'], ['link', 'surface'],
  ['error', 'bg'], ['error', 'surface'], ['on-accent', 'accent'],
  // WO-0093 token pairs: the accent as text and fill, the black button fill, the boxed button over a tile, the disabled text, grey hairline-row text, the focus ring
  ['accent', 'bg'], ['accent', 'surface'], ['on-ink', 'ink'], ['black', 'paper'], ['disabled', 'bg'], ['muted', 'hairline'], ['text', 'hairline'], ['link', 'hairline'], ['focus', 'bg'],
  // WO-0094: the focus ring inside the white box of a tile (blue on the box, white on the black box when hovered)
  ['focus-box', 'paper'], ['paper', 'black'],
  // WO-0112: the vendor bar fill (accent) on its hairline track (the suppressed text is muted on bg, already listed)
  ['accent', 'hairline'],
];
describe.each(Object.entries(themes))('colour contrast, %s theme', (_name, t) => {
  it.each(TEXT)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['bg', 'surface'])('control border on %s is at least 3:1', (bg) => {
    expect(contrast(t.border!, t[bg]!)).toBeGreaterThanOrEqual(3);
  });
  it.each(['bg', 'surface'])('the hairline rule and the focus ring on %s are at least 3:1', (bg) => {
    expect(contrast(t.rule!, t[bg]!)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.focus!, t[bg]!)).toBeGreaterThanOrEqual(3);
  });
  it('the accent is a distinct blue and the error colour does not rely on hue (an icon and weight carry it)', () => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(t.accent!.slice(i, i + 2), 16));
    expect(b!).toBeGreaterThan(r! + 80);
    expect(b!).toBeGreaterThan(g! + 80);
  });
  it('the light theme is a white ground with black text, as the design direction says', () => {
    if (_name !== 'light') return;
    expect([t.bg, t.text, t.rule]).toEqual(['#ffffff', '#000000', '#000000']);
  });
});
describe('contrast helper', () => {
  it('gives 21:1 for black on white', () => { expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5); });
  it('finds both theme blocks in the stylesheet', () => { expect(Object.keys(themes.dark).length).toBeGreaterThan(8); });
});
