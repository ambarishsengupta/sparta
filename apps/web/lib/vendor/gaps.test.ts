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
});
