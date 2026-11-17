import { createAdminSupabase } from '../../../../../../lib/server/admin';
import { adminLimit, takeDownSource } from '../../../../../../lib/server/admin-catalog';
import { fail } from '../../../../../../lib/server/api';
import { dataBackend } from '../../../../../../lib/supabase/config';
import { createServerSupabase } from '../../../../../../lib/supabase/server';

/** LLD 6 `/api/admin/sources/[id]/takedown`: FR-103 in one call (items deleted, source row kept with `allowed = false`). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (dataBackend() !== 'supabase') return new Response(null, { status: 404 });
  try { const admin = createAdminSupabase(); return await takeDownSource(request, { caller: await createServerSupabase(), admin, limit: adminLimit(admin) }, (await ctx.params).id); } catch { return fail('unavailable'); }
}
