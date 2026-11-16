import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Base } from './dashboard';
import { TOP_N, loadGaps, rankGaps } from './gaps';
import type { GapRow } from './insights';
import { isUuid, openReport, parsePayload } from './reports';

// WO-0106: the gaps page's loading and ordering, and opening one report, with a fake client that counts every call.
function fake(answer: (fn: string, args: Record<string, unknown>) => unknown[]) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = { schema: () => ({ rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: answer(fn, args), error: null, status: 200 }; } }) } as unknown as SupabaseClient;
  return { client, calls };
}
const gap = (segment: string, owners: number | null, wish: number, score: number | null): GapRow => ({ segment, owner_users_rounded: owners, wishlist_users_rounded: wish, gap_score: score, label: score === null ? 'no visible ownership' : null });
const UUID = '0b6f1c52-6f51-4a53-9a4e-6f5ce1a2b3c4';

describe('rankGaps: scored segments first by score, then the "no visible ownership" ones', () => {
  it('orders by score descending, ties by segment name, and puts null scores after every scored row', () => {
    const rows = [gap('Tops', null, 20, null), gap('Hats', 10, 15, 1.5), gap('Socks', 5, 20, 4), gap('Belts', 10, 15, 1.5), gap('Coats', null, 15, null)];
    expect(rankGaps(rows).map((r) => r.segment)).toEqual(['Socks', 'Belts', 'Hats', 'Coats', 'Tops']);
  });
});

describe('loadGaps: one call for the dimension and the filter, the filter hides segments as the dashboard does (FR-77)', () => {
  const unfiltered = [gap('Tops', 40, 20, 0.5), gap('Shoes', 10, 30, 3), gap('Coats', null, 15, null)];
  const answer = (_: string, a: Record<string, unknown>) => (a.p_filter_dim ? [gap('Tops', 20, 15, 0.8)] : unfiltered);
  it('asks once without a filter, with the dimension and the top-n limit, and lists the rows ranked, nothing hidden', async () => {
    const { client, calls } = fake(answer);
    const r = await loadGaps(client, 'category_colour_family', null, {});
    expect(calls).toEqual([{ fn: 'gaps', args: { p_dim: 'category_colour_family', p_filter_dim: null, p_filter_value: null, p_top_n: TOP_N } }]);
    expect(r).toEqual({ ok: true, data: { rows: [unfiltered[1], unfiltered[0], unfiltered[2]], hidden: [] } });
  });
  it('with a filter asks for it plus the unfiltered answer once, and names the segments the filter hides; a later filter on the same dimension costs one call', async () => {
    const { client, calls } = fake(answer); const base: Base = {};
    const r = await loadGaps(client, 'category', { dim: 'season', value: 'Winter' }, base);
    expect(r.ok && r.data).toEqual({ rows: [gap('Tops', 20, 15, 0.8)], hidden: ['Coats', 'Shoes'] });
    expect(calls.map((c) => c.args.p_filter_dim)).toEqual(['season', null]);
    await loadGaps(client, 'category', { dim: 'region', value: 'South Asia' }, base);
    expect(calls).toHaveLength(3);
  });
  it('does not claim a segment is hidden when the unfiltered answer was cut at the limit', async () => {
    const many = Array.from({ length: TOP_N }, (_, i) => gap(`S${String(i).padStart(2, '0')}`, 10, 10, 1));
    const { client } = fake((_, a) => (a.p_filter_dim ? [many[0]] : many));
    const r = await loadGaps(client, 'category', { dim: 'size', value: 'Letter:M' }, {});
    expect(r.ok && r.data.hidden).toEqual([]);
  });
  it('turns a refused call into the fixed sentence', async () => {
    const client = { schema: () => ({ rpc: async () => ({ data: null, error: { code: 'P0001', message: 'rate_limited' }, status: 400 }) }) } as unknown as SupabaseClient;
    expect(await loadGaps(client, 'category', null, {})).toMatchObject({ ok: false, kind: 'rate_limited' });
  });
});

describe('openReport: the id is a uuid before anything is called', () => {
  it.each(['', 'abc', '../admin', `${UUID}x`, `${UUID}; drop table x`, '0b6f1c52-6f51-4a53-9a4e'])('%j is not a uuid: no call, no report', async (id) => {
    const { client, calls } = fake(() => [{ id }]);
    expect(isUuid(id)).toBe(false);
    expect(await openReport(client, id)).toEqual({ ok: true, data: null });
    expect(calls).toEqual([]);
  });
  it('a uuid is one call to report(p_id); an empty answer (unreviewed or unknown) is no report', async () => {
    const { client, calls } = fake(() => []);
    expect(isUuid(UUID.toUpperCase())).toBe(true);
    expect(await openReport(client, UUID)).toEqual({ ok: true, data: null });
    expect(calls).toEqual([{ fn: 'report', args: { p_id: UUID } }]);
  });
});

