import { createAdminSupabase } from '../../../../../lib/server/admin';
import { adminLimit } from '../../../../../lib/server/admin-catalog';
import { endPilot } from '../../../../../lib/server/admin-pilot';
import { fail } from '../../../../../lib/server/api';
import { dataBackend } from '../../../../../lib/supabase/config';
import { createServerSupabase } from '../../../../../lib/supabase/server';

/** LLD 6 `/api/admin/pilot/end`: runs the end of the pilot in batches (FR-69); needs the body {"confirm":"END"}; callable again until done. Administrators only; the secret-key client is built by lib/server/admin-pilot.ts, after the caller is known to be an administrator. */
async function deps() {
  if (dataBackend() !== 'supabase') return null;
  try { return { caller: await createServerSupabase(), createAdmin: createAdminSupabase, limitOf: adminLimit }; } catch { return undefined; }
}
export async function POST(request: Request): Promise<Response> { const d = await deps(); return d === null ? new Response(null, { status: 404 }) : d ? endPilot(request, d) : fail('unavailable'); }
