import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { a11yProblems } from '../../test-support/a11y';
import { findAll, mount, settle, textOf, type Found } from '../../test-support/hook-shim';
import type { Send } from './admin-actions';
import { NO_CONNECTION, NOT_UNDERSTOOD } from './admin-actions';
import { Nav } from '../Nav';
import { AdminPilot, NO_TOTALS, addAnswer, blockers, minDate } from './AdminPilot';
import { END_PATH, MAX_CALLS, MAX_RETRIES, PREVIEW_PATH, SETTINGS_PATH, endCall, readEnd } from './pilot-actions';

// WO-0173: the end-of-pilot page. Run on the component function with hook stand-ins (no browser in these tests); the real browser run is in workflow/evidence/R8/screenshots/.
vi.mock('react', async (orig) => ({ ...(await orig<object>()), ...(await import('../../test-support/hook-shim')).hookStandIns }));

const where = vi.hoisted(() => ({ path: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => where.path }));

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const TODAY = '2026-11-19';
const SETTINGS = { pilot_end_date: TODAY, pilot_outcome: 'close' };
const PREVIEW = { consumers_to_delete: 3, unused_invitations: 2, vendor_users: 1 };
const UUID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const answer = (over: Record<string, unknown> = {}) => ({ processed: 2, deleted: 2, unmarked: 0, already_handled: 0, purge_failed: 0, delete_failed: 0, batches: 1, remaining: 0, done: true, invitations_deleted: 0, stuck: false, interrupted: false, more: false, vendors: null, ...over });

