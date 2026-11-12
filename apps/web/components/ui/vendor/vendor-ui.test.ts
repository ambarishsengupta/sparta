/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { a11yProblems } from '../../../test-support/a11y';
import { parseRules } from '../../design-rules';
import { BandShareBar, BarList, MIN_BAR, SUPPRESSED, TrendTable, barWidth, cellKey } from './index';

// WO-0112: the four vendor chart primitives as rendered markup. Props in, markup out: every value is text, a null is the suppressed text, never 0.
// the module's class names carry a hash; the tests read them without it
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el).replace(/class="_([a-z]+)_[0-9a-f]+"/g, 'class="$1"');
const widths = (markup: string) => [...markup.matchAll(/style="width:([\d.]+)%"/g)].map((m) => Number(m[1]));

describe('barWidth', () => {
  it('scales to the largest value and gives a small non-null value a minimum visible width', () => {
    expect(barWidth(50, 100)).toBe(50);
    expect(barWidth(100, 100)).toBe(100);
    expect(barWidth(1, 1000)).toBe(MIN_BAR);
    expect(MIN_BAR).toBeGreaterThanOrEqual(2);
  });
  it('is 0 for null, zero or no maximum, and never above 100', () => {
    expect([barWidth(null, 100), barWidth(0, 100), barWidth(5, 0), barWidth(150, 100)]).toEqual([0, 0, 0, 100]);
  });
});

describe('BarList', () => {
  const markup = html(createElement(BarList, { name: 'Ownership mix by category', rows: [{ label: 'Tops', value: 40, text: '40 users / 27%' }, { label: 'Footwear', value: 5 }, { label: 'Hats', value: null }] }));
  it('prints every value as text next to its bar and gives every bar a role and a name', () => {
    expect(markup).toContain('40 users / 27%');
    expect(markup).toMatch(/<span class="value">5<\/span>/);
    expect(markup.match(/role="meter"/g)).toHaveLength(2);
    expect(markup).toMatch(/aria-label="Tops, Ownership mix by category"[^>]*aria-valuenow="40"[^>]*aria-valuetext="40 users \/ 27%"/);
    expect(markup).toContain('aria-label="Ownership mix by category"');
  });
  it('scales the bars to the largest value, with the minimum width for the small one', () => {
    expect(widths(markup)).toEqual([100, 12.5]);
    expect(widths(html(createElement(BarList, { name: 'x', rows: [{ label: 'a', value: 1000 }, { label: 'b', value: 1 }] })))).toEqual([100, MIN_BAR]);
  });
  it('renders a null as the suppressed text, never as 0 or a bar', () => {
    const row = /<li><span>Hats<\/span>(.*?)<\/li>/.exec(markup)![1]!;
    expect(row).toBe(`<span class="suppressed">${SUPPRESSED}</span>`);
    expect(SUPPRESSED).toBe('Not enough users to display');
    expect(row).not.toMatch(/0|meter/);
  });
  it('has no accessibility problem', () => { expect(a11yProblems(markup)).toEqual([]); });
});

describe('TrendTable', () => {
  const data = { periods: ['2026-10', '2026-11'], segments: ['Tops', 'Shoes'], cells: { [cellKey('Tops', '2026-10')]: 30, [cellKey('Tops', '2026-11')]: 60, [cellKey('Shoes', '2026-11')]: 15 } };
  const markup = html(createElement(TrendTable, { caption: 'Purchases per month', data }));
  it('is a table with a caption, column headers for the months and row headers for the segments', () => {
    expect(markup).toContain('<caption>Purchases per month</caption>');
    expect(markup.match(/<th scope="col"/g)).toHaveLength(3);
    expect(markup).toContain('<th scope="row">Tops</th>');
    expect(markup).toContain('<th scope="row">Shoes</th>');
    expect(a11yProblems(markup)).toEqual([]);
  });
  it('puts a text value and a bar in each visible cell, scaled to the largest value of the table, and the suppressed text in the others', () => {
    for (const v of ['30', '60', '15']) expect(markup).toContain(`<span class="value">${v}</span>`);
    expect(widths(markup)).toEqual([50, 100, 25]);
    expect(markup.match(new RegExp(`<span class="suppressed">${SUPPRESSED}</span>`, 'g'))).toHaveLength(1);
    expect(markup).not.toMatch(/<span class="value">0/);
  });
});

describe('BandShareBar', () => {
  it('shows each share as a percent of 100 and a null band as suppressed', () => {
    const markup = html(createElement(BandShareBar, { category: 'Tops', bands: [{ band: 'Like new', share: 35 }, { band: 'Worn', share: 65 }, { band: 'Falling apart', share: null }] }));
    expect(markup).toContain('<span class="value">35%</span>');
    expect(markup).toContain('<span class="value">65%</span>');
    expect(widths(markup)).toEqual([35, 65]);
    expect(markup).toContain(SUPPRESSED);
    expect(markup).not.toContain('null');
  });
  it('shows one suppressed cell, and no bar, when no band has a share', () => {
    const markup = html(createElement(BandShareBar, { category: 'Hats', bands: [{ band: 'Like new', share: null }, { band: 'Worn', share: null }] }));
    expect(markup).toBe(`<p><span class="suppressed">${SUPPRESSED}</span></p>`);
  });
});

describe('the sources and the styles of the primitives', () => {
  const dir = new URL('.', import.meta.url).pathname;
  const sources = Object.fromEntries(readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.')).map((f) => [f, readFileSync(dir + f, 'utf8')]));
  it('fetch nothing, run nothing, reference nothing outside and draw no shape, shadow or colour of their own', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(5);
    for (const [name, text] of Object.entries(sources)) {
      expect(text, name).not.toMatch(/dangerouslySetInnerHTML|\bfetch\(|XMLHttpRequest|https?:|\/\/[a-z]+\.|@supabase|useEffect|useState|<script|<img|<iframe|url\(/);
      expect(text, name).not.toMatch(/borderRadius|boxShadow|background|fontSize|fontFamily|color:/);
      expect([...text.matchAll(/style=\{\{([^}]*)\}\}/g)].map((m) => m[1]!.trim().split(':')[0])).toSatisfy((props: string[]) => props.every((p) => p === 'width'));
    }
  });
  it('the chart styles are a module of tokens only: a square hairline track, an accent fill, muted suppressed text, no shape, shadow or raw colour', () => {
    const rules = parseRules(readFileSync(new URL('./vendor-charts.module.css', import.meta.url), 'utf8'));
    const decl = (sel: string, prop: string) => rules.find((r) => r.selector === sel)?.decls.find(([p]) => p === prop)?.[1];
    expect(decl('.track', 'background')).toBe('var(--hairline)');
    expect(decl('.track > span', 'background')).toBe('var(--accent)');
    expect(decl('.suppressed', 'color')).toBe('var(--muted)');
    expect(rules.length).toBeGreaterThanOrEqual(8);
    for (const r of rules) for (const [p, v] of r.decls) {
      expect(p).not.toMatch(/radius|shadow/);
      expect(v).not.toMatch(/#[0-9a-f]{3,8}|rgb|gradient/i);
    }
  });
});
