import { NextRequest, NextResponse } from 'next/server';
import { contentSecurityPolicy, dataBackend } from './lib/supabase/config';
import { decideRoute, needsNoSession } from './lib/supabase/gate';
import { updateSession } from './lib/supabase/proxy-session';

/** A fresh nonce for ONE request: 16 random bytes, base64 (128 bits; a nonce must be unpredictable and never reused). */
function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Auth, consent and onboarding gating (LLD 9.1; `middleware.ts` before Next 16), and the Content-Security-Policy with a per-request script nonce (WO-0130).
 * With the local backend it does nothing: that build is the no-login demo, whose pages are prerendered, and a page made at build time can carry no nonce.
 * A build with accounts renders every page on request (the root layout reads the session), so the nonce works there.
 *
 * How Next gets the nonce (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md, "How nonces work in Next.js"): while rendering, Next reads the
 * `Content-Security-Policy` header of the REQUEST it is handed, takes the value of the `'nonce-...'` source out of it, and puts that nonce on its own scripts.
 * So the policy is set on the forwarded request headers (with `x-nonce`, for code that needs the value) and, as the one the browser enforces, on the response.
 */
export async function proxy(request: NextRequest) {
  if (dataBackend() !== 'supabase') return NextResponse.next();
  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce);
  // Whatever the client sent under these names is replaced, never trusted.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set('x-nonce', nonce);
  forwardedHeaders.set('content-security-policy', policy);
  const withPolicy = <T extends NextResponse>(response: T): T => { response.headers.set('Content-Security-Policy', policy); return response; };

  // Decided before the session updater is called, so the public pages and signing out still work while the account service is down.
  if (needsNoSession(request.method, request.nextUrl.pathname)) return withPolicy(NextResponse.next({ request: { headers: forwardedHeaders } }));
  try {
    const { response, state } = await updateSession(new NextRequest(request, { headers: forwardedHeaders }));
    const decision = decideRoute(state, request.nextUrl.pathname + request.nextUrl.search);
    if (decision.action === 'allow') return withPolicy(response);
    const target = new URL(decision.to, request.nextUrl.origin);
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return withPolicy(redirect);
  } catch {
    // The service could not be reached: refuse rather than guess (fail closed). No details leave the server.
    return withPolicy(new NextResponse('Sparta cannot check your account right now. Please try again in a moment.', { status: 503 }));
  }
}

// Static files are served without a check; every page, route handler and data request goes through the proxy.
export const config = {
  matcher: ['/((?!(?:_next/static|_next/image)(?:/|$)|(?:icon\\.svg|manifest\\.webmanifest|pairing-prior-v1\\.json|unlock-candidates\\.json)$).*)'],
};
