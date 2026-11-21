import { createAdminSupabase } from '../../../../lib/server/admin';
import { fail } from '../../../../lib/server/api';
import { handleItemDelete, ITEM_DELETE_BRAKE, ITEM_DELETE_LIMIT, type ItemPaths } from '../../../../lib/server/item-delete';
import { makeLimiter, rateRpcOf, routeLimit } from '../../../../lib/server/limits';
import { dataBackend } from '../../../../lib/supabase/config';
import { createServerSupabase } from '../../../../lib/supabase/server';

const brake = makeLimiter(ITEM_DELETE_BRAKE.max, ITEM_DELETE_BRAKE.windowMs);   // per process, first; the shared count is in handleItemDelete (as purge-storage, WO-0130)

/** LLD 6 `/api/items/[id]` DELETE (FR-16, WO-0183): the item is read with the caller's session, its two files are removed with the secret-key storage, then the row is deleted with the secret-key client. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (dataBackend() !== 'supabase') return new Response(null, { status: 404 });
  let admin: ReturnType<typeof createAdminSupabase>;
  try { admin = createAdminSupabase(); } catch { return fail('unavailable'); }
  const caller = await createServerSupabase();
  const { id } = await ctx.params;
  return handleItemDelete(request, id, {
    getUser: () => caller.auth.getUser(),
    readItem: async (itemId) => {
      const r = await caller.schema('app').from('items').select('image_path, image_thumb_path').eq('id', itemId).maybeSingle();
      return { data: r.data as ItemPaths | null, error: r.error };
    },
    storage: admin.storage,
    deleteRow: async (itemId, uid) => {
      const r = await admin.schema('app').from('items').delete().eq('id', itemId).eq('user_id', uid).select('id');
      return { data: r.data, error: r.error };
    },
    limit: routeLimit(brake, rateRpcOf(admin), ITEM_DELETE_LIMIT),   // the per-process brake first, then the shared count; fail closed
  });
}
