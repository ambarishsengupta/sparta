import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { INITIAL, loadHeader, loadMix, loadSpectrum, loadTrends, pivot, share, viewKey, withHidden, type Base } from './dashboard';
import { filterReducer } from './filter-state';
import type { Filter } from './insights';

// WO-0112: the dashboard's arithmetic and loading, with a fake client that counts every call.
function fake(answer: (fn: string, args: Record<string, unknown>) => unknown[]) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = { schema: () => ({ rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: answer(fn, args), error: null, status: 200 }; } }) } as unknown as SupabaseClient;
  return { client, calls };
}
const seg = (segment: string, users_rounded: number) => ({ segment, users_rounded });
const row = (period: string, segment: string, users: number | null, events: number | null) => ({ period, segment, users_rounded: users, events_rounded: events });

describe('FR-77: one filter at a time (acceptance: a size filter, then a season filter, leaves the season filter only)', () => {
  it('setting a filter replaces the previous one', () => {
    let f: Filter = null;
    f = filterReducer(f, { type: 'set', dim: 'size', value: 'Letter:M' });
    expect(f).toEqual({ dim: 'size', value: 'Letter:M' });
    f = filterReducer(f, { type: 'set', dim: 'season', value: 'Winter' });
    expect(f).toEqual({ dim: 'season', value: 'Winter' });
    f = filterReducer(f, { type: 'set', dim: 'season', value: 'Summer' });
    expect(f).toEqual({ dim: 'season', value: 'Summer' });
  });
  it('clearing the active dimension removes the filter; clearing another one changes nothing', () => {
    const f: Filter = { dim: 'region', value: 'South Asia' };
    expect(filterReducer(f, { type: 'clear', dim: 'size' })).toBe(f);
    expect(filterReducer(f, { type: 'clear', dim: 'region' })).toBeNull();
    expect(filterReducer(null, { type: 'clear', dim: 'region' })).toBeNull();
  });
});

describe('share: the segment over the coverage, both published values', () => {
  it('is the whole percent of the cohort, not of the sum of the rows shown', () => {
    expect(share(40, 150)).toBe(27);
    expect(share(50, 150)).toBe(33);     // two rows of 50 sum to 100; over that sum the answer would be 50
    expect(share(150, 150)).toBe(100);
  });
  it('is null without a cohort figure (never 0, never a guess)', () => { expect([share(40, null), share(40, 0)]).toEqual([null, null]); });
});

describe('withHidden and pivot: a segment the filter hides is shown as hidden, not dropped and not 0', () => {
  const base = [seg('A', 40), seg('B', 30), seg('C', 20)];
  it('gives the segments of the unfiltered answer, biggest first, null for those the filtered answer lacks', () => {
    expect(withHidden(base, [seg('C', 15), seg('A', 25)])).toEqual([{ segment: 'A', value: 25 }, { segment: 'C', value: 15 }, { segment: 'B', value: null }]);
  });
  it('without a filter nothing is hidden', () => { expect(withHidden(base, base).every((r) => r.value !== null)).toBe(true); });
  it('pivot: months as YYYY-MM across, segments down, the chosen field only, a hidden segment as a row of missing cells', () => {
    const b = [row('2026-10-01', 'Tops', null, 30), row('2026-11-01', 'Tops', null, 60), row('2026-11-01', 'Shoes', null, 15)];
    const p = pivot(b, [row('2026-11-01', 'Tops', null, 25)], 'events_rounded');
    expect(p.periods).toEqual(['2026-10', '2026-11']);
    expect(p.segments).toEqual(['Shoes', 'Tops']);
    expect(p.cells).toEqual({ 'Tops\u00002026-11': 25 });
    expect(pivot([row('2026-11-01', 'Tops', 40, null)], [row('2026-11-01', 'Tops', 40, null)], 'users_rounded').cells).toEqual({ 'Tops\u00002026-11': 40 });
  });
});

