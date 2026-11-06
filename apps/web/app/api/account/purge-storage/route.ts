import { createAdminSupabase } from '../../../../lib/server/admin';
import { fail } from '../../../../lib/server/api';
import { handlePurge } from '../../../../lib/server/purge';
import { dataBackend } from '../../../../lib/supabase/config';
import { createServerSupabase } from '../../../../lib/supabase/server';

/** Step 1 of leaving the pilot: removes every file of the signed-in person (LLD 6 `/api/account/delete`, storage part). The account itself is
 * deleted afterwards by the database function `app.delete_my_account()`, which this route's checks mirror. */
export async function POST(request: Request): Promise<Response> {
  if (dataBackend() !== 'supabase') return new Response(null, { status: 404 });
  let admin: ReturnType<typeof createAdminSupabase>;
  try { admin = createAdminSupabase(); } catch { return fail('unavailable'); }
  const caller = await createServerSupabase();
  return handlePurge(request, { caller, storage: admin.storage });
}
