import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mount, settle } from '../../test-support/hook-shim';
import { Dashboard, type ViewProps } from './Dashboard';

// WO-0152: the `live` guard of the vendor views. A result that arrives after the view changed (the segment picked again) or after the page was left is dropped, so a slow answer for the old view
// never replaces the figures of the new one. Each load here is a promise the test settles by hand, in the order that makes the old answer arrive last.
vi.mock('react', async (orig) => ({ ...(await orig<object>()), ...(await import('../../test-support/hook-shim')).hookStandIns }));
vi.mock('../../lib/supabase/browser', () => ({ createBrowserSupabase: () => ({}) }));
type Mix = { ok: true; data: { segment: string; value: number }[] };
const { mixCalls, headerCalls, brandCalls } = vi.hoisted(() => ({ mixCalls: [] as { dim: string; resolve: (r: unknown) => void }[], headerCalls: [] as { resolve: (r: unknown) => void }[], brandCalls: [] as { resolve: (r: unknown) => void }[] }));
vi.mock('../../lib/vendor/brands', async (orig) => ({ ...(await orig<object>()), loadBrandLabels: () => new Promise((resolve) => { brandCalls.push({ resolve }); }) }));   // WO-0155
vi.mock('../../lib/vendor/dashboard', async (orig) => ({
  ...(await orig<object>()),
  loadHeader: () => new Promise((resolve) => { headerCalls.push({ resolve }); }),
  loadMix: (_c: unknown, s: { mixDim: string }) => new Promise((resolve) => { mixCalls.push({ dim: s.mixDim, resolve }); }),
  loadTrends: () => new Promise(() => undefined),
  loadSpectrum: () => new Promise(() => undefined),
}));

const mix = (segment: string): Mix => ({ ok: true, data: [{ segment, value: 5 }] });
const props = (d: ReturnType<typeof mount>) => (d.render() as ReactElement<ViewProps>).props;

describe('Dashboard: the live guard drops a result that arrives after the view changed', () => {
  it('a mix result for the segment that was picked before is dropped; the one for the current segment is kept', async () => {
    mixCalls.length = 0;
    const d = mount(Dashboard, {});
    d.render(); d.flush();
    expect(mixCalls.map((c) => c.dim)).toEqual(['category']);
    props(d).onPick({ mixDim: 'brand' });
    d.render(); d.flush();                                   // the effect of the old view is cleaned up, the new one starts
    expect(mixCalls.map((c) => c.dim)).toEqual(['category', 'brand']);
    mixCalls[0]!.resolve(mix('OLD-VIEW'));                   // the old answer arrives after the change
    await settle();
    expect(props(d).mix).toBeNull();                         // dropped: still loading the new view
    mixCalls[1]!.resolve(mix('NEW-VIEW'));
    await settle();
    expect(props(d).mix).toEqual(mix('NEW-VIEW'));
  });
  it('a header result that arrives after the page was left changes nothing', async () => {
    headerCalls.length = 0;
    const d = mount(Dashboard, {});
    d.render(); d.flush();
    expect(headerCalls).toHaveLength(1);
    d.unmount();
    headerCalls[0]!.resolve({ coverage: { ok: true, data: { users_rounded: 150, last_run_at: null } }, options: { ok: true, data: [] } });
    await settle();
    expect(props(d).header).toEqual({ coverage: null, options: null });
  });
});

// WO-0155: the brand label map is loaded once per page, with the same guard.
describe('Dashboard: the live guard holds for the brand label map', () => {
  it('a map that arrives after the page was left changes nothing', async () => {
    brandCalls.length = 0;
    const d = mount(Dashboard, {});
    d.render(); d.flush();
    expect(brandCalls).toHaveLength(1);
    d.unmount();
    brandCalls[0]!.resolve(new Map([['demo-h-and-m', 'H&M']]));
    await settle();
    expect(props(d).brands?.size).toBe(0);
  });
  it('a map that arrives while the page is open is used, and is not loaded again when the view changes', async () => {
    brandCalls.length = 0;
    const d = mount(Dashboard, {});
    d.render(); d.flush();
    props(d).onPick({ mixDim: 'brand' });
    d.render(); d.flush();
    expect(brandCalls).toHaveLength(1);
    brandCalls[0]!.resolve(new Map([['demo-h-and-m', 'H&M']]));
    await settle();
    expect(props(d).brands?.get('demo-h-and-m')).toBe('H&M');
  });
});
