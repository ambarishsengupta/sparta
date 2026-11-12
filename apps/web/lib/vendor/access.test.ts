import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { VENDOR_AGREEMENT_VERSION, acceptVendorAgreement, ownVendor } from './access';

type Out = { data?: unknown; error?: { code: string } | null };
/** A client with the given answers; `inserts` records what was written. */
function fake(o: { user?: boolean; members?: Out; vendor?: Out; insert?: Out }) {
  const inserts: unknown[] = [];
  const table = (name: string) => name === 'vendor_members' ? { select: async () => o.members ?? { data: [{ vendor_id: 'v1' }], error: null } }
    : name === 'vendors' ? { select: () => ({ eq: () => ({ maybeSingle: async () => o.vendor ?? { data: { name: 'Acme' }, error: null } }) }) }
      : { insert: async (row: unknown) => { inserts.push(row); return o.insert ?? { error: null }; } };
  return { inserts, client: { auth: { getUser: async () => ({ data: { user: o.user === false ? null : { id: 'u1' } } }) }, schema: () => ({ from: table }) } as unknown as SupabaseClient };
}

describe('ownVendor', () => {
  it('is the one membership, with its name when readable', async () => { expect(await ownVendor(fake({}).client)).toEqual({ id: 'v1', name: 'Acme' }); });
  it('has no name when the table is not readable', async () => { expect(await ownVendor(fake({ vendor: { data: null, error: { code: '42501' } } }).client)).toEqual({ id: 'v1', name: null }); });
  it('is null for no membership, two memberships or a failed read', async () => {
    for (const members of [{ data: [], error: null }, { data: [{ vendor_id: 'a' }, { vendor_id: 'b' }], error: null }, { data: null, error: { code: 'x' } }]) expect(await ownVendor(fake({ members }).client)).toBeNull();
  });
});

describe('acceptVendorAgreement', () => {
  it('inserts one row for this vendor and user at the shipped version', async () => {
    const f = fake({});
    expect(await acceptVendorAgreement(f.client)).toEqual({ ok: true });
    expect(f.inserts).toEqual([{ vendor_id: 'v1', user_id: 'u1', version: VENDOR_AGREEMENT_VERSION }]);
  });
  it('treats an acceptance that already exists as done', async () => { expect(await acceptVendorAgreement(fake({ insert: { error: { code: '23505' } } }).client)).toEqual({ ok: true }); });
  it('shows a reload message when the policy refuses a stale version', async () => {
    expect(await acceptVendorAgreement(fake({ insert: { error: { code: '42501' } } }).client, '0')).toEqual({ ok: false, message: expect.stringMatching(/Reload the page/) });
  });
  it('writes nothing without a session or a membership, and says only the generic sentence on another failure', async () => {
    const none = fake({ user: false }); const lone = fake({ members: { data: [], error: null } });
    expect(await acceptVendorAgreement(none.client)).toEqual({ ok: false, message: expect.stringMatching(/Something went wrong/) });
    expect(await acceptVendorAgreement(lone.client)).toEqual({ ok: false, message: expect.stringMatching(/Something went wrong/) });
    expect([...none.inserts, ...lone.inserts]).toEqual([]);
    expect(await acceptVendorAgreement(fake({ insert: { error: { code: 'XX000' } } }).client)).toEqual({ ok: false, message: expect.stringMatching(/Something went wrong/) });
  });
});