interface Call { path: string; method: string; body: unknown }
/** A fake server: settings and preview answers (or a promise for the preview), and a queue of answers for the end route. */
function fake(opts: { settings?: unknown; preview?: unknown | Promise<unknown>; reload?: Promise<unknown>; end?: (Response | Error)[] } = {}) {
  let previews = 0;
  const calls: Call[] = [];
  const queue = [...(opts.end ?? [])];
  const send: Send = async (path, init) => {
    calls.push({ path, method: String(init.method), body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    if (path === SETTINGS_PATH && init.method === 'GET') return json(200, opts.settings ?? SETTINGS);
    if (path === PREVIEW_PATH) { previews += 1; return json(200, await Promise.resolve(previews > 1 && opts.reload ? opts.reload : opts.preview ?? PREVIEW)); }
    if (init.method === 'PATCH') return json(200, typeof init.body === 'string' ? JSON.parse(init.body) : {});   // the route answers with the two saved values, which are the two sent
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected end call');
    if (next instanceof Error) throw next;
    return next;
  };
  return { send, calls, ends: () => calls.filter((c) => c.path === END_PATH) };
}
const until = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await settle(); };
async function open(f: ReturnType<typeof fake>, today = TODAY) {
  const c = mount(AdminPilot, { send: f.send, today });
  c.render(); c.flush();
  await until(() => f.calls.length >= 2);
  await settle();
  return c;
}
const buttons = (el: unknown) => findAll(el, (e) => e.type === 'button');
const endButton = (el: unknown) => buttons(el).find((b) => textOf(b) === 'End the pilot')!;
const typedBox = (el: unknown) => findAll(el, (e) => e.type === 'input' && e.props.type === 'text')[0]!;
const type = (el: unknown, v: string) => (typedBox(el).props.onChange as (e: unknown) => void)({ target: { value: v } });
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const press = (b: Found) => (b.props.onClick as (() => void) | undefined)?.();

describe('the calls: fixed paths, the fixed body, answers read into counts', () => {
  it('the end call is a POST with exactly {confirm: "END"}', async () => {
    const f = fake({ end: [json(200, answer())] });
    expect(await endCall(f.send)).toMatchObject({ kind: 'data' });
    expect(f.ends()).toEqual([{ path: '/api/admin/pilot/end', method: 'POST', body: { confirm: 'END' } }]);
  });
  it('an answer that is not JSON with a 5xx status is a retry; a fixed error sentence is shown; anything else says the server did not answer as expected', async () => {
    expect(await endCall(async () => new Response('<html>', { status: 504 }))).toEqual({ kind: 'retry' });
    expect(await endCall(async () => json(409, { error: { code: 'pilot_not_ended', message: 'The pilot has not ended yet.' } }))).toEqual({ kind: 'error', message: 'The pilot has not ended yet.' });
    expect(await endCall(async () => json(500, { error: { code: 'server_error', message: 'Something went wrong.' } }))).toEqual({ kind: 'error', message: 'Something went wrong.' });
    expect(await endCall(async () => new Response('<html>', { status: 302 }))).toEqual({ kind: 'error', message: NOT_UNDERSTOOD });
    expect(await endCall(async () => json(200, { done: true }))).toEqual({ kind: 'error', message: NOT_UNDERSTOOD });
    expect(await endCall(async () => { throw new Error('offline'); })).toEqual({ kind: 'error', message: NO_CONNECTION });
  });
  it('readEnd keeps counts and flags and drops everything else (no id, no address)', () => {
    const a = readEnd(answer({ user_ids: [UUID], email: 'a@b.test', vendors: { vendor_items_withdrawn: 4, vendor_users_deleted: 1, remaining: 0 } }));
    expect(a).toMatchObject({ deleted: 2, vendors: { items: 4, users: 1, remaining: 0 } });
    expect(JSON.stringify(a)).not.toContain(UUID);
    expect(JSON.stringify(a)).not.toContain('@');
    expect(readEnd(answer({ remaining: -1 }))).toBeNull();
    expect(readEnd(answer({ done: 'yes' }))).toBeNull();
  });
  it('the counts of the calls add up and `remaining` is the latest', () => {
    const one = readEnd(answer({ deleted: 5, remaining: 7, done: false, more: true, invitations_deleted: 1 }))!;
    const two = readEnd(answer({ deleted: 2, remaining: 0, vendors: { vendor_items_withdrawn: 3, vendor_users_deleted: 1, remaining: 0 } }))!;
    expect(addAnswer(addAnswer(NO_TOTALS, one), two)).toMatchObject({ deleted: 7, remaining: 0, invitations: 1, vendorItems: 3, vendorUsers: 1, vendorsRan: true });
  });
});

describe('when the End button is off', () => {
  const settings = { date: TODAY, outcome: 'close' as const };
  const preview = { consumers: 1, invitations: 0, vendors: 0, outcomeUnset: false };
  const ok = { settings, preview, typed: 'END', today: TODAY };
  it('is on only with the preview shown, an end date that has come, an outcome and the typed word', () => {
    expect(blockers(ok)).toEqual([]);
    expect(blockers({ ...ok, preview: null })[0]).toMatch(/preview/);
    expect(blockers({ ...ok, settings: { date: null, outcome: 'close' } })).toEqual(['No end date is saved.']);
    expect(blockers({ ...ok, settings: { date: '2026-11-20', outcome: 'close' } })).toEqual(['The end date (2026-11-20) has not been reached.']);
    expect(blockers({ ...ok, settings: { date: TODAY, outcome: null } })).toEqual(['No outcome is saved.']);
    expect(blockers({ ...ok, preview: { ...preview, outcomeUnset: true } })).toEqual(['No outcome is saved.']);
    for (const typed of ['', 'end', 'END ', 'EN']) expect(blockers({ ...ok, typed })).toEqual(['Type END to confirm.']);
  });
});

describe('the page', () => {
  it('shows the preview first: with the settings on the page, the date reached and END typed, the button stays off (and a press does nothing) until the preview arrives', async () => {
    let release: (v: unknown) => void = () => undefined;
    const f = fake({ preview: new Promise((r) => { release = r; }), end: [json(200, answer())] });
    const c = mount(AdminPilot, { send: f.send, today: TODAY });
    c.render(); c.flush();
    await until(() => html(c.render()).includes('Planned end date'));   // the settings are shown as soon as they arrive, the preview is still on its way
    let el = c.render();
    expect(html(el)).toContain('Loading the preview…');
    type(el, 'END');
    el = c.render();
    expect(endButton(el).props['aria-disabled']).toBe(true);
    expect(html(el)).toContain('The preview of what will be deleted is not on the page yet.');
    press(endButton(el));
    await settle();
    expect(f.ends()).toEqual([]);
    release(PREVIEW);
    await until(() => html(c.render()).includes('3 participants will be deleted'));
    el = c.render();
    expect(html(el)).toContain('Counts only. Nothing has been deleted yet.');
    expect(endButton(el).props['aria-disabled']).toBeUndefined();
    expect(f.ends()).toEqual([]);
  });
  it('shows the preview counts, the planned date and the form with labelled controls and no accessibility problem', async () => {
    const f = fake();
    const c = await open(f);
    const page = html(c.render());
    expect(page).toContain('<h1>End of the pilot</h1>');
    expect(page).toMatch(/3 participants will be deleted/);
    expect(page).toMatch(/2 unused invitations will be deleted/);
    expect(page).toMatch(/1 vendor account/);
    expect(page).toContain('Planned end date: <strong>2026-11-19</strong> (today)');
    for (const l of ['End date', 'Outcome', 'Type END to confirm']) expect(page).toContain(l);
    expect(page).toContain('Type END to confirm.');   // the reason the button is off
    expect(a11yProblems(page)).toEqual([]);
  });
  it('after a save the old preview is dropped: the button is off again until the new preview is on the page', async () => {
    let release: (v: unknown) => void = () => undefined;
    const f = fake({ reload: new Promise((r) => { release = r; }) });
    const c = await open(f);
    type(c.render(), 'END');
    expect(endButton(c.render()).props['aria-disabled']).toBeUndefined();
    const before = f.calls.length;
    (findAll(c.render(), (e) => e.type === 'form')[0]!.props.onSubmit as (e: unknown) => void)({ preventDefault: vi.fn() });
    await until(() => f.calls.length >= before + 2);
    await settle();
    expect(endButton(c.render()).props['aria-disabled']).toBe(true);
    expect(html(c.render())).toContain('Loading the preview…');
    release(PREVIEW);
    await until(() => endButton(c.render()).props['aria-disabled'] === undefined);
    expect(endButton(c.render()).props['aria-disabled']).toBeUndefined();
  });
  it('is off before the end date and with no outcome, and says why', async () => {
    const early = html((await open(fake({ settings: { pilot_end_date: '2026-12-01', pilot_outcome: 'close' } }))).render());
    expect(early).toContain('The end date (2026-12-01) has not been reached.');
    expect(early).toMatch(/class="danger" aria-disabled="true"/);
    const c = await open(fake({ settings: { pilot_end_date: TODAY, pilot_outcome: null } }));
    type(c.render(), 'END');
    const el = c.render();
    expect(html(el)).toContain('No outcome is saved.');
    expect(endButton(el).props['aria-disabled']).toBe(true);
  });
  it('saves the date and outcome with a PATCH of exactly those two keys, then loads the preview again', async () => {
    const f = fake({ settings: { pilot_end_date: null, pilot_outcome: null } });
    const c = await open(f);
    let el = c.render();
    const dateBox = findAll(el, (e) => e.type === 'input' && e.props.type === 'date')[0]!;
    (dateBox.props.onChange as (e: unknown) => void)({ target: { value: '2026-11-30' } });
    el = c.render();
    (findAll(el, (e) => e.type === 'select')[0]!.props.onChange as (e: unknown) => void)({ target: { value: 'continue' } });
    el = c.render();
    const form = findAll(el, (e) => e.type === 'form')[0]!;
    const before = f.calls.length;
    (form.props.onSubmit as (e: unknown) => void)({ preventDefault: vi.fn() });
    await until(() => f.calls.length >= before + 2);
    expect(f.calls.slice(before)[0]).toEqual({ path: '/api/admin/settings', method: 'PATCH', body: { pilot_end_date: '2026-11-30', pilot_outcome: 'continue' } });
    expect(f.calls.slice(before)[1]).toMatchObject({ path: '/api/admin/pilot/preview', method: 'GET' });
  });
});

describe('the run', () => {
  const READY = async (end: (Response | Error)[]) => { const f = fake({ end }); const c = await open(f); type(c.render(), 'END'); return { f, c }; };
  it('sends {confirm: "END"}, is busy while it runs (a second press does nothing), and shows the counts when it is done', async () => {
    const { f, c } = await READY([json(200, answer({ deleted: 3, processed: 3, invitations_deleted: 2 }))]);
    const el = c.render();
    press(endButton(el)); press(endButton(el));   // two presses in the same moment
    const busy = c.render();
    expect(endButton(busy).props['aria-busy']).toBe(true);
    expect(endButton(busy).props['aria-disabled']).toBe(true);
    expect(endButton(busy).props.disabled).toBeUndefined();   // not the disabled attribute: it keeps focus and is announced
    expect(endButton(busy).props.onClick).toBeUndefined();
    expect(html(busy)).toContain('aria-busy="true"');
    expect(a11yProblems(html(busy))).toEqual([]);
    await until(() => html(c.render()).includes('The pilot has ended'));
    expect(f.ends()).toEqual([{ path: END_PATH, method: 'POST', body: { confirm: 'END' } }]);
    const page = html(c.render());
    expect(page).toContain('3 participants deleted');
    expect(page).toContain('2 unused invitations deleted');
    expect(page).not.toContain('>End the pilot</button>');
    expect(page).not.toContain('Nothing has been deleted yet');   // the preview is of what the end WILL delete: it goes once the end has run
    expect(page).not.toContain('will be deleted');
    expect(a11yProblems(page)).toEqual([]);
  });
  it('a press while it is off does nothing', async () => {
    const f = fake({ end: [json(200, answer())] });
    const c = await open(f);
    press(endButton(c.render()));   // nothing typed
    await settle();
    expect(f.ends()).toEqual([]);
  });
  it('calls again on more: true and on an answer that is not JSON with a 5xx status, until done; the counts add up', async () => {
    const { f, c } = await READY([
      json(200, answer({ deleted: 5, processed: 5, remaining: 4, done: false, more: true })),
      new Response('Gateway Timeout', { status: 504 }),
      json(200, answer({ deleted: 4, processed: 4, remaining: 0, done: true, more: true, vendors: null })),
      json(200, answer({ deleted: 0, processed: 0, remaining: 0, done: true, more: false, vendors: { vendor_items_withdrawn: 6, vendor_users_deleted: 1, remaining: 0 } })),
    ]);
    press(endButton(c.render()));
    await until(() => html(c.render()).includes('The pilot has ended'));
    expect(f.ends()).toHaveLength(4);
    const page = html(c.render());
    expect(page).toContain('9 participants deleted');
    expect(page).toContain('6 vendor items withdrawn, 1 vendor account deleted');
  });
  it('calls again when the batches ran out with participants handled but the end not yet recorded (done false, more false)', async () => {
    const { f, c } = await READY([json(200, answer({ processed: 3, deleted: 3, remaining: 0, done: false })), json(200, answer({ processed: 0, deleted: 0, done: true }))]);
    press(endButton(c.render()));
    await until(() => html(c.render()).includes('The pilot has ended'));
    expect(f.ends()).toHaveLength(2);
  });
  it('stops at stuck: true, calls no more, and shows the failure count', async () => {
    const { f, c } = await READY([json(200, answer({ processed: 2, deleted: 0, purge_failed: 2, remaining: 2, done: false, stuck: true })), json(200, answer())]);
    press(endButton(c.render()));
    await until(() => html(c.render()).includes('The run stopped'));
    await settle();
    expect(f.ends()).toHaveLength(1);
    const page = html(c.render());
    expect(page).toContain('Stopped: 2 participants could not be removed');
    expect(page).toContain('2 participants still to do');
    expect(a11yProblems(page)).toEqual([]);
  });
  it('shows interrupted and stops; a refusal of the first call shows the server\'s sentence and the page goes back to ready', async () => {
    const a = await READY([json(200, answer({ interrupted: true, done: false, remaining: 6, deleted: 2 })), json(200, answer())]);
    press(endButton(a.c.render()));
    await until(() => html(a.c.render()).includes('The run stopped'));
    expect(a.f.ends()).toHaveLength(1);
    expect(html(a.c.render())).toContain('The server refused a later step after the run had started');
    const b = await READY([json(409, { error: { code: 'pilot_not_ended', message: 'The pilot has not ended yet.' } })]);
    press(endButton(b.c.render()));
    await until(() => html(b.c.render()).includes('The pilot has not ended yet.'));
    const el = b.c.render();
    expect(html(el)).toContain('role="alert"');
    expect(endButton(el).props['aria-busy']).toBeUndefined();   // pressable again
  });
  it('gives up after repeated non-JSON 5xx answers and after the call cap, and says so', async () => {
    const gone = () => new Response('x', { status: 502 });
    const a = await READY(Array.from({ length: MAX_RETRIES + 1 }, gone));
    press(endButton(a.c.render()));
    await until(() => html(a.c.render()).includes('did not answer as expected several times'));
    expect(a.f.ends()).toHaveLength(MAX_RETRIES + 1);
    const more = () => json(200, answer({ processed: 1, deleted: 1, remaining: 9, done: false, more: true }));
    const b = await READY(Array.from({ length: MAX_CALLS }, more));
    press(endButton(b.c.render()));
    await until(() => html(b.c.render()).includes(`Stopped after ${MAX_CALLS} calls`));
    expect(b.f.ends()).toHaveLength(MAX_CALLS);
  });
  it('shows counts only: an id or an address in an answer never reaches the page', async () => {
    const { c } = await READY([json(200, answer({ user_ids: [UUID], email: 'someone@example.test', vendors: null }))]);
    press(endButton(c.render()));
    await until(() => html(c.render()).includes('The pilot has ended'));
    const page = html(c.render());
    expect(page).not.toContain(UUID);
    expect(page).not.toContain('someone@example.test');
    expect(page).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
  it('drops answers that arrive after the page was left', async () => {
    const { f, c } = await READY([json(200, answer({ more: true, done: false, remaining: 5 })), json(200, answer())]);
    press(endButton(c.render()));
    c.unmount();
    await settle(); await settle();
    expect(f.ends().length).toBeLessThanOrEqual(1);
  });
});

describe('fix loop 1 (WO-0173)', () => {
  const READY = async (end: (Response | Error)[], reload?: Promise<unknown>) => { const f = fake({ end, reload }); const c = await open(f); type(c.render(), 'END'); return { f, c }; };
  it('after a stuck run the old preview is gone and the button is off until a new preview arrives', async () => {
    let release: (v: unknown) => void = () => undefined;
    const { f, c } = await READY([json(200, answer({ processed: 2, deleted: 0, purge_failed: 2, remaining: 2, done: false, stuck: true }))], new Promise((r) => { release = r; }));
    press(endButton(c.render()));
    await until(() => html(c.render()).includes('The run stopped'));
    await settle();
    let el = c.render();
    const page = html(el);
    expect(page).not.toContain('3 participants will be deleted');
    expect(page).not.toContain('Counts only');
    expect(page).toContain('Loading the preview…');
    expect(endButton(el).props['aria-disabled']).toBe(true);
    press(endButton(el));
    await settle();
    expect(f.ends()).toHaveLength(1);
    release({ consumers_to_delete: 2, unused_invitations: 0, vendor_users: 0 });
    await until(() => html(c.render()).includes('2 participants will be deleted'));
    el = c.render();
    expect(endButton(el).props['aria-disabled']).toBeUndefined();
  });
  it('the preview is dropped as soon as a run starts', async () => {
    const { c } = await READY([json(200, answer({ more: true, done: false, remaining: 5 }))]);
    press(endButton(c.render()));
    const el = c.render();
    expect(html(el)).not.toContain('will be deleted,');
    expect(html(el)).not.toContain('Counts only');
  });
  it('the warning is body text and carries the count from the preview', async () => {
    const page = html((await open(fake())).render());
    expect(page).toContain('<p>This deletes 3 participants and everything they saved for good. It cannot be taken back.');
    expect(page).not.toMatch(/<p class="muted">This deletes/);
  });
  it('the date field starts at the stored date when that has passed, else today; the saved message sits inside the form', async () => {
    expect(minDate(null, TODAY)).toBe(TODAY);
    expect(minDate('2026-11-01', TODAY)).toBe('2026-11-01');
    expect(minDate('2026-12-01', TODAY)).toBe(TODAY);
    expect(html((await open(fake({ settings: { pilot_end_date: '2026-11-01', pilot_outcome: 'close' } }))).render())).toContain('min="2026-11-01"');
    expect(html((await open(fake())).render())).toMatch(/<form[^>]*>[\s\S]*role="status"[\s\S]*<\/form>/);
  });
  it('the outcome options are Close and Continue with the explanation as a hint the select points at, and the loading status region is always there', async () => {
    const page = html((await open(fake())).render());
    expect(page).toContain('>Close</option>');
    expect(page).toContain('>Continue</option>');
    expect(page).toMatch(/<select[^>]*aria-describedby="([^"]+)"/);
    expect(page).toContain('Close deletes the participants');
    const early = html(mount(AdminPilot, { send: fake().send, today: TODAY }).render());
    expect(early).toMatch(/role="status">Loading…<\/p>/);
    expect(page).toMatch(/role="status"[^>]*><\/p>|role="status">/);
  });
});

describe('the page file and its route (source)', () => {
  it('the route is for the account-backed app only', () => {
    expect(read('../../app/admin/pilot/page.tsx')).toContain("if (dataBackend() !== 'supabase') notFound();");
  });
  it('uses only the stylesheet\'s classes, no inline style, no image, no external address, and no suppression', () => {
    const text = read('./AdminPilot.tsx');
    expect(text).not.toMatch(/style=|<img|https?:\/\//);
    for (const word of [['eslint', 'disable'].join('-'), ['ts', 'ignore'].join('-'), ['as', 'any'].join(' ')]) expect(text).not.toContain(word);   // no suppression, no cast to any (the words are joined here so this file holds none itself)
    const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');
    for (const cls of new Set([...text.matchAll(/className="([^"]+)"/g)].flatMap((m) => m[1]!.split(' ')))) expect(css, cls).toMatch(new RegExp(`\\.${cls}\\b`));
  });
});

describe('the navigation (WO-0173)', () => {
  const at = (path: string) => { where.path = path; return renderToStaticMarkup(Nav({}) as ReactElement); };
  it('links the catalogue and the end-of-pilot page on admin pages only', () => {
    for (const p of ['/admin/catalog', '/admin/pilot']) {
      const page = at(p);
      expect(page).toContain('href="/admin/catalog"');
      expect(page).toContain('href="/admin/pilot"');
      expect(page).toContain('End of pilot</a>');
    }
    expect(at('/admin/pilot')).toContain('aria-current="page"');
    for (const p of ['/', '/outfits', '/vendor', '/vendor/account', '/settings', '/admin', '/admin/x', '/admin/catalog/y']) expect(at(p), p).not.toContain('/admin/');   // an unrouted /admin/... page shows the ordinary links
  });
});
