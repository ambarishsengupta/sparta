import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, settle } from '../../test-support/hook-shim';
import { Gaps, type GapsViewProps } from './Gaps';
import { ReportList, ReportPage } from './Reports';

// WO-0154: the `live` guard of Gaps and Reports, as WO-0152 tested it for the Dashboard. A result that arrives after the view changed (segment or report picked again) or after the page was left is dropped.
// Each call here is a promise the test settles by hand, in the order that makes the old answer arrive last.
vi.mock('react', async (orig) => ({ ...(await orig<object>()), ...(await import('../../test-support/hook-shim')).hookStandIns }));
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('../../lib/supabase/browser', () => ({ createBrowserSupabase: () => ({}) }));
type Call = { arg: string; resolve: (r: unknown) => void; reject: (e: unknown) => void };
const { gapCalls, optionCalls, reportCalls, listCalls, opened } = vi.hoisted(() => ({ gapCalls: [] as Call[], optionCalls: [] as Call[], reportCalls: [] as Call[], listCalls: [] as Call[], opened: vi.fn() }));
const pending = (into: Call[], arg: string) => new Promise((resolve, reject) => { into.push({ arg, resolve, reject }); });
vi.mock('../../lib/vendor/gaps', async (orig) => ({ ...(await orig<object>()), loadGaps: (_c: unknown, dim: string) => pending(gapCalls, dim) }));
vi.mock('../../lib/vendor/reports', async (orig) => ({ ...(await orig<object>()), openReport: (_c: unknown, id: string) => pending(reportCalls, id) }));
vi.mock('../../lib/vendor/insights', async (orig) => ({ ...(await orig<object>()), filterOptions: () => pending(optionCalls, 'options'), reports: () => pending(listCalls, 'list') }));
vi.mock('../../lib/events', () => ({ EventLog: class { record = opened; } }));
beforeEach(() => { for (const c of [gapCalls, optionCalls, reportCalls, listCalls]) c.length = 0; opened.mockClear(); });

const gapsData = (segment: string) => ({ ok: true, data: { rows: [{ segment, owner_users_rounded: 10, wishlist_users_rounded: 30, gap_score: 3, label: null }], hidden: [] } });
const detail = (id: string) => ({ ok: true, data: { id, period: '2026-11-01', reviewed_at: '2026-11-05T00:00:00Z', payload: {} } });
const gapsProps = (g: ReturnType<typeof mount<object, ReactElement>>) => (g.render() as ReactElement<GapsViewProps>).props;
const shown = (el: unknown) => (el as ReactElement<{ one?: unknown; list?: unknown }>).props;

describe('Gaps: the live guard drops a result that arrives after the view changed', () => {
  it('a gaps result for the segment picked before is dropped; the one for the current segment is kept', async () => {
    const g = mount(Gaps as () => ReactElement, {});
    g.render(); g.flush();
    expect(gapCalls.map((c) => c.arg)).toEqual(['category_colour_family']);
    gapsProps(g).onDim('brand');
    g.render(); g.flush();
    expect(gapCalls.map((c) => c.arg)).toEqual(['category_colour_family', 'brand']);
    gapCalls[0]!.resolve(gapsData('OLD-VIEW'));
    await settle();
    expect(gapsProps(g).data).toBeNull();                     // dropped: still loading the new view
    gapCalls[1]!.resolve(gapsData('NEW-VIEW'));
    await settle();
    expect(gapsProps(g).data).toEqual(gapsData('NEW-VIEW'));
  });
  it('a rejection of the old view is dropped too (no failure message for a view that is gone)', async () => {
    const g = mount(Gaps as () => ReactElement, {});
    g.render(); g.flush();
    gapsProps(g).onDim('fit');
    g.render(); g.flush();
    gapCalls[0]!.reject(new Error('old view failed'));
    await settle();
    expect(gapsProps(g).data).toBeNull();
  });
  it('gaps and filter options that arrive after the page was left change nothing', async () => {
    const g = mount(Gaps as () => ReactElement, {});
    g.render(); g.flush();
    expect(gapCalls).toHaveLength(1);
    expect(optionCalls).toHaveLength(1);
    g.unmount();
    gapCalls[0]!.resolve(gapsData('GONE'));
    optionCalls[0]!.resolve({ ok: true, data: [{ filter_dim: 'season', filter_value: 'Winter' }] });
    await settle();
    expect(gapsProps(g).data).toBeNull();
    expect(gapsProps(g).options).toBeNull();
  });
});

describe('Reports: the live guard drops a result that arrives after the view changed', () => {
  it('ReportPage: the report of the id before is dropped; the one for the current id is kept', async () => {
    let id = 'old-id';
    const r = mount((() => ReportPage({ id })) as () => ReactElement, {});
    r.render(); r.flush();
    id = 'new-id';
    r.render(); r.flush();
    expect(reportCalls.map((c) => c.arg)).toEqual(['old-id', 'new-id']);
    reportCalls[0]!.resolve(detail('old-id'));
    await settle();
    expect(shown(r.render()).one).toBeNull();
    expect(opened).not.toHaveBeenCalled();                    // the old report is not recorded as opened
    reportCalls[1]!.resolve(detail('new-id'));
    await settle();
    expect(shown(r.render()).one).toEqual(detail('new-id'));
    expect(opened).toHaveBeenCalledTimes(1);
  });
  it('ReportPage: a report that arrives after the page was left changes nothing and is not recorded as opened', async () => {
    const r = mount((() => ReportPage({ id: 'an-id' })) as () => ReactElement, {});
    r.render(); r.flush();
    r.unmount();
    reportCalls[0]!.resolve(detail('an-id'));
    await settle();
    expect(shown(r.render()).one).toBeNull();
    expect(opened).not.toHaveBeenCalled();
  });
  it('ReportList: a list that arrives after the page was left changes nothing', async () => {
    const r = mount(ReportList as () => ReactElement, {});
    r.render(); r.flush();
    r.unmount();
    listCalls[0]!.resolve({ ok: true, data: [] });
    await settle();
    expect(shown(r.render()).list).toBeNull();
  });
});
