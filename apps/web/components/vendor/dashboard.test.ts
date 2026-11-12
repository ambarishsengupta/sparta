import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { a11yProblems } from '../../test-support/a11y';
import { INITIAL, pivot, withHidden } from '../../lib/vendor/dashboard';
import { INSIGHT_SENTENCES } from '../../lib/vendor/insights';
import Page from '../../app/vendor/page';
import { DashboardView, type ViewProps } from './Dashboard';

// WO-0112: the dashboard's markup for each state it can be in (the browser run is the screenshots).
vi.mock('../../lib/supabase/server', () => ({
  createServerSupabase: async () => ({ schema: () => ({ from: (t: string) => ({ select: () => (t === 'vendor_members' ? Promise.resolve({ data: [{ vendor_id: 'v1' }], error: null })
    : { eq: () => ({ maybeSingle: async () => ({ data: { name: 'Northwind Demo Outfitters' }, error: null }) }) }) }) }) }),
}));
const html = (el: ReactElement) => renderToStaticMarkup(el).replace(/class="_([a-z]+)_[0-9a-f]+"/g, 'class="$1"');   // class names of the CSS module carry a hash
const ok = <T,>(data: T) => ({ ok: true as const, data });
const trendRow = (period: string, segment: string, users: number | null, events: number | null) => ({ period, segment, users_rounded: users, events_rounded: events });
const loaded: ViewProps = {
  s: INITIAL,
  header: { coverage: ok({ users_rounded: 150, last_run_at: '2026-11-12T20:30:00Z' }), options: ok([{ filter_dim: 'size', filter_value: 'Letter:M' }, { filter_dim: 'season', filter_value: 'Winter' }]) },
  mix: ok(withHidden([{ segment: 'Tops', users_rounded: 60 }, { segment: 'Footwear', users_rounded: 30 }], [{ segment: 'Tops', users_rounded: 60 }])),
  trends: { purchase: ok(pivot([], [trendRow('2026-11-01', 'Tops', null, 45)], 'events_rounded')), wishlist: ok(pivot([], [trendRow('2026-11-01', 'Tops', 25, null)], 'users_rounded')) },
  spectrum: ok([{ band: 'Like new', share: 35 }, { band: 'Worn', share: 65 }, { band: 'Falling apart', share: null }]),
  onPick: () => {}, onFilter: () => {},
};
const view = (over: Partial<ViewProps>) => html(createElement(DashboardView, { ...loaded, ...over }));

describe('the dashboard markup', () => {
  const m = view({});
  it('shows the coverage header as plain text: the rounded cohort and the last run time', () => {
    expect(m).toContain('about 150 users, counts rounded to the nearest 5. Last aggregation run: 2026-11-12 20:30 UTC.');
  });
  it('shows the ownership mix with each share over the coverage, and a segment that the filter hides as "Not enough users to display"', () => {
    expect(m).toContain('60 users / 40%');
    expect(m).toMatch(/<span>Footwear<\/span><span class="suppressed">Not enough users to display<\/span>/);
    expect(m).not.toMatch(/Footwear[^]*?0 users/);
  });
  it('shows both trend tables with their values and the condition spectrum with a suppressed band', () => {
    expect(m).toContain('<caption>Purchases per month by category</caption>');
    expect(m).toContain('<span class="value">45</span>');
    expect(m).toContain('<span class="value">25</span>');
    expect(m).toContain('35%');
    expect(m).toMatch(/Falling apart<\/span><span class="suppressed">/);
  });
  it('has four filter selects, one of which carries the active filter, and no accessibility problem', () => {
    expect(m.match(/<select/g)).toHaveLength(4 + 3);   // four filters, three view selectors
    const filtered = view({ s: { ...INITIAL, filter: { dim: 'season', value: 'Winter' } } });
    expect(filtered).toMatch(/<option value="Winter" selected="">Winter<\/option>/);
    expect([m, filtered].map((x) => x.match(/<option value="" selected="">Any/g)!.length)).toEqual([4, 3]);   // the season select no longer says Any
    expect(a11yProblems(m)).toEqual([]);
    expect(a11yProblems(filtered)).toEqual([]);
  });
  it('says "No aggregation run yet." and shows no view when coverage has no run', () => {
    const none = view({ header: { coverage: ok(null), options: ok([]) } });
    expect(none).toContain('No aggregation run yet.');
    expect(none).not.toMatch(/<h2|<select|track/);
  });
  it('says the cohort is too small, not 0, when coverage has no figure', () => {
    expect(view({ header: { ...loaded.header, coverage: ok({ users_rounded: null, last_run_at: '2026-11-12T20:30:00Z' }) } })).toContain('a cohort too small to display');
  });
  it.each(Object.entries(INSIGHT_SENTENCES))('shows the fixed sentence for %s as an announced error and nothing the server said', (kind, sentence) => {
    const bad = { ok: false as const, kind: kind as keyof typeof INSIGHT_SENTENCES, message: sentence };
    const out = view({ mix: bad });
    expect(out).toContain(`<p class="error" role="alert">${sentence}</p>`);
    expect(a11yProblems(out)).toEqual([]);
  });
  it('shows a loading state before anything has arrived', () => {
    const out = view({ header: { coverage: null, options: null } });
    expect(out).toContain('Loading the figures.');
  });
});

describe('/vendor', () => {
  it('has the Dashboard heading, the vendor name from the grant and the dashboard', async () => {
    const out = html((await Page()) as ReactElement);
    expect(out).toMatch(/<h1>Dashboard<\/h1><p class="muted">Northwind Demo Outfitters<\/p>/);
    expect(out).toContain('Loading the figures.');
    expect(a11yProblems(out)).toEqual([]);
  });
});
