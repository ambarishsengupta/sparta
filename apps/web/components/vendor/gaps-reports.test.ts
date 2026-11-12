/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { a11yProblems } from '../../test-support/a11y';
import { INSIGHT_SENTENCES, type GapRow } from '../../lib/vendor/insights';
import { GapsView, type GapsViewProps } from './Gaps';
import { ReportListView, ReportView } from './Reports';

// WO-0106: the gaps page and the reports as rendered markup (no browser; the screenshots are the browser evidence).
const html = (el: ReactElement) => renderToStaticMarkup(el).replace(/class="_([a-z]+)_[0-9a-f]+"/g, 'class="$1"');
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const ok = <T,>(data: T) => ({ ok: true as const, data });
const gap = (segment: string, owners: number | null, wish: number, score: number | null): GapRow => ({ segment, owner_users_rounded: owners, wishlist_users_rounded: wish, gap_score: score, label: score === null ? 'no visible ownership' : null });
const rows = [gap('Footwear / White', 10, 30, 3), gap('Tops / Blue', 40, 20, 0.5), gap('Outerwear / Black', null, 15, null)];
const props: GapsViewProps = { dim: 'category_colour_family', filter: null, options: ok([{ filter_dim: 'season', filter_value: 'Winter' }]), data: ok({ rows, hidden: [] }), onDim: () => {}, onFilter: () => {} };
const gaps = (over: Partial<GapsViewProps> = {}) => html(createElement(GapsView, { ...props, ...over }));

