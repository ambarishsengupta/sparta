import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath } from '../../../lib/auth-form';
import { dataBackend } from '../../../lib/supabase/config';
import { createServerSupabase, seeOther } from '../../../lib/supabase/server';

/** Email confirmation and password-reset links land here with a one-time code, which is exchanged for a session cookie. */
export async function GET(request: NextRequest) {
  if (dataBackend() !== 'supabase') return new NextResponse(null, { status: 404 });
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  if (code) {
    const { error } = await (await createServerSupabase()).auth.exchangeCodeForSession(code);
    if (!error) {
      // The one-time PKCE verifier has done its job; do not leave it in the browser for 400 days.
      const store = await cookies();
      store.getAll().filter((c) => c.name.endsWith('-code-verifier')).forEach((c) => store.delete(c.name));
      return seeOther(safeNextPath(searchParams.get('next')));
    }
  }
  return seeOther('/sign-in?error=link');
}
