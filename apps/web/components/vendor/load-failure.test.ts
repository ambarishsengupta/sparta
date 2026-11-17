import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { a11yProblems } from '../../test-support/a11y';
import { INSIGHT_SENTENCES, loadFailed } from '../../lib/vendor/insights';
import { mount, settle } from '../../test-support/hook-shim';
import { Dashboard, type ViewProps } from './Dashboard';
import { Gaps, type GapsViewProps } from './Gaps';
import { ReportList, ReportListView, ReportPage, ReportView } from './Reports';

// WO-0125: every load of the vendor portal ends in a handler. A loader that REJECTS (the wrappers of lib/vendor/insights.ts never do, but the loaders built on them can) must end on the fixed
// 'unexpected' sentence, not on "Loading." for ever. Each component is run by hand with hook stand-ins (test-support/hook-shim.ts), its effects started, and the next render read.
vi.mock('react', async (orig) => ({ ...(await orig<object>()), ...(await import('../../test-support/hook-shim')).hookStandIns }));
vi.mock('../../lib/supabase/browser', () => ({ createBrowserSupabase: () => ({}) }));
const { reject } = vi.hoisted(() => ({ reject: () => Promise.reject(new Error('the loader failed: internal detail')) }));
vi.mock('../../lib/vendor/dashboard', async (orig) => ({ ...(await orig<object>()), loadHeader: () => reject(), loadMix: () => reject(), loadTrends: () => reject(), loadSpectrum: () => reject() }));
vi.mock('../../lib/vendor/gaps', async (orig) => ({ ...(await orig<object>()), loadGaps: () => reject() }));
vi.mock('../../lib/vendor/reports', async (orig) => ({ ...(await orig<object>()), openReport: () => reject() }));
vi.mock('../../lib/vendor/insights', async (orig) => ({ ...(await orig<object>()), filterOptions: () => reject(), reports: () => reject() }));

const html = (el: ReactElement) => renderToStaticMarkup(el).replace(/class="_([a-z]+)_[0-9a-f]+"/g, 'class="$1"');
const FAILED = { ok: false, kind: 'unexpected', message: INSIGHT_SENTENCES.unexpected };
const ID = '0b3f8f0e-6a37-4a39-9d57-5f6c5a1d2f11';

describe('the helper', () => {
  it('is the fixed unexpected insight, with no server text', () => {
    expect(loadFailed()).toEqual(FAILED);
    expect(JSON.stringify(loadFailed())).not.toContain('internal detail');
  });
});

describe('Dashboard: a rejecting loader ends on the fixed sentence, in every slot', () => {
  it('starts on "Loading", then every slot holds the unexpected insight and the page shows the sentence once', async () => {
    const d = mount(Dashboard, {});
    const first = d.render() as ReactElement<ViewProps>;
    expect(first.props.header.coverage).toBeNull();
    expect(html(first)).toContain('Loading the figures.');
    d.flush(); await settle();
    const el = d.render() as ReactElement<ViewProps>;
    expect(el.props.header).toEqual({ coverage: FAILED, options: FAILED });
    expect(el.props.mix).toEqual(FAILED);
    expect(el.props.trends).toEqual({ purchase: FAILED, wishlist: FAILED });
    expect(el.props.spectrum).toEqual(FAILED);
    const page = html(el);
    expect(page).toContain(`<p class="error" role="alert">${INSIGHT_SENTENCES.unexpected}</p>`);
    expect(page).not.toContain('Loading');
    expect(page).not.toContain('internal detail');
    expect(a11yProblems(page)).toEqual([]);
  });
  it('a load that fails after the page was left changes no slot (every handler is guarded by `live`)', async () => {
    const d = mount(Dashboard, {});
    d.render(); d.flush(); d.unmount(); await settle();
    const el = d.render() as ReactElement<ViewProps>;
    expect(el.props.header).toEqual({ coverage: null, options: null });
    expect(el.props.mix).toBeNull();
    expect(el.props.trends).toEqual({ purchase: null, wishlist: null });
    expect(el.props.spectrum).toBeNull();
  });
});

describe('Gaps: a rejecting loader ends on the fixed sentence for the filters and for the table', () => {
  it('shows the sentence, no "Loading."', async () => {
    const g = mount(Gaps, {});
    const first = g.render() as ReactElement<GapsViewProps>;
    expect(first.props.data).toBeNull();
    expect(html(first)).toContain('Loading.');
    g.flush(); await settle();
    const el = g.render() as ReactElement<GapsViewProps>;
    expect(el.props.options).toEqual(FAILED);
    expect(el.props.data).toEqual(FAILED);
    const page = html(el);
    expect(page).toContain(`<p class="error" role="alert">${INSIGHT_SENTENCES.unexpected}</p>`);
    expect(page).not.toContain('Loading.');
    expect(a11yProblems(page)).toEqual([]);
  });
});

describe('Gaps and Reports: a load that fails after the page was left changes nothing', () => {
  it('Gaps', async () => {
    const g = mount(Gaps, {});
    g.render(); g.flush(); g.unmount(); await settle();
    const el = g.render() as ReactElement<GapsViewProps>;
    expect([el.props.options, el.props.data]).toEqual([null, null]);
  });
  it('the report list and one report', async () => {
    const l = mount(ReportList, {});
    l.render(); l.flush(); l.unmount(); await settle();
    expect((l.render() as ReactElement<{ list: unknown }>).props.list).toBeNull();
    const r = mount(ReportPage, { id: ID });
    r.render(); r.flush(); r.unmount(); await settle();
    expect((r.render() as ReactElement<{ one: unknown }>).props.one).toBeNull();
  });
});

describe('Reports: a rejecting loader ends on the fixed sentence for the list and for one report', () => {
  it('the list', async () => {
    const r = mount(ReportList, {});
    const first = r.render() as ReactElement<{ list: unknown }>;
    expect(first.props.list).toBeNull();
    expect(html(first)).toContain('Loading.');
    r.flush(); await settle();
    const el = r.render() as ReactElement<{ list: unknown }>;
    expect(el.props.list).toEqual(FAILED);
    expect(html(createElement(ReportListView, { list: FAILED as never }))).toBe(`<p class="error" role="alert">${INSIGHT_SENTENCES.unexpected}</p>`);
  });
  it('one report', async () => {
    const r = mount(ReportPage, { id: ID });
    const first = r.render() as ReactElement<{ one: unknown }>;
    expect(first.props.one).toBeNull();
    r.flush(); await settle();
    const el = r.render() as ReactElement<{ one: unknown }>;
    expect(el.props.one).toEqual(FAILED);
    const page = html(createElement(ReportView, { one: FAILED as never }));
    expect(page).toContain(`<p class="error" role="alert">${INSIGHT_SENTENCES.unexpected}</p>`);
    expect(page).not.toContain('Loading.');
    expect(a11yProblems(page)).toEqual([]);
  });
});
