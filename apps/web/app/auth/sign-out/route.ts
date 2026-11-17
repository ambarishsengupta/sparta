import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { signOut } from '../../../lib/supabase/auth-actions';
import { dataBackend } from '../../../lib/supabase/config';
import { createServerSupabase, seeOther } from '../../../lib/supabase/server';

/** POST only: ends this device's session and clears its cookies. A link or an image cannot sign anyone out (GET is not defined). */
export async function POST() {
  if (dataBackend() !== 'supabase') return new NextResponse(null, { status: 404 });
  await signOut(await createServerSupabase());
  // If the account service could not be reached, the call above leaves the cookies in place. This device is signed out either way.
  const store = await cookies();
  store.getAll().filter((c) => c.name.startsWith('sb-')).forEach((c) => store.delete(c.name));
  return seeOther('/sign-in');
}
