import { createAdminSupabase } from '../../../../lib/server/admin';
import { fail } from '../../../../lib/server/api';
import { limitedPurge, PURGE_BRAKE, PURGE_LIMIT } from '../../../../lib/server/purge';
import { makeLimiter, rateRpcOf, routeLimit } from '../../../../lib/server/limits';
import { dataBackend } from '../../../../lib/supabase/config';
import { createServerSupabase } from '../../../../lib/supabase/server';

const brake = makeLimiter(PURGE_BRAKE.max, PURGE_BRAKE.windowMs);   // per process, first; the shared count is in handlePurge (WO-0130)

/** Step 1 of leaving the pilot: removes every file of the signed-in person (LLD 6 `/api/account/delete`, storage part). The account itself is
 * deleted afterwards by the database function `app.delete_my_account()`, which this route's checks mirror. */
export async function POST(request: Request): Promise<Response> {
  if (dataBackend() !== 'supabase') return new Response(null, { status: 404 });
  let admin: ReturnType<typeof createAdminSupabase>;
  try { admin = createAdminSupabase(); } catch { return fail('unavailable'); }
  const handlePurge = limitedPurge(routeLimit(brake, rateRpcOf(admin), PURGE_LIMIT));   // WO-0130: the per-process brake first, then the shared count; fail closed
  const caller = await createServerSupabase();
  return handlePurge(request, { caller, storage: admin.storage });
}
