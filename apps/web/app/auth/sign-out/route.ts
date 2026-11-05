import { NextResponse } from 'next/server';
import { dataBackend } from '../../../lib/supabase/config';
import { createServerSupabase, seeOther } from '../../../lib/supabase/server';

/** POST only: ends this device's session and clears its cookies. A link or an image cannot sign anyone out (GET is not defined). */
export async function POST() {
  if (dataBackend() !== 'supabase') return new NextResponse(null, { status: 404 });
  await (await createServerSupabase()).auth.signOut({ scope: 'local' });
  return seeOther('/sign-in');
}