describe('parsePayload: the payload of CC6', () => {
  const ok = { coverage: { users_rounded: 150, last_run_at: 'T' }, cube_first_period: '2026-06-01', cube_last_period: '2026-11-01', gaps: [], rising_wishlist: null, condition_spectrum: [{ category: 'Tops', bands: [] }] };
  it('accepts the shape, reads an aggregate of nothing (null) as an empty list, and refuses anything else', () => {
    expect(parsePayload(ok)).toMatchObject({ gaps: [], rising_wishlist: [], condition_spectrum: [{ category: 'Tops', bands: [] }] });
    for (const bad of [null, 'x', {}, { ...ok, coverage: null }, { ...ok, gaps: 'x' }, { ...ok, condition_spectrum: {} }]) expect(parsePayload(bad)).toBeNull();
  });
  // WO-0126: every field of every row, and coverage and the two periods, are checked (the payload is jsonb), so a damaged value refuses the whole snapshot instead of reaching the screen.
  const g = { segment: 'Tops / Black', owner_users_rounded: 10, wishlist_users_rounded: 20, gap_score: 2, label: 'a label' };
  const r = { segment: 'Tops', users_rounded: 30, previous_users_rounded: 20, increase: 10 };
  const s = { category: 'Tops', bands: [{ band: 'good', share: 45 }] };
  const full = { ...ok, gaps: [g], rising_wishlist: [r], condition_spectrum: [s] };
  it('accepts well-formed rows, and every nullable field may be null (a snapshot of an empty cube)', () => {
    expect(parsePayload(full)).toEqual({ coverage: { users_rounded: 150, last_run_at: 'T' }, cube_first_period: '2026-06-01', cube_last_period: '2026-11-01', gaps: [g], rising_wishlist: [r], condition_spectrum: [s] });
    const nulls = { coverage: { users_rounded: null, last_run_at: null }, cube_first_period: null, cube_last_period: null,
      gaps: [{ ...g, owner_users_rounded: null, gap_score: null, label: null }], rising_wishlist: null, condition_spectrum: [{ category: 'Tops', bands: [{ band: 'good', share: null }] }] };
    expect(parsePayload(nulls)).toEqual({ ...nulls, rising_wishlist: [] });
  });
  it('a missing period reads as null (undefined is not refused)', () => {
    const rest: Record<string, unknown> = { ...full };
    delete rest.cube_first_period; delete rest.cube_last_period;
    expect(parsePayload(rest)).toMatchObject({ cube_first_period: null, cube_last_period: null });
  });
  it('refuses each damaged field of a gap row, a rising row and a spectrum row, one at a time', () => {
    const bad: [string, unknown][] = [
      ['gaps: segment', { ...full, gaps: [{ ...g, segment: 5 }] }], ['gaps: owner_users_rounded', { ...full, gaps: [{ ...g, owner_users_rounded: '10' }] }],
      ['gaps: wishlist_users_rounded', { ...full, gaps: [{ ...g, wishlist_users_rounded: null }] }], ['gaps: gap_score', { ...full, gaps: [{ ...g, gap_score: 'x' }] }],
      ['gaps: label', { ...full, gaps: [{ ...g, label: 7 }] }], ['gaps: a null row', { ...full, gaps: [g, null] }], ['gaps: an array row', { ...full, gaps: [[]] }],
      ['rising: segment', { ...full, rising_wishlist: [{ ...r, segment: null }] }], ['rising: users_rounded', { ...full, rising_wishlist: [{ ...r, users_rounded: '30' }] }],
      ['rising: previous_users_rounded', { ...full, rising_wishlist: [{ ...r, previous_users_rounded: null }] }], ['rising: increase', { ...full, rising_wishlist: [{ ...r, increase: undefined }] }],
      ['spectrum: category', { ...full, condition_spectrum: [{ ...s, category: 3 }] }], ['spectrum: bands', { ...full, condition_spectrum: [{ ...s, bands: null }] }],
      ['spectrum: band', { ...full, condition_spectrum: [{ ...s, bands: [{ band: 1, share: 45 }] }] }], ['spectrum: share', { ...full, condition_spectrum: [{ ...s, bands: [{ band: 'good', share: 'x' }] }] }],
    ];
    for (const [name, payload] of bad) expect(parsePayload(payload), name).toBeNull();
  });
  it('refuses a damaged coverage or period', () => {
    const bad: [string, unknown][] = [
      ['coverage: not an object', { ...full, coverage: 'x' }], ['coverage: an array', { ...full, coverage: [] }], ['coverage: users_rounded', { ...full, coverage: { users_rounded: '150', last_run_at: 'T' } }],
      ['coverage: users_rounded missing', { ...full, coverage: { last_run_at: 'T' } }], ['coverage: last_run_at', { ...full, coverage: { users_rounded: 150, last_run_at: 5 } }],
      ['cube_first_period', { ...full, cube_first_period: 5 }], ['cube_last_period', { ...full, cube_last_period: {} }],
    ];
    for (const [name, payload] of bad) expect(parsePayload(payload), name).toBeNull();
  });
});
