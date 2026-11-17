import type { createBrowserSupabase } from '../supabase/browser';

/** Shipped with the build and equal to `ops.settings.current_vendor_agreement_version` (LLD 12.3); the database policy refuses an acceptance at any other version. */
export const VENDOR_AGREEMENT_VERSION = '1';
type Client = Pick<ReturnType<typeof createBrowserSupabase>, 'auth' | 'schema'>;
export type Step = { ok: true } | { ok: false; message: string };
const GENERIC = 'Something went wrong. Please try again in a moment.';
const RELOAD = 'The agreement was updated while you were reading it. Reload the page to see the latest version, then try again.';

/** The caller's own vendor: its id (exactly one membership, as the vendor functions require) and its name when the account may read it (null otherwise). */
export async function ownVendor(client: Client): Promise<{ id: string; name: string | null } | null> {
  try {
    const members = await client.schema('catalog').from('vendor_members').select('vendor_id');
    if (members.error || members.data?.length !== 1) return null;
    const id = String(members.data[0]!.vendor_id);
    const vendor = await client.schema('catalog').from('vendors').select('name').eq('id', id).maybeSingle();
    return { id, name: vendor.error ? null : ((vendor.data?.name as string | undefined) ?? null) };
  } catch { return null; }
}

/** FR-94: records that this vendor user accepted the agreement version they were shown. A version that is no longer current is refused by the insert policy. */
export async function acceptVendorAgreement(client: Client, shown: string = VENDOR_AGREEMENT_VERSION): Promise<Step> {
  try {
    const { data } = await client.auth.getUser();
    const vendor = await ownVendor(client);
    if (!data.user || !vendor) return { ok: false, message: GENERIC };
    const { error } = await client.schema('catalog').from('vendor_agreement_acceptances').insert({ vendor_id: vendor.id, user_id: data.user.id, version: shown });
    if (!error || error.code === '23505') return { ok: true }; // 23505: this version was already accepted; nothing to add
    return { ok: false, message: error.code === '42501' ? RELOAD : GENERIC };
  } catch { return { ok: false, message: GENERIC }; }
}
