import { createAdminSupabase } from '../../../../../lib/server/admin';
import { adminLimit } from '../../../../../lib/server/admin-catalog';
import { previewPilot } from '../../../../../lib/server/admin-pilot';
import { fail } from '../../../../../lib/server/api';
import { dataBackend } from '../../../../../lib/supabase/config';
import { createServerSupabase } from '../../../../../lib/supabase/server';

/** LLD 6 `/api/admin/pilot/preview`: what the end of the pilot would delete (counts only, FR-69). Administrators only; the secret-key client is built by lib/server/admin-pilot.ts, after the caller is known to be an administrator. */
async function deps() {
  if (dataBackend() !== 'supabase') return null;
  try { return { caller: await createServerSupabase(), createAdmin: createAdminSupabase, limitOf: adminLimit }; } catch { return undefined; }
}
export async function GET(request: Request): Promise<Response> { const d = await deps(); return d === null ? new Response(null, { status: 404 }) : d ? previewPilot(request, d) : fail('unavailable'); }
