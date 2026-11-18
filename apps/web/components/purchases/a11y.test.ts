import { readFileSync, readdirSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { a11yProblems } from '../../test-support/a11y';
import { emptyPurchase } from '../../lib/purchase-form';
import { cssProblems } from '../design-rules';
import { ItemPurchases } from './ItemPurchases';
import { PurchaseForm } from './PurchaseForm';
import { PurchasesView } from './PurchasesView';
import { WishlistView } from './WishlistView';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const form = (needsColour: boolean) => createElement(PurchaseForm, { initial: emptyPurchase('2026-11-07', 'EUR'), currency: 'EUR', submitLabel: 'Save purchase', needsColour, onSubmit: async () => null, onCancel: () => undefined });

describe('the purchase screens: structure and accessible names (CC3)', () => {
  it('the Purchases tab has one h1, named filters and no unnamed control', () => {
    const out = html(createElement(PurchasesView));
    expect(out).toContain('<h1>Purchases</h1>');
    for (const label of ['Period', 'From', 'To', 'Store', 'Brand', 'Category']) expect(out).toContain(label);
    expect(a11yProblems(out)).toEqual([]);
  });
  it('the wishlist screen has one h1 and no problems', () => {
    const out = html(createElement(WishlistView));
    expect(out).toContain('<h1>Wishlist</h1>');
    expect(a11yProblems(out)).toEqual([]);
  });
  it('the purchase form names every field, offers the profile currency first, and asks for a colour only when told to', () => {
    const plain = html(form(false));
    expect(a11yProblems(plain)).toEqual([]);
    for (const label of ['Price of one piece', 'Currency', 'Quantity', 'Date', 'Store', 'Notes']) expect(plain).toContain(label);
    expect(plain).toMatch(/<option[^>]*>EUR<\/option><option[^>]*>USD<\/option>/);
    expect(plain).not.toContain('Colour of the item');
    const coloured = html(form(true));
    expect(coloured).toContain('Colour of the item');
    expect(a11yProblems(coloured)).toEqual([]);
  });
  it('the item panel shows nothing until the item is known to exist', () => { expect(html(createElement(ItemPurchases, { itemId: 'x' }))).toBe(''); });
});

describe('the new styles follow the design system (WO-0093)', () => {
  const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');
  it('every class the purchase components use is defined in the stylesheet, and nothing sets a style of its own', () => {
    const dir = new URL('./', import.meta.url);
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      expect(src, f).not.toMatch(/style=\{/);
      for (const m of src.matchAll(/className="([^"]+)"/g)) m[1]!.split(/\s+/).forEach((c) => used.add(c));
    }
    expect([...used].filter((c) => !new RegExp(`\\.${c}\\b`).test(css))).toEqual([]);
    for (const own of ['.totals {', '.amount {', '.panel {', '.card.line {']) expect(css).toContain(own); // the rule itself, not only a descendant rule
    expect([...used]).toEqual(expect.arrayContaining(['totals', 'amount', 'panel', 'card', 'line', 'list']));
  });
  it('the stylesheet with the new rules passes every design rule, and dates inputs have the 44px target', () => {
    expect(cssProblems(css)).toEqual([]);
    expect(css).toMatch(/input\[type='date'\]/);
    expect(css).toMatch(/\.totals dd \{[^}]*font-size: var\(--fs-h2\)/);
  });
  it('a button that is aria-disabled looks locked, hover included (WO-0156): reduced emphasis, not-allowed cursor, existing tokens only', () => {
    const rule = /button\[aria-disabled="true"\], button\[aria-disabled="true"\]:hover \{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/color: var\(--disabled\)/);
    expect(rule![1]).toMatch(/border-color: var\(--disabled\)/);
    expect(rule![1]).toMatch(/cursor: not-allowed/);
  });
});
