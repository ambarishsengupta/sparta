import { describe, expect, it } from 'vitest';
import type { BucketApi, StorageLike } from './api';
import { handleItemDelete, ITEM_BUCKET, ITEM_DELETE_BRAKE, ITEM_DELETE_LIMIT, type ItemDeleteDeps, type ItemPaths } from './item-delete';
import { makeLimiter, routeLimit, type RateRpc } from './limits';

// WO-0183 (FR-16): the item delete handler over fakes. The log records every call in order, so the order (files before the row) is asserted, not assumed.
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ITEM = '5c1b3b52-0000-4000-8000-000000000001';
const IMG = `${ME}/photo.webp`;
const THUMB = `${ME}/photo-thumb.webp`;

interface World { rows: Map<string, { user_id: string } & ItemPaths>; objects: Set<string>; log: string[] }
function world(): World {
  return { rows: new Map([[ITEM, { user_id: ME, image_path: IMG, image_thumb_path: THUMB }]]), objects: new Set([IMG, THUMB]), log: [] };
}
function deps(w: World, over: { user?: { id: string } | null; getUserError?: unknown; readError?: unknown; storageError?: boolean; storageThrows?: boolean; deleteError?: boolean; uid?: string } = {}): ItemDeleteDeps {
  const uid = over.uid ?? ME;
  const bucket = (name: string): BucketApi => ({
    createSignedUrl: async () => ({ data: null, error: new Error('unused') }), createSignedUploadUrl: async () => ({ data: null, error: new Error('unused') }), list: async () => ({ data: [], error: null }),
    async remove(paths) {
      w.log.push(`remove ${name} ${paths.join(',')}`);
      if (over.storageThrows) throw new TypeError('fetch failed');
      if (over.storageError) return { data: null, error: new Error('down') };
      for (const p of paths) w.objects.delete(p);   // an object that is not there is not an error either
      return { data: paths.map((n) => ({ name: n })), error: null };
    },
  });
  return {
    getUser: async () => ({ data: { user: 'user' in over ? over.user! : { id: uid } }, error: over.getUserError ?? null }),
    readItem: async (id) => {
      w.log.push(`read ${id}`);
      if (over.readError) return { data: null, error: over.readError };
      const r = w.rows.get(id);
      return { data: r && r.user_id === uid ? { image_path: r.image_path, image_thumb_path: r.image_thumb_path } : null, error: null };   // row-level security: another person's row is not visible
    },
    storage: { from: bucket } as StorageLike,
    deleteRow: async (id, u) => {
      w.log.push(`delete ${id} ${u}`);
      if (over.deleteError) return { data: null, error: new Error('down') };
      const r = w.rows.get(id);
      if (r && r.user_id === u) { w.rows.delete(id); return { data: [{ id }], error: null }; }
      return { data: [], error: null };
    },
  };
}
const del = (id = ITEM, headers: Record<string, string> = {}, method = 'DELETE') => new Request(`https://app.test/api/items/${id}`, { method, headers: { 'sec-fetch-site': 'same-origin', ...headers } });
const code = async (r: Response) => ((await r.clone().json()) as { error?: { code: string } }).error?.code;

describe('deleting an item', () => {
  it('removes both files and then the row, and says only that it worked', async () => {
    const w = world();
    const r = await handleItemDelete(del(), ITEM, deps(w));
    expect([r.status, await r.json()]).toEqual([200, { ok: true }]);
    expect(w.objects.size).toBe(0);
    expect(w.rows.has(ITEM)).toBe(false);
    expect(w.log).toEqual([`read ${ITEM}`, `remove ${ITEM_BUCKET} ${IMG},${THUMB}`, `delete ${ITEM} ${ME}`]);
  });
  it('ORDER: the files go before the row (the row is the last call)', async () => {
    const w = world(); await handleItemDelete(del(), ITEM, deps(w));
    const at = (prefix: string) => w.log.findIndex((l) => l.startsWith(prefix));
    expect(at('remove')).toBeGreaterThan(-1);
    expect(at('remove')).toBeLessThan(at('delete'));
    expect(w.log[w.log.length - 1]).toMatch(/^delete /);
  });
  it('an item with no image, or with the same path twice, removes what it has once; an object already gone is not an error', async () => {
    const w = world(); w.rows.set(ITEM, { user_id: ME, image_path: null, image_thumb_path: null });
    expect((await handleItemDelete(del(), ITEM, deps(w))).status).toBe(200);
    expect(w.log.some((l) => l.startsWith('remove'))).toBe(false);
    const w2 = world(); w2.rows.set(ITEM, { user_id: ME, image_path: IMG, image_thumb_path: IMG }); w2.objects.clear();   // already missing from storage
    expect((await handleItemDelete(del(), ITEM, deps(w2))).status).toBe(200);
    expect(w2.log).toContain(`remove ${ITEM_BUCKET} ${IMG}`);
    expect(w2.rows.has(ITEM)).toBe(false);
  });
  it('the response never carries an id, a path or a name', async () => {
    const text = await (await handleItemDelete(del(), ITEM, deps(world()))).text();
    expect(text).not.toMatch(/photo|1111|5c1b3b52/);
  });
});