describe('calls: one per view per change, at most 6 for the first render', () => {
  const answer = (fn: string) => (fn === 'coverage' ? [{ users_rounded: 150, last_run_at: 't' }] : fn === 'ownership_mix' ? [seg('Tops', 40)] : []);
  it('the first render calls coverage, filter_options, one mix, both trends and one spectrum: 6 calls', async () => {
    const { client, calls } = fake(answer);
    const base: Base = {};
    await Promise.all([loadHeader(client), loadMix(client, INITIAL, base), loadTrends(client, INITIAL, base), loadSpectrum(client, INITIAL)]);
    expect(calls.map((c) => c.fn).sort()).toEqual(['condition_spectrum', 'coverage', 'filter_options', 'ownership_mix', 'trend', 'trend']);
    expect(calls.length).toBeLessThanOrEqual(6);
    expect(calls.filter((c) => c.fn === 'trend').map((c) => (c.args as { p_kind: string }).p_kind).sort()).toEqual(['purchase', 'wishlist']);
  });
  it('changing the segment selector makes one call, setting a filter after a first render one call per view (the unfiltered answer is already known), and nothing polls', async () => {
    const { client, calls } = fake(answer);
    const base: Base = {};
    await loadMix(client, INITIAL, base);
    await loadTrends(client, INITIAL, base);
    calls.length = 0;
    await loadMix(client, { ...INITIAL, mixDim: 'brand' }, base);
    expect(calls).toHaveLength(1);
    calls.length = 0;
    const filtered = { ...INITIAL, filter: { dim: 'size', value: 'Letter:M' } as const };
    await loadMix(client, filtered, base); await loadTrends(client, filtered, base);
    expect(calls.map((c) => c.fn)).toEqual(['ownership_mix', 'trend', 'trend']);
    expect(calls.every((c) => (c.args as { p_filter_dim: string }).p_filter_dim === 'size')).toBe(true);
  });
  it('a filter on a view that was never loaded without it also asks for the unfiltered answer once, then never again', async () => {
    const { client, calls } = fake(answer);
    const base: Base = {};
    const filtered = { ...INITIAL, mixDim: 'fit' as const, filter: { dim: 'season', value: 'Winter' } as const };
    await loadMix(client, filtered, base); await loadMix(client, filtered, base);
    expect(calls.map((c) => (c.args as { p_filter_dim: string | null }).p_filter_dim)).toEqual(['season', null, 'season']);
  });
  it('a segment that the filtered answer lacks comes back as null', async () => {
    const { client } = fake((_fn, a) => (a.p_filter_dim ? [seg('Tops', 15)] : [seg('Tops', 40), seg('Hats', 25)]));
    const r = await loadMix(client, INITIAL, {});
    expect(r).toEqual({ ok: true, data: [{ segment: 'Tops', value: 40 }, { segment: 'Hats', value: 25 }] });
    const base: Base = { 'mix:category': [seg('Tops', 40), seg('Hats', 25)] };
    expect(await loadMix(client, { ...INITIAL, filter: { dim: 'size', value: 'Letter:S' } }, base)).toEqual({ ok: true, data: [{ segment: 'Tops', value: 15 }, { segment: 'Hats', value: null }] });
  });
});

describe('one event per view, and nothing but the share is computed', () => {
  it('viewKey differs for every selector and the filter, and is the same for the same view', () => {
    const keys = [INITIAL, { ...INITIAL, mixDim: 'fit' as const }, { ...INITIAL, trendDim: 'brand' as const }, { ...INITIAL, category: 'Footwear' }, { ...INITIAL, filter: { dim: 'size' as const, value: 'Letter:M' } }].map(viewKey);
    expect(new Set(keys).size).toBe(5);
    expect(viewKey({ ...INITIAL })).toBe(keys[0]);
  });
  const dash = readFileSync(new URL('../../components/vendor/Dashboard.tsx', import.meta.url), 'utf8');
  it('the dashboard records vendor_dashboard_viewed once, in an effect that runs for a new view key only, never in the render', () => {
    expect(dash.match(/vendor_dashboard_viewed/g)).toHaveLength(2);   // the comment and the call
    expect(dash).toContain("useEffect(() => { if (seen.current !== key) { seen.current = key; new EventLog().record('vendor_dashboard_viewed'); } }, [key]);");
    expect(dash.slice(dash.indexOf('export function DashboardView'))).not.toMatch(/EventLog|record\(/);
  });
  it('the dashboard files compute only the share division on a returned value (one Math call, no sums or reductions)', () => {
    const text = [dash, readFileSync(new URL('./dashboard.ts', import.meta.url), 'utf8')].join('\n');
    expect(text.match(/Math\.\w+/g)).toEqual(['Math.round']);
    expect(text).toContain('Math.round((value / cohort) * 100)');
    expect(text).not.toMatch(/\.reduce\(|\+=|\bsum\b|\.length\s*[*/]/);
  });
  it('the dashboard reads only through the insight wrappers: no table, no fetch, no server import', () => {
    const files = [dash, readFileSync(new URL('./dashboard.ts', import.meta.url), 'utf8')].join('\n');
    expect(files).not.toMatch(/\.from\(|\bfetch\(|lib\/server|setInterval|setTimeout|localStorage/);
  });
});
