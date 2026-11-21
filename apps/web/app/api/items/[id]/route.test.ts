import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// WO-0183: the route's own wiring. The handler's rules are tested in lib/server/item-delete.test.ts; here: the backend switch, which client does what, and that the limit is passed.
const ME = '11111111-1111-4111-8111-111111111111';
const ITEM = '5c1b3b52-0000-4000-8000-000000000001';
const log: string[] = [];
let rpcAnswer: unknown = true;
vi.mock('../../../../lib/server/admin', () => ({
  createAdminSupabase: () => ({
    storage: { from: (b: string) => ({ remove: async (p: string[]) => { log.push(`admin storage remove ${b} ${p.join(',')}`); return { data: [], error: null }; } }) },
    schema: () => ({
      rpc: async (fn: string) => { log.push(`admin rpc ${fn}`); return { data: rpcAnswer, error: null }; },
      from: (t: string) => ({ delete: () => ({ eq: (c1: string, v1: string) => ({ eq: (c2: string, v2: string) => ({ select: async () => { log.push(`admin delete ${t} ${c1}=${v1} ${c2}=${v2}`); return { data: [{ id: v1 }], error: null }; } }) }) }) }),
    }),
  }),
}));
vi.mock('../../../../lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ME } }, error: null }) },
    schema: () => ({ from: (t: string) => ({ select: (cols: string) => ({ eq: (c: string, v: string) => ({ maybeSingle: async () => { log.push(`caller read ${t} ${cols} ${c}=${v}`); return { data: { image_path: `${ME}/a.webp`, image_thumb_path: `${ME}/b.webp` }, error: null }; } }) }) }) }),
  }),
}));

const ctx = { params: Promise.resolve({ id: ITEM }) };
const req = () => new Request(`https://app.test/api/items/${ITEM}`, { method: 'DELETE', headers: { 'sec-fetch-site': 'same-origin' } });
beforeEach(() => { log.length = 0; rpcAnswer = true; });
afterEach(() => vi.unstubAllEnvs());

describe('DELETE /api/items/[id]', () => {
  it('is 404 with no body unless the backend is supabase, and builds no client', async () => {
    const { DELETE } = await import('./route');
    for (const b of ['', 'local']) { vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', b); const r = await DELETE(req(), ctx); expect([r.status, await r.text()]).toEqual([404, '']); }
    expect(log).toEqual([]);
  });
  it('with the supabase backend: the caller\'s session reads the item, the secret-key storage removes both files, then the secret-key client deletes the row by id and user id', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase');
    const { DELETE } = await import('./route');
    const r = await DELETE(req(), ctx);
    expect([r.status, await r.json()]).toEqual([200, { ok: true }]);
    expect(log).toEqual([
      `admin rpc rate_limit_hit`,
      `caller read items image_path, image_thumb_path id=${ITEM}`,
      `admin storage remove item-images ${ME}/a.webp,${ME}/b.webp`,
      `admin delete items id=${ITEM} user_id=${ME}`,
    ]);
  });
  it('fails closed when the shared count says no or cannot say', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase');
    const { DELETE } = await import('./route');
    rpcAnswer = false;
    expect((await DELETE(req(), ctx)).status).toBe(429);
    rpcAnswer = null;
    expect((await DELETE(req(), ctx)).status).toBe(503);
    expect(log.filter((l) => !l.startsWith('admin rpc'))).toEqual([]);
  });
});

describe('the route\'s source', () => {
  const src = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
  it('passes the limit to the handler (it is optional there), uses the purge numbers through ITEM_DELETE_LIMIT, and keeps the secret-key client in this route only', () => {
    expect(src).toContain('limit: routeLimit(brake, rateRpcOf(admin), ITEM_DELETE_LIMIT)');
    expect(src).toContain('storage: admin.storage,');
    expect(src).toContain(".eq('id', itemId).eq('user_id', uid)");
    expect(src).toContain("caller.schema('app').from('items')");
    expect(src).toContain('createAdminSupabase()');
  });
  it('takes the id from the route\'s own segment only: no query string, body or header is read', () => {
    expect(src).not.toMatch(/searchParams|\.json\(\)|\.text\(\)|formData|headers/);
  });
});