describe('a storage failure keeps the row', () => {
  it.each([['storage answers with an error', { storageError: true }], ['storage cannot be reached', { storageThrows: true }]] as const)('%s: 502, the row stays and is never asked to be deleted', async (_n, over) => {
    const w = world();
    const r = await handleItemDelete(del(), ITEM, deps(w, over));
    expect([r.status, await code(r)]).toEqual([502, 'storage_unavailable']);
    expect(w.rows.has(ITEM)).toBe(true);
    expect(w.log.some((l) => l.startsWith('delete'))).toBe(false);
  });
  it('a failure of the row delete itself is a 500 and says nothing of the cause', async () => {
    const r = await handleItemDelete(del(), ITEM, deps(world(), { deleteError: true }));
    expect([r.status, await code(r)]).toEqual([500, 'server_error']);
  });
});

describe('a missing item and another person\'s item get the same 404', () => {
  it('no such row, another person\'s row and an id that is not a UUID answer identically; nothing is removed', async () => {
    const answers: [number, string | undefined, string][] = [];
    for (const [id, make] of [
      ['5c1b3b52-0000-4000-8000-0000000000ff', () => world()],                                                       // no such item
      [ITEM, () => { const w = world(); w.rows.set(ITEM, { user_id: OTHER, image_path: `${OTHER}/o.webp`, image_thumb_path: null }); w.objects.add(`${OTHER}/o.webp`); return w; }],   // someone else's
      ['not-a-uuid', () => world()],
      ['../../etc', () => world()],
    ] as [string, () => World][]) {
      const w = make(); const before = [...w.objects];
      const r = await handleItemDelete(del(id), id, deps(w));
      answers.push([r.status, await code(r), await r.clone().text()]);
      expect([...w.objects]).toEqual(before);
      expect(w.log.some((l) => l.startsWith('remove') || l.startsWith('delete'))).toBe(false);
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual([404, 'item_not_found', expect.any(String)]);
  });
  it('even if the read were to return another person\'s row, the delete is matched on the caller\'s id and the files outside their folder are never removed', async () => {
    const w = world(); w.rows.set(ITEM, { user_id: OTHER, image_path: `${OTHER}/o.webp`, image_thumb_path: null }); w.objects.add(`${OTHER}/o.webp`);
    const d = deps(w); d.readItem = async () => ({ data: { image_path: `${OTHER}/o.webp`, image_thumb_path: null }, error: null });   // a broken read
    const r = await handleItemDelete(del(), ITEM, d);
    expect([r.status, await code(r)]).toEqual([500, 'server_error']);
    expect(w.objects.has(`${OTHER}/o.webp`)).toBe(true); expect(w.rows.has(ITEM)).toBe(true);
    const w2 = world(); w2.rows.set(ITEM, { user_id: OTHER, image_path: null, image_thumb_path: null });
    const d2 = deps(w2); d2.readItem = async () => ({ data: { image_path: null, image_thumb_path: null }, error: null });
    expect(await code(await handleItemDelete(del(), ITEM, d2))).toBe('item_not_found');   // deleteRow matched id AND user id: zero rows
    expect(w2.rows.has(ITEM)).toBe(true);
  });
  it('a path that is not under the caller\'s folder, or that climbs out of it, is refused before anything is removed', async () => {
    for (const bad of [`${OTHER}/o.webp`, `${ME}/../${OTHER}/o.webp`, 'orphan.webp']) {
      const w = world(); w.rows.set(ITEM, { user_id: ME, image_path: bad, image_thumb_path: THUMB });
      expect(await code(await handleItemDelete(del(), ITEM, deps(w)))).toBe('server_error');
      expect(w.log.some((l) => l.startsWith('remove') || l.startsWith('delete'))).toBe(false);
    }
  });
});

describe('who may delete', () => {
  it('no session is 401 and nothing is read', async () => {
    const w = world();
    const r = await handleItemDelete(del(), ITEM, deps(w, { user: null }));
    expect([r.status, await code(r)]).toEqual([401, 'not_signed_in']); expect(w.log).toEqual([]);
  });
  it('a session lookup that errors or throws is refused without reading anything', async () => {
    const w = world();
    expect(await code(await handleItemDelete(del(), ITEM, deps(w, { getUserError: new Error('x') })))).toBe('not_signed_in');
    const d = deps(w); d.getUser = async () => { throw new TypeError('fetch failed'); };
    expect(await code(await handleItemDelete(del(), ITEM, d))).toBe('unavailable'); expect(w.log).toEqual([]);
  });
  it('only DELETE; and a request from another origin, or with no same-origin proof, is 403', async () => {
    const w = world();
    expect(await code(await handleItemDelete(del(ITEM, {}, 'POST'), ITEM, deps(w)))).toBe('method_not_allowed');
    expect(await code(await handleItemDelete(del(ITEM, { origin: 'https://evil.test' }), ITEM, deps(w)))).toBe('forbidden');
    expect(await code(await handleItemDelete(new Request(`https://app.test/api/items/${ITEM}`, { method: 'DELETE' }), ITEM, deps(w)))).toBe('forbidden');
    expect(await code(await handleItemDelete(del(ITEM, { origin: 'https://app.test' }), ITEM, deps(w)))).toBeUndefined();   // the same origin is fine
    expect(w.log.filter((l) => l.startsWith('remove')).length).toBe(1);
  });
  it('a read that fails is 503, and the files and the row are untouched', async () => {
    const w = world();
    expect(await code(await handleItemDelete(del(), ITEM, deps(w, { readError: { code: 'x' } })))).toBe('unavailable');
    expect(w.rows.has(ITEM)).toBe(true); expect(w.objects.size).toBe(2);
  });
});

describe('the rate limit (LLD section 10 names no figure for item delete: 30 per person in 600 seconds, the purge route\'s per-process brake)', () => {
  const limited = (rpc: RateRpc, brake = makeLimiter(ITEM_DELETE_BRAKE.max, ITEM_DELETE_BRAKE.windowMs)) => routeLimit(brake, rpc, ITEM_DELETE_LIMIT);
  it('the figures: 30 per person in 600 seconds (shared count), and the purge route\'s brake of 30 per minute per process', () => {
    expect(ITEM_DELETE_LIMIT).toEqual({ max: 30, windowSeconds: 600 });
    expect(ITEM_DELETE_BRAKE).toEqual({ max: 30, windowMs: 60_000 });
  });
  it('counts in the database per person, under its own bucket; the 31st deletion in the window is 429 and removes nothing', async () => {
    const hits = new Map<string, number>(); const asked: [string, number, number][] = [];
    const rpc: RateRpc = async (b, max, win) => { asked.push([b, max, win]); const n = (hits.get(b) ?? 0) + 1; hits.set(b, n); return { data: n <= max, error: null }; };
    const limit = limited(rpc);
    for (let i = 0; i < 30; i++) expect((await handleItemDelete(del(), ITEM, { ...deps(world()), limit })).status).toBe(200);
    const w = world();
    const r = await handleItemDelete(del(), ITEM, { ...deps(w), limit });
    expect([r.status, await code(r)]).toEqual([429, 'rate_limited']);
    expect(w.log).toEqual([]);
    expect(asked[0]).toEqual([`item-delete:${ME}`, 30, 600]);
  });
  it('the shared count is asked before the per-process brake, so a person over their own limit uses no brake slot', async () => {
    let slots = 0; const brake = () => { slots += 1; return true; };
    const limit = limited(async () => ({ data: false, error: null }), brake);
    await handleItemDelete(del(), ITEM, { ...deps(world()), limit });
    expect(slots).toBe(0);
  });
  it('a refusal by the per-process brake is 429 without any read', async () => {
    const w = world();
    const r = await handleItemDelete(del(), ITEM, { ...deps(w), limit: limited(async () => ({ data: true, error: null }), () => false) });
    expect([r.status, await code(r)]).toEqual([429, 'rate_limited']); expect(w.log).toEqual([]);
  });
  it.each([
    ['the database answers with an error', async () => ({ data: null, error: { code: '57P01' } })],
    ['the call rejects', async () => { throw new TypeError('fetch failed'); }],
    ['the answer is not true or false', async () => ({ data: null, error: null })],
  ] as [string, RateRpc][])('FAIL CLOSED when %s: 503 and nothing is read, removed or deleted', async (_n, rpc) => {
    const w = world();
    const r = await handleItemDelete(del(), ITEM, { ...deps(w), limit: limited(rpc) });
    expect([r.status, await code(r)]).toEqual([503, 'unavailable']);
    expect(w.log).toEqual([]); expect(w.rows.has(ITEM)).toBe(true); expect(w.objects.size).toBe(2);
  });
  it('a call with no valid session is refused before it is counted', async () => {
    let counted = 0;
    await handleItemDelete(del(), ITEM, { ...deps(world(), { user: null }), limit: limited(async () => { counted += 1; return { data: true, error: null }; }) });
    expect(counted).toBe(0);
  });
});
