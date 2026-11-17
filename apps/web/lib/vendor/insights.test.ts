import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { INSIGHT_SENTENCES, conditionSpectrum, coverage, filterOptions, gaps, kindOf, ownershipMix, report, reports, trend } from './insights';

/** A client that records every call and answers from `answer`. */
function fake(answer: (fn: string) => unknown) {
  const calls: { schema: string; fn: string; args: unknown }[] = [];
  const client = { schema: (schema: string) => ({ rpc: async (fn: string, args: unknown) => { calls.push({ schema, fn, args }); const a = answer(fn); if (a instanceof Error) throw a; return a; } }) } as unknown as SupabaseClient;
  return { client, calls };
}
const rows = (data: unknown) => () => ({ data, error: null, status: 200 });
const refusal = (message: string, code = 'P0001', status = 400) => () => ({ data: null, error: { code, message }, status });

describe('every wrapper calls one analytics.* function with named parameters and nothing else', () => {
  it('sends the whitelisted names and values, nulls for a missing filter', async () => {
    const { client, calls } = fake(rows([]));
    await ownershipMix(client, 'category'); await ownershipMix(client, 'brand', { dim: 'size', value: 'Letter:M' }); await coverage(client); await filterOptions(client);
    await trend(client, 'wishlist', 'category_fit', { dim: 'region', value: 'South Asia' }); await gaps(client, 'category_colour_family', null, 5); await conditionSpectrum(client, 'Tops'); await reports(client); await report(client, 'id-1');
    expect(calls.map((c) => `${c.schema}.${c.fn}`)).toEqual(['analytics.ownership_mix', 'analytics.ownership_mix', 'analytics.coverage', 'analytics.filter_options', 'analytics.trend', 'analytics.gaps', 'analytics.condition_spectrum', 'analytics.reports', 'analytics.report']);
    expect(calls.map((c) => c.args)).toEqual([
      { p_dim: 'category', p_filter_dim: null, p_filter_value: null }, { p_dim: 'brand', p_filter_dim: 'size', p_filter_value: 'Letter:M' }, {}, {},
      { p_kind: 'wishlist', p_dim: 'category_fit', p_period_unit: 'month', p_filter_dim: 'region', p_filter_value: 'South Asia' },
      { p_dim: 'category_colour_family', p_filter_dim: null, p_filter_value: null, p_top_n: 5 }, { p_category: 'Tops' }, {}, { p_id: 'id-1' }]);
  });
  it('returns the rows as the function gave them; coverage and report give the first row or null', async () => {
    const mix = [{ segment: 'Tops', users_rounded: 40 }];
    expect(await ownershipMix(fake(rows(mix)).client, 'category')).toEqual({ ok: true, data: mix });
    expect(await coverage(fake(rows([{ users_rounded: 150, last_run_at: 't' }])).client)).toEqual({ ok: true, data: { users_rounded: 150, last_run_at: 't' } });
    expect(await coverage(fake(rows([])).client)).toEqual({ ok: true, data: null });
    expect(await report(fake(rows([])).client, 'x')).toEqual({ ok: true, data: null });
  });
  it('keeps nothing between calls: two clients get their own answers and the module holds no state', async () => {
    const a = await ownershipMix(fake(rows([{ segment: 'A', users_rounded: 10 }])).client, 'fit');
    const b = await ownershipMix(fake(rows([{ segment: 'B', users_rounded: 15 }])).client, 'fit');
    expect([a, b]).toEqual([{ ok: true, data: [{ segment: 'A', users_rounded: 10 }] }, { ok: true, data: [{ segment: 'B', users_rounded: 15 }] }]);
    const source = readFileSync(new URL('./insights.ts', import.meta.url), 'utf8').split('\n').filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*') && !l.trimStart().startsWith('/**'));
    expect(source.filter((l) => /^(let|var)\s|\bnew (Map|WeakMap|Set)\b|\bcache\b|localStorage|sessionStorage/i.test(l))).toEqual([]);
  });
  it('calls no table, no other schema and no network of its own', () => {
    const text = readFileSync(new URL('./insights.ts', import.meta.url), 'utf8');
    expect(text).not.toMatch(/\.from\(|\bfetch\(|schema\('(?!analytics')/);
  });
});

describe('failures become fixed sentences; the server text is never shown', () => {
  it.each([
    ['agreement_required', refusal('agreement_required'), 'agreement_required'], ['rate_limited', refusal('rate_limited'), 'rate_limited'], ['maintenance', refusal('maintenance'), 'maintenance'],
    ['forbidden (42501)', refusal('forbidden', '42501', 403), 'forbidden'], ['permission denied for schema', refusal('permission denied for schema analytics', '42501', 403), 'forbidden'],
    ['no answer at all', refusal('TypeError: no answer', '', 0), 'network'], ['a thrown TypeError', () => new TypeError('x'), 'network'],
    ['an unknown refusal', refusal('invalid_dimension secret_table'), 'unexpected'], ['a thrown error', () => new Error('boom'), 'unexpected'], ['a non-list answer', rows({ a: 1 }), 'unexpected'],
  ] as const)('%s', async (_n, answer, kind) => {
    const out = await coverage(fake(answer).client);
    expect(out).toEqual({ ok: false, kind, message: INSIGHT_SENTENCES[kind] });
    expect(JSON.stringify(out)).not.toMatch(/secret_table|no answer|42501/);
  });
  it('kindOf reads the retryable auth error as a network failure', () => { expect(kindOf(undefined, { name: 'AuthRetryableFetchError', message: 'x' })).toBe('network'); });
  it('has six distinct sentences, each ending in a full stop', () => {
    const s = Object.values(INSIGHT_SENTENCES);
    expect(new Set(s).size).toBe(6);
    for (const t of s) expect(t).toMatch(/\.$/);
  });
});
