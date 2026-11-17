import { createAdminSupabase } from '../../../../lib/server/admin';
import { adminLimit, createSource, listSources, updateSource } from '../../../../lib/server/admin-catalog';
import { fail } from '../../../../lib/server/api';
import { dataBackend } from '../../../../lib/supabase/config';
import { createServerSupabase } from '../../../../lib/supabase/server';

/** LLD 6 `/api/admin/sources`: the source register (FR-100). Administrators only; the checks and the audit row are in lib/server/admin-catalog.ts. */
async function deps() {
  if (dataBackend() !== 'supabase') return null;
  try { const admin = createAdminSupabase(); return { caller: await createServerSupabase(), admin, limit: adminLimit(admin) }; } catch { return undefined; }
}
export async function GET(request: Request): Promise<Response> { const d = await deps(); return d === null ? new Response(null, { status: 404 }) : d ? listSources(request, d) : fail('unavailable'); }
export async function POST(request: Request): Promise<Response> { const d = await deps(); return d === null ? new Response(null, { status: 404 }) : d ? createSource(request, d) : fail('unavailable'); }
export async function PATCH(request: Request): Promise<Response> { const d = await deps(); return d === null ? new Response(null, { status: 404 }) : d ? updateSource(request, d) : fail('unavailable'); }
