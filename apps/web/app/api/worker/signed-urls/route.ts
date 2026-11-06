import { createAdminSupabase } from '../../../../lib/server/admin';
import { fail } from '../../../../lib/server/api';
import { makeLimiter } from '../../../../lib/server/limits';
import { handleSignedUrls, type JobRow } from '../../../../lib/server/signed-urls';

/** LLD 6: the worker's signed URLs. Authorised by `Authorization: Bearer <WORKER_API_TOKEN>` (server environment), not by a session cookie
 * (the proxy lets this path through without one). Only POST is defined, so any other method gets Next's own 405. */
const allow = makeLimiter(120, 60_000);

export async function POST(request: Request): Promise<Response> {
  let admin: ReturnType<typeof createAdminSupabase>;
  try { admin = createAdminSupabase(); } catch { return fail('unavailable'); }
  return handleSignedUrls(request, {
    bearer: process.env.WORKER_API_TOKEN,
    allow,
    storage: admin.storage,
    lookupJob: async (id): Promise<JobRow | null> => {
      const r = await admin.schema('app').from('jobs').select('id, user_id, type, status, input').eq('id', id).maybeSingle();
      if (r.error) throw new Error('lookup failed');
      return (r.data as JobRow | null) ?? null;
    },
  });
}
