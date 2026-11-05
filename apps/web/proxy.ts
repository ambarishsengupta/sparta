import { NextResponse, type NextRequest } from 'next/server';
import { dataBackend } from './lib/supabase/config';
import { decideRoute } from './lib/supabase/gate';
import { updateSession } from './lib/supabase/proxy-session';

/** Auth, consent and onboarding gating (LLD 9.1; `middleware.ts` before Next 16). With the local backend it does nothing. */
export async function proxy(request: NextRequest) {
  if (dataBackend() !== 'supabase') return NextResponse.next();
  try {
    const { response, state } = await updateSession(request);
    const decision = decideRoute(state, request.nextUrl.pathname);
    if (decision.action === 'allow') return response;
    const target = new URL(decision.to, request.nextUrl.origin);
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  } catch {
    // The service could not be reached: refuse rather than guess (fail closed). No details leave the server.
    return new NextResponse('Sparta cannot check your account right now. Please try again in a moment.', { status: 503 });
  }
}

// Static files are served without a check; every page, route handler and data request goes through the proxy.
export const config = {
  matcher: ['/((?!_next/static|_next/image|icon\\.svg|manifest\\.webmanifest|pairing-prior-v1\\.json|unlock-candidates\\.json).*)'],
};
