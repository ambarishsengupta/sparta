import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

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
];
describe.each(Object.entries(themes))('colour contrast, %s theme', (_name, t) => {
  it.each(TEXT)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['bg', 'surface'])('control border on %s is at least 3:1', (bg) => {
    expect(contrast(t.border!, t[bg]!)).toBeGreaterThanOrEqual(3);
  });
});
describe('contrast helper', () => {
  it('gives 21:1 for black on white', () => { expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5); });
  it('finds both theme blocks in the stylesheet', () => { expect(Object.keys(themes.dark).length).toBeGreaterThan(8); });
});