describe('the gaps page', () => {
  it('lists the gaps in the order given with owner and wishlist counts and the score to one decimal, "no visible ownership" last, a hidden owner as the suppressed text and never 0', () => {
    const m = gaps();
    expect([...m.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map((x) => x[1])).toEqual(['Footwear / White', 'Tops / Blue', 'Outerwear / Black']);
    expect(m).toContain('<td>10</td><td>30</td><td>3.0</td>');
    expect(m).toContain('<td>40</td><td>20</td><td>0.5</td>');
    expect(m).toContain('<td><span class="suppressed">Not enough users to display</span></td><td>15</td><td>no visible ownership</td>');
    expect(m).not.toMatch(/<td>0<\/td>/);
  });
  it('has the dimension selector (seven dimensions) and the four filters, one of which carries the active filter, and no accessibility problem', () => {
    const m = gaps();
    expect(m.match(/<select/g)).toHaveLength(5);
    expect([...m.matchAll(/<option value="([a-z_]+)"/g)].map((x) => x[1])).toEqual(['category', 'colour_family', 'fit', 'brand', 'category_colour_family', 'category_fit', 'category_brand']);
    const filtered = gaps({ filter: { dim: 'season', value: 'Winter' } });
    expect(filtered).toContain('<option value="Winter" selected="">Winter</option>');
    expect(filtered.match(/<option value="" selected="">Any/g)).toHaveLength(3);
    expect([m, filtered].flatMap(a11yProblems)).toEqual([]);
  });
  it('shows a segment the filter hides as a row of "Not enough users to display"', () => {
    expect(gaps({ data: ok({ rows: [rows[1]!], hidden: ['Footwear / White'] }) })).toContain('<th scope="row">Footwear / White</th><td colSpan="3"><span class="suppressed">Not enough users to display</span></td>');
  });
  it('says when there is nothing, while loading, and with the fixed sentence for a failure', () => {
    expect(gaps({ data: ok({ rows: [], hidden: [] }) })).toContain('No gaps to show.');
    expect(gaps({ data: null })).toContain('Loading.');
    const bad = gaps({ data: { ok: false, kind: 'rate_limited', message: INSIGHT_SENTENCES.rate_limited } });
    expect(bad).toContain(`<p class="error" role="alert">${INSIGHT_SENTENCES.rate_limited}</p>`);
    expect(a11yProblems(bad)).toEqual([]);
  });
});

const payload = {
  coverage: { users_rounded: 150, last_run_at: '2026-11-12T20:30:00Z' }, cube_first_period: '2026-06-01', cube_last_period: '2026-11-01',
  gaps: rows, rising_wishlist: [{ segment: 'Outerwear', users_rounded: 30, previous_users_rounded: 15, increase: 15 }],
  condition_spectrum: [{ category: 'Tops', bands: [{ band: 'Like new', share: 35 }, { band: 'Worn', share: 65 }] }, { category: 'Hats', bands: [{ band: 'Like new', share: null }, { band: 'Worn', share: null }] }],
};
const detail = (p: unknown) => ok({ id: 'x', period: '2026-11-01', reviewed_at: '2026-11-13T09:00:00Z', payload: p });

describe('a report on screen', () => {
  const m = html(createElement(ReportView, { one: detail(payload) }));
  it('shows the notes on the contributing users and the pilot period, the top gaps, the rising segments and the condition spectrum', () => {
    expect(m).toContain('Month 2026-11. Reviewed on 2026-11-13.');
    expect(m).toContain('Based on about 150 contributing users. Counts are rounded to the nearest 5');
    expect(m).toContain('Pilot period: aggregates cover 2026-06 to 2026-11, last aggregation run 2026-11-12.');
    expect([...m.matchAll(/<h2>([^<]*)<\/h2>/g)].map((x) => x[1])).toEqual(['Notes', 'Top gaps', 'Rising wishlist segments', 'Condition spectrum']);
    expect(m).toContain('<td>10</td><td>30</td><td>3.0</td>');
    expect(m).toContain('no visible ownership');
    expect(m).toContain('+15 users (15 to 30)');
    expect(m).toContain('35%');
    expect(m).toMatch(/<h3>Hats<\/h3><p><span class="suppressed">Not enough users to display<\/span><\/p>/);
    expect(a11yProblems(m)).toEqual([]);
  });
  it('names the report month in the heading, and keeps the plain heading while loading or when there is no report (WO-0114)', () => {
    expect(m).toContain('<h1>Report: November 2026</h1>');
    expect(html(createElement(ReportView, { one: ok({ id: 'x', period: '2026-01-01', reviewed_at: '2026-02-03T09:00:00Z', payload }) }))).toContain('<h1>Report: January 2026</h1>');
    for (const one of [null, ok(null), { ok: false as const, kind: 'forbidden' as const, message: INSIGHT_SENTENCES.forbidden }]) expect(html(createElement(ReportView, { one }))).toMatch(/^<h1>Report<\/h1>/);
    expect(read('../../app/vendor/reports/[id]/page.tsx')).not.toContain('<h1>');
  });
  it('says so for an empty section instead of showing a blank', () => {
    const e = html(createElement(ReportView, { one: detail({ ...payload, gaps: [], rising_wishlist: [], condition_spectrum: [] }) }));
    expect(e).toContain('No gaps to show this month.');
    expect(e).toContain('No category is rising this month.');
  });
  it('gives "Report not found." for a missing, unknown or unreviewed report, the fixed sentence for a failure and a plain message for a damaged payload', () => {
    const notFound = html(createElement(ReportView, { one: ok(null) }));
    expect(notFound).toContain('Report not found.');
    expect(notFound).not.toMatch(/<h2|<table|reviewed/i);
    expect(html(createElement(ReportView, { one: { ok: false, kind: 'forbidden', message: INSIGHT_SENTENCES.forbidden } }))).toContain(INSIGHT_SENTENCES.forbidden);
    expect(html(createElement(ReportView, { one: detail({ nonsense: 1 }) }))).toContain(INSIGHT_SENTENCES.unexpected);
  });
  it('lists the reviewed reports with a link to each, or says there are none', () => {
    const l = html(createElement(ReportListView, { list: ok([{ id: 'a1', period: '2026-11-01', reviewed_at: '2026-11-13T09:00:00Z' }, { id: 'b2', period: '2026-10-01', reviewed_at: '2026-10-31T09:00:00Z' }]) }));
    expect(l).toContain('<th scope="row">2026-11</th><td>2026-11-13</td><td><a href="/vendor/reports/a1">Open the report for 2026-11</a>');
    expect(l).toContain('href="/vendor/reports/b2"');
    expect(a11yProblems(l)).toEqual([]);
    expect(html(createElement(ReportListView, { list: ok([]) }))).toContain('No report has been reviewed yet.');
  });
});

describe('the sources', () => {
  const reports = read('./Reports.tsx');
  it('records vendor_report_opened once per opening: only for a report that is shown, guarded by the id, never in the render', () => {
    expect(reports.match(/record\('vendor_report_opened'\)/g)).toHaveLength(1);
    expect(reports).toMatch(/if \(r\.ok && r\.data && recorded\.current !== id\) \{ recorded\.current = id; new EventLog\(\)\.record\('vendor_report_opened'\); \}/);
    expect(reports.slice(reports.indexOf('export function ReportView'))).not.toContain('record(');
  });
  it('reads a report only through openReport (the uuid check) and the pages have no print stylesheet', () => {
    expect(reports).not.toMatch(/\breport\(/);
    expect(read('../../lib/vendor/reports.ts')).toMatch(/isUuid\(id\) \? report\(c, id\)/);
    for (const f of ['./Gaps.tsx', './Reports.tsx', '../../app/vendor/gaps/page.tsx', '../../app/vendor/reports/page.tsx', '../../app/vendor/reports/[id]/page.tsx']) expect(read(f)).not.toMatch(/@media print|dangerouslySetInnerHTML/);
  });
  it('the gaps page reuses the dashboard\'s reducer and filter bar, and computes no number from a returned value', () => {
    expect(read('./Gaps.tsx')).toMatch(/filterReducer/);
    expect(read('./Dashboard.tsx')).toContain('<FilterBar');
    expect(read('./Gaps.tsx') + read('../../lib/vendor/gaps.ts')).not.toMatch(/Math\.|\.reduce\(/);
  });
});
