import { existsSync, readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Nav } from '../components/Nav';
import { BANNER_READ_TIMEOUT_MS, loadBanner } from '../components/shared/load-banner';
import { EndOfPilotBanner, OUTCOME_COPY } from '../components/shared/PilotEndBanner';
import type { Database } from '../lib/supabase/database.types';
import { metadata } from './layout';

const path = vi.hoisted(() => ({ now: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => path.now }));
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('app shell (WO-0022 items 5 and 6)', () => {
  it.each([['/', 'Wardrobe', 'Outfits'], ['/outfits', 'Outfits', 'Wardrobe']])('on %s only the %s link is marked aria-current="page"', (at, on, off) => {
    path.now = at;
    const html = renderToStaticMarkup(createElement(Nav));
    expect(html).toMatch(new RegExp(`<a[^>]*aria-current="page"[^>]*>${on}</a>`));
    expect(html).not.toMatch(new RegExp(`<a[^>]*aria-current[^>]*>${off}</a>`));
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });
  it('on a page that is in neither link nothing is marked', () => {
    path.now = '/items/new';
    expect(renderToStaticMarkup(createElement(Nav))).not.toContain('aria-current');
  });
  it('declares an icon that exists in public/, so /favicon.ico is not requested', () => {
    expect(metadata.icons).toEqual({ icon: '/icon.svg' });
    expect(existsSync(new URL('../public/icon.svg', import.meta.url))).toBe(true);
  });
  it('wardrobe item links do not prefetch, so item ids are not sent in prefetch requests', () => {
    expect(read('../components/wardrobe/WardrobeList.tsx')).toMatch(/<Link href=\{`\/items\/\$\{item\.id\}`\} prefetch=\{false\}/);
  });
});

describe('end-of-pilot banner in the shell (WO-0161, FR-69)', () => {
  const shown = (outcome: 'close' | 'continue', daysLeft = 10) => renderToStaticMarkup(createElement(EndOfPilotBanner, { state: { show: true, endDate: '2026-12-15', outcome, daysLeft } }));
  it.each(['close', 'continue'] as const)('shows the end date, the %s consequence and both links', (outcome) => {
    const html = shown(outcome);
    expect(html).toContain('The pilot ends on 15 December 2026');
    expect(html).toContain(OUTCOME_COPY[outcome]);
    expect(html).toMatch(/<a[^>]*href="\/settings"[^>]*>Export my data<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/leave"[^>]*>Leave the pilot<\/a>/);
  });
  it('is one labelled region, not a live region, so it is not announced on every navigation', () => {
    const html = shown('close');
    expect(html.match(/<section/g)).toHaveLength(1);
    expect(html).toContain('aria-labelledby="pilot-end-title"');
    expect(html).not.toMatch(/aria-live|role="(alert|status)"/);
  });
  it('says the pilot ended once the date is past', () => expect(shown('close', -3)).toContain('The pilot ended on 15 December 2026'));
  it('renders nothing when hidden', () => expect(renderToStaticMarkup(createElement(EndOfPilotBanner, { state: { show: false } }))).toBe(''));
  it('is placed in the shell only for a signed-in person, and the loader limits it to consumers on the Supabase backend', () => {
    expect(read('./layout.tsx')).toMatch(/\{signedIn && <PilotEndBanner \/>\}/);
    const banner = read('../components/shared/PilotEndBanner.tsx');
    expect(banner).toMatch(/dataBackend\(\) !== 'supabase'\) return null/);
    expect(read('../components/shared/load-banner.ts')).toMatch(/role !== 'consumer'/);
  });
});

const END = '2026-12-15';
const NOW = new Date('2026-12-01T10:00:00Z');   // 14 days before END

type Reply = { data: unknown; error: unknown };
/** A stand-in for the caller's client: the profile row, and each `public_setting` answer by key. */
function fake(profile: Reply, settings: Record<string, Reply>): Pick<SupabaseClient<Database>, 'schema'> {
  const app = {
    from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve(profile) }) }),
    rpc: (_fn: string, args: { p_key: string }) => Promise.resolve(settings[args.p_key] ?? { data: null, error: null }),
  };
  return { schema: () => app } as unknown as Pick<SupabaseClient<Database>, 'schema'>;
}
const ok = (data: unknown): Reply => ({ data, error: null });
const SET = { pilot_end_date: ok(END), pilot_outcome: ok('close') };

describe('loadBanner: consumers only, nothing on failure (WO-0161)', () => {
  it('a consumer inside the window gets the state', async () => expect(await loadBanner(fake(ok({ role: 'consumer' }), SET), NOW)).toMatchObject({ show: true, endDate: END, outcome: 'close' }));
  it('a consumer outside the window gets nothing', async () => expect(await loadBanner(fake(ok({ role: 'consumer' }), SET), new Date('2026-11-30T23:00:00Z'))).toEqual({ show: false }));
  it.each(['vendor', 'admin'])('a %s gets nothing', async (role) => expect(await loadBanner(fake(ok({ role }), SET), NOW)).toEqual({ show: false }));
  it('no profile gets nothing', async () => expect(await loadBanner(fake(ok(null), SET), NOW)).toEqual({ show: false }));
  it('a failed profile read gets nothing', async () => expect(await loadBanner(fake({ data: null, error: { message: 'x' } }, SET), NOW)).toEqual({ show: false }));
  it('a failed setting read gets nothing', async () => expect(await loadBanner(fake(ok({ role: 'consumer' }), { ...SET, pilot_outcome: { data: null, error: { message: 'x' } } }), NOW)).toEqual({ show: false }));
  it('a read that never answers gives nothing within the time limit, and the limit is about a second', async () => {
    const never = new Promise<Reply>(() => undefined);
    const hung = { schema: () => ({ from: () => ({ select: () => ({ maybeSingle: () => never }) }), rpc: () => never }) } as unknown as Pick<SupabaseClient<Database>, 'schema'>;
    expect(BANNER_READ_TIMEOUT_MS).toBeGreaterThanOrEqual(500);
    expect(BANNER_READ_TIMEOUT_MS).toBeLessThanOrEqual(1500);
    expect(await loadBanner(hung, NOW, 30)).toEqual({ show: false });
  });
  it('a thrown read gets nothing and logs nothing', async () => {
    const throwing = { schema: () => { throw new Error('down'); } } as unknown as Pick<SupabaseClient<Database>, 'schema'>;
    expect(await loadBanner(throwing, NOW)).toEqual({ show: false });
  });
});
