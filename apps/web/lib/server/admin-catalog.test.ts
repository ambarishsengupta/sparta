import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createSource, decideReview, listReview, listSources, takeDownSource, updateSource } from './admin-catalog';

// The caller checks with fake clients (no stack): what is asked, in what order, and that nothing reaches the secret-key client before the caller is known to be an admin.
type User = { id: string } | null;
function rig(opts: { user?: User; authError?: { status?: number } | null; role?: unknown; roleError?: boolean }) {
  const touched: string[] = [];
  const caller = {
    auth: { getUser: async () => ({ data: { user: opts.user === undefined ? { id: 'u1' } : opts.user }, error: opts.authError ?? null }) },
    schema: () => ({ rpc: async (name: string) => (name === 'current_role' ? { data: opts.role === undefined ? 'admin' : opts.role, error: opts.roleError ? { code: 'XX' } : null } : (touched.push(`caller:${name}`), { data: 0, error: null })) }),
  } as unknown as SupabaseClient;
  const admin = { schema: () => { touched.push('admin'); throw new Error('the secret-key client must not be used'); } } as unknown as SupabaseClient;
  return { d: { caller, admin }, touched };
}
const req = (method = 'POST', headers: Record<string, string> = { origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' }) => new Request('http://127.0.0.1:3000/api/admin/x', { method, headers, body: method === 'GET' ? undefined : '{}' });
const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;
const ALL: [string, (r: Request, d: ReturnType<typeof rig>['d']) => Promise<Response>, string][] = [
  ['listSources', listSources, 'GET'], ['createSource', createSource, 'POST'], ['updateSource', updateSource, 'PATCH'], ['takeDownSource', (r, d) => takeDownSource(r, d, '3'), 'POST'], ['listReview', listReview, 'GET'], ['decideReview', decideReview, 'POST'],
];

describe.each(ALL)('%s: who may call', (_n, go, method) => {
  it('a session that answers with no user and no error is 401, and the secret-key client is never touched', async () => {
    const r = rig({ user: null });
    const res = await go(req(method), r.d);
    expect([res.status, await code(res)]).toEqual([401, 'not_signed_in']);
    expect(r.touched).toEqual([]);
  });
  it('an account service that fails is 503 (not 401), and a role read that fails is 500', async () => {
    expect((await go(req(method), rig({ user: null, authError: { status: 503 } }).d)).status).toBe(503);
    expect((await go(req(method), rig({ roleError: true }).d)).status).toBe(500);
  });
  it.each(['consumer', 'vendor', null, undefined, 'Admin', 'admin '])('the role %s is 403 and nothing else is touched', async (role) => {
    const r = rig({ role: role === undefined ? 'none' : role });
    const res = await go(req(method), r.d);
    expect([res.status, await code(res)]).toEqual([403, 'forbidden']);
    expect(r.touched).toEqual([]);
  });
});

describe('mutating calls need the origin evidence before anything else', () => {
  it.each(ALL.filter((a) => a[2] !== 'GET'))('%s from another site is 403 without even asking who the caller is', async (_n, go, method) => {
    const r = rig({});
    for (const headers of [{ origin: 'http://evil.example.test' }, {}, { 'sec-fetch-site': 'cross-site' }] as Record<string, string>[]) expect((await go(req(method, headers), r.d)).status).toBe(403);
    expect(r.touched).toEqual([]);
  });
});
