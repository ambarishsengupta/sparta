import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { INITIAL, pivot, withHidden } from '../../lib/vendor/dashboard';
import type { GapRow } from '../../lib/vendor/insights';
import { NO_BRAND_LABELS } from '../../lib/vendor/brands';
import { brandLabel, segmentLabel, trendLabels } from './brand-label';
import { DashboardView, type ViewProps } from './Dashboard';
import { GapsView, type GapsViewProps } from './Gaps';

// WO-0125 step 9: the vendor functions return a brand as its code. The screen shows it without `demo-` and with capitalised words (the label is not in the answer).
const html = (el: ReactElement) => renderToStaticMarkup(el).replace(/class="_([a-z]+)_[0-9a-f]+"/g, 'class="$1"');
const ok = <T,>(data: T) => ({ ok: true as const, data });

describe('brandLabel and segmentLabel', () => {
  it('drops the demo- prefix and capitalises each word', () => {
    expect(brandLabel('demo-h-and-m')).toBe('H And M');
    expect(brandLabel('demo-zor-vane')).toBe('Zor Vane');
    expect(brandLabel('marlow-thistle')).toBe('Marlow Thistle');
    expect(brandLabel('H&M')).toBe('H&M');   // a label that is already one is left alone
    expect(brandLabel('demo-')).toBe('');
  });
  it('changes the brand part of the brand dimensions only', () => {
    expect(segmentLabel('brand', 'demo-corvin-hale')).toBe('Corvin Hale');
    expect(segmentLabel('category_brand', 'Tops / demo-h-and-m')).toBe('Tops / H And M');
    expect(segmentLabel('category', 'demo-looking-category')).toBe('demo-looking-category');
    expect(segmentLabel('colour_family', 'Blue')).toBe('Blue');
  });
  it('relabels a trend table with its cells following their segment, and leaves other dimensions as they are', () => {
    const rows = [{ period: '2026-11-01', segment: 'demo-h-and-m', users_rounded: 15, events_rounded: 20 }, { period: '2026-11-01', segment: 'demo-zor-vane', users_rounded: null, events_rounded: null }];
    const data = pivot([], rows, 'events_rounded');
    const out = trendLabels('brand', data);
    expect(out.segments).toEqual(['H And M', 'Zor Vane']);
    expect(out.cells).toEqual({ 'H And M\u00002026-11': 20, 'Zor Vane\u00002026-11': null });
    expect(trendLabels('category', data)).toBe(data);
  });
});

describe('the screens show the label, not the code', () => {
  const base: ViewProps = {
    s: { ...INITIAL, mixDim: 'brand', trendDim: 'brand' },
    header: { coverage: ok({ users_rounded: 150, last_run_at: null }), options: ok([]) },
    mix: ok(withHidden([{ segment: 'demo-h-and-m', users_rounded: 60 }, { segment: 'demo-zor-vane', users_rounded: 30 }], [{ segment: 'demo-h-and-m', users_rounded: 60 }])),
    trends: { purchase: ok(pivot([], [{ period: '2026-11-01', segment: 'demo-h-and-m', users_rounded: null, events_rounded: 45 }], 'events_rounded')), wishlist: ok(pivot([], [{ period: '2026-11-01', segment: 'demo-h-and-m', users_rounded: 25, events_rounded: null }], 'users_rounded')) },
    spectrum: ok([]), onPick: () => {}, onFilter: () => {},
  };
  it('dashboard: ownership mix and both trend tables', () => {
    const m = html(createElement(DashboardView, base));
    expect(m).not.toContain('demo-');
    expect(m).toContain('<span>H And M</span>');
    expect(m).toContain('<span>Zor Vane</span>');
    expect(m).toContain('<th scope="row">H And M</th>');
    expect(m).toMatch(/H And M, 2026-11/);
  });
  it('dashboard: other dimensions are untouched', () => {
    const m = html(createElement(DashboardView, { ...base, s: INITIAL, mix: ok(withHidden([{ segment: 'Tops', users_rounded: 60 }], [{ segment: 'Tops', users_rounded: 60 }])) }));
    expect(m).toContain('<span>Tops</span>');
  });
  it('gaps: the brand dimensions', () => {
    const row = (segment: string): GapRow => ({ segment, owner_users_rounded: 10, wishlist_users_rounded: 30, gap_score: 3, label: null });
    const props: GapsViewProps = { dim: 'category_brand', filter: null, options: ok([]), data: ok({ rows: [row('Tops / demo-h-and-m')], hidden: ['Shoes / demo-zor-vane'] }), onDim: () => {}, onFilter: () => {} };
    const m = html(createElement(GapsView, props));
    expect(m).not.toContain('demo-');
    expect(m).toContain('<th scope="row">Tops / H And M</th>');
    expect(m).toContain('<th scope="row">Shoes / Zor Vane</th>');
  });
});

