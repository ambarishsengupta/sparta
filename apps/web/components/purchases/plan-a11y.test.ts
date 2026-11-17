import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { a11yProblems } from '../../test-support/a11y';
import type { WishlistEntry } from '../../lib/repository';
import { emptyPlan } from '../../lib/wishlist-plan';
import { cssProblems } from '../design-rules';
import { PlanForm } from './PlanForm';
import { PlanGroups } from './PlanGroups';
import { WishlistView } from './WishlistView';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const entry = (id: string, over: Partial<WishlistEntry> = {}): WishlistEntry => ({ id, name: `Piece ${id}`, subType: 'Coat', note: null, createdAt: 'T', ...over });
const none = async () => null;
const planForm = (over: Partial<Parameters<typeof PlanForm>[0]> = {}) => createElement(PlanForm, { initial: emptyPlan('EUR'), current: null, currency: 'EUR', onSubmit: none, onCancel: () => undefined, ...over });
const groups = (entries: WishlistEntry[]) => createElement(PlanGroups, { entries, renderEntry: (e: WishlistEntry) => createElement('li', { key: e.id }, e.name) });

describe('the plan screens: structure and accessible names (CC3, FR-36)', () => {
  it('the wishlist screen still has one h1 and no problems', () => {
    const out = html(createElement(WishlistView));
    expect(out).toContain('<h1>Wishlist</h1>');
    expect(a11yProblems(out)).toEqual([]);
  });
  it('the plan form names every field, offers the profile currency first, and removes a plan only when there is one', () => {
    const out = html(planForm());
    expect(a11yProblems(out)).toEqual([]);
    for (const label of ['Planned month', 'Budget (optional)', 'Currency']) expect(out).toContain(label);
    expect(out).toContain('type="month"');
    expect(out).toMatch(/<option[^>]*>EUR<\/option><option[^>]*>USD<\/option>/);
    expect(out).toContain('Save plan');
    expect(out).not.toContain('Remove plan');
    const editing = html(planForm({ initial: { month: '2026-12', budget: '10.00', currency: 'GBP' }, current: '2026-12', onRemove: none }));
    expect(editing).toContain('Remove plan');
    expect(editing).toContain('value="2026-12"');
    expect(a11yProblems(editing)).toEqual([]);
  });
  it('the plan groups: a section per month, earliest first, a labelled total per currency, and the unplanned entries apart', () => {
    const out = html(groups([
      entry('a', { plannedMonth: '2027-01', budget: 10, currency: 'EUR' }), entry('b', { plannedMonth: '2026-12', budget: 20, currency: 'EUR' }),
      entry('c', { plannedMonth: '2026-12', budget: 5, currency: 'USD' }), entry('d'),
    ]));
    expect(a11yProblems(out)).toEqual([]);
    expect(out.indexOf('December 2026')).toBeGreaterThan(-1);
    expect(out.indexOf('December 2026')).toBeLessThan(out.indexOf('January 2027'));
    expect(out).toContain('aria-label="Budget for December 2026"');
    expect(out).toMatch(/<dt>EUR<\/dt><dd>€20\.00<\/dd>/);
    expect(out).toMatch(/<dt>USD<\/dt><dd>\$5\.00<\/dd>/);
    expect(out).not.toMatch(/\$25|€25/); // never summed across currencies
    expect(out.indexOf('Not planned')).toBeGreaterThan(out.indexOf('January 2027'));
    expect(out.split('<h1').length - 1).toBe(0);
  });
  it('with nothing planned the Plan section says so and every entry is under Not planned; with all planned there is no Not planned group', () => {
    const empty = html(groups([entry('a')]));
    expect(empty).toContain('Nothing is planned yet');
    expect(empty).toContain('Not planned');
    const all = html(groups([entry('a', { plannedMonth: '2026-12' })]));
    expect(all).not.toContain('Not planned');
    expect(all).toContain('No budget set for this month.');
  });
});

describe('the plan screens follow the design system (WO-0093)', () => {
  const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');
  it('the stylesheet still passes every design rule, and the month input has the 44px target like the date input', () => {
    expect(cssProblems(css)).toEqual([]);
    expect(css).toMatch(/input\[type='month'\]/);
  });
  it('the plan components set no style of their own and every class they use is defined', () => {
    for (const f of ['PlanForm.tsx', 'PlanGroups.tsx', 'WishlistView.tsx']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/style=\{|#[0-9a-fA-F]{3,6}\b|rgb\(/);
      for (const m of src.matchAll(/className="([^"]+)"/g)) for (const c of m[1]!.split(/\s+/)) expect(css, `${f} .${c}`).toMatch(new RegExp(`\\.${c}\\b`));
    }
  });
});
