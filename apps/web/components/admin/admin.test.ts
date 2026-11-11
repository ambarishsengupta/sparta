import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { a11yProblems } from '../../test-support/a11y';
import { AdminCatalog, TakedownConfirm, sourceState } from './AdminCatalog';
import type { Source } from './AdminCatalog';
import { NO_CONNECTION, NOT_UNDERSTOOD, REVIEW_PATH, SOURCES_PATH, adminCall, takedownPath } from './admin-actions';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const source: Source = { id: 7, name: 'Demo shop', site_url: 'https://shop.example.test/', robots_allowed: true, terms_note: 'ok', allowed: true, checked_on: '2026-11-10', contact: null, takedown_at: null, takedown_note: null };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('adminCall: same-origin calls that never throw', () => {
  it('sends the session cookie, a JSON body only when there is one, and returns the data on success', async () => {
    const send = vi.fn(async () => json(200, { sources: [] }));
    expect(await adminCall(SOURCES_PATH, 'GET', undefined, send)).toEqual({ ok: true, data: { sources: [] } });
    expect(send).toHaveBeenCalledWith('/api/admin/sources', { method: 'GET', credentials: 'same-origin' });
    await adminCall(SOURCES_PATH, 'PATCH', { id: 1, allowed: true }, send);
    expect(send).toHaveBeenLastCalledWith('/api/admin/sources', { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{"id":1,"allowed":true}' });
  });
  it('shows the server\'s fixed sentence on an error, a plain sentence for anything unreadable, and one for no connection', async () => {
    expect(await adminCall(SOURCES_PATH, 'POST', {}, async () => json(403, { error: { code: 'forbidden', message: 'Not allowed.' } }))).toEqual({ ok: false, message: 'Not allowed.' });
    expect(await adminCall(SOURCES_PATH, 'GET', undefined, async () => new Response('<html>', { status: 502 }))).toEqual({ ok: false, message: NOT_UNDERSTOOD });
    expect(await adminCall(SOURCES_PATH, 'GET', undefined, async () => new Response('not json', { status: 200 }))).toEqual({ ok: false, message: NOT_UNDERSTOOD });
    expect(await adminCall(SOURCES_PATH, 'GET', undefined, async () => { throw new Error('offline'); })).toEqual({ ok: false, message: NO_CONNECTION });
  });
  it('knows the three fixed paths', () => { expect([SOURCES_PATH, REVIEW_PATH, takedownPath(12)]).toEqual(['/api/admin/sources', '/api/admin/catalog/review', '/api/admin/sources/12/takedown']); });
});

describe('the admin page (CC9)', () => {
  const out = renderToStaticMarkup(createElement(AdminCatalog));
  it('has one h1, the register and the review queue as headings, a labelled add form and no unnamed control', () => {
    expect(out).toContain('<h1>Catalogue admin</h1>');
    for (const h of ['Source register', 'Review queue', 'Add a source']) expect(out).toContain(h);
    for (const label of ['Name', 'Site address', 'robots.txt permits collection', 'Terms note', 'Checked on', 'Contact (optional)']) expect(out).toContain(label);
    expect(a11yProblems(out)).toEqual([]);
  });
  it('the take-down confirmation names the source, says what is deleted and what stays, and acts only on the confirm button', () => {
    const calls: string[] = [];
    const html = renderToStaticMarkup(createElement(TakedownConfirm, { source, onConfirm: (n: string) => calls.push(`confirm:${n}`), onCancel: () => calls.push('cancel') }));
    expect(html).toContain('aria-label="Confirm take-down of Demo shop"');
    expect(html).toMatch(/Every catalogue item from this source is deleted and cannot be brought back/);
    expect(html).toMatch(/stays in the register as not allowed/);
    expect(html).toContain('Confirm take-down</button>');
    expect(html).toContain('Cancel</button>');
    expect(calls).toEqual([]);
    expect(a11yProblems(html)).toEqual([]);
  });
  it('shows the state of a source in words', () => {
    expect(sourceState({ allowed: true, takedown_at: null })).toBe('Allowed');
    expect(sourceState({ allowed: false, takedown_at: null })).toBe('Not allowed');
    expect(sourceState({ allowed: false, takedown_at: '2026-11-11T00:00:00Z' })).toBe('Taken down');
    expect(sourceState({ allowed: true, takedown_at: '2026-11-11T00:00:00Z' })).toBe('Taken down');
  });
  it('the Take down button opens the confirmation and the call is made from the confirm button only (source)', () => {
    const text = read('./AdminCatalog.tsx');
    expect(text).toContain('onClick={() => setConfirming(s)}>Take down…');
    expect(text.match(/takedownPath\(/g)).toHaveLength(1);
    expect(text).toMatch(/onConfirm=\{\(note\) => \{ const s = confirming; setConfirming\(null\);/);
  });
  it('the page uses only the stylesheet\'s classes, no inline style, no image and no external address', () => {
    const text = read('./AdminCatalog.tsx');
    expect(text).not.toMatch(/style=|<img|https?:\/\//);
    const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');
    for (const cls of new Set([...text.matchAll(/className="([^"]+)"/g)].flatMap((m) => m[1]!.split(' ')))) expect(css, cls).toMatch(new RegExp(`\\.${cls}\\b`));
  });
  it('the page route is for the account-backed app only and the proxy keeps everyone but the admin state out', () => {
    expect(read('../../app/admin/catalog/page.tsx')).toContain("if (dataBackend() !== 'supabase') notFound();");
  });
});