// WO-0155: the label of catalog.lk_brand wins for a known code; the guess stays for an unknown code, while the map loads (empty map) and when it failed (empty map).
describe('the label map', () => {
  const labels = new Map([['demo-h-and-m', 'H&M']]);
  it('a known code shows its label, an unknown code the guess, an empty map the guess', () => {
    expect(brandLabel('demo-h-and-m', labels)).toBe('H&M');
    expect(brandLabel('demo-zor-vane', labels)).toBe('Zor Vane');
    expect(brandLabel('demo-h-and-m', NO_BRAND_LABELS)).toBe('H And M');
    expect(brandLabel('constructor', labels)).toBe('Constructor');   // no inherited property is taken for a label
  });
  it('segments and trend tables use the map; the cells stay keyed by their segment', () => {
    expect(segmentLabel('brand', 'demo-h-and-m', labels)).toBe('H&M');
    expect(segmentLabel('category_brand', 'Tops / demo-h-and-m', labels)).toBe('Tops / H&M');
    expect(segmentLabel('category', 'demo-h-and-m', labels)).toBe('demo-h-and-m');
    const rows = [{ period: '2026-11-01', segment: 'demo-h-and-m', users_rounded: 15, events_rounded: 20 }, { period: '2026-11-01', segment: 'demo-zor-vane', users_rounded: null, events_rounded: null }];
    const out = trendLabels('brand', pivot([], rows, 'events_rounded'), labels);
    expect(out.segments).toEqual(['H&M', 'Zor Vane']);
    expect(out.cells).toEqual({ 'H&M\u00002026-11': 20, 'Zor Vane\u00002026-11': null });
  });
  it('the screens show the label for a known code and the guess for an unknown one', () => {
    const s = { ...INITIAL, mixDim: 'brand' as const, trendDim: 'brand' as const };
    const view = (brands: ViewProps['brands']) => html(createElement(DashboardView, {
      s, header: { coverage: ok({ users_rounded: 150, last_run_at: null }), options: ok([]) }, mix: ok(withHidden([{ segment: 'demo-h-and-m', users_rounded: 60 }, { segment: 'demo-zor-vane', users_rounded: 30 }], [])),
      trends: { purchase: ok(pivot([], [{ period: '2026-11-01', segment: 'demo-h-and-m', users_rounded: null, events_rounded: 45 }], 'events_rounded')), wishlist: null },
      spectrum: ok([]), brands, onPick: () => {}, onFilter: () => {},
    }));
    const m = view(labels);
    expect(m).toContain('<span>H&amp;M</span>');
    expect(m).toContain('<th scope="row">H&amp;M</th>');
    expect(m).toContain('<span>Zor Vane</span>');
    expect(m).not.toContain('H And M');
    expect(view(undefined)).toContain('<span>H And M</span>');
    const g = html(createElement(GapsView, { dim: 'category_brand', filter: null, options: ok([]), brands: labels, data: ok({ rows: [{ segment: 'Tops / demo-h-and-m', owner_users_rounded: 10, wishlist_users_rounded: 30, gap_score: 3, label: null }], hidden: ['Shoes / demo-zor-vane'] }), onDim: () => {}, onFilter: () => {} }));
    expect(g).toContain('<th scope="row">Tops / H&amp;M</th>');
    expect(g).toContain('<th scope="row">Shoes / Zor Vane</th>');
  });
});
