/// <reference types="node" />
/** `local` keeps the browser-only behaviour with no sign-in; `supabase` turns on sign-in and route gating (WO-0050). */
export const dataBackend = (): 'local' | 'supabase' => (process.env.NEXT_PUBLIC_DATA_BACKEND === 'supabase' ? 'supabase' : 'local');

/** Deleting an item is refused by design when the data lives in the account (the database grants no delete on items, LLD 4.6), so the button is not shown. */
export const canDeleteItems = (): boolean => dataBackend() !== 'supabase';

/** Project URL and publishable key from apps/web/.env.local (git-ignored). The app never holds any other Supabase key. */
export function supabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/web/.env.local');
  return { url, key };
}

/**
 * WO-0130 (audit finding A13): what a production build and a production server must be told, or they refuse to start. Until this check a build
 * without NEXT_PUBLIC_DATA_BACKEND=supabase quietly ran the browser-only backend, with no sign-in at all. Returns the reason, or null when the
 * configuration can be served. The one build without sign-in is the local demo, and its script says so itself with NEXT_PUBLIC_SPARTA_DEMO_NO_LOGIN=1
 * (a NEXT_PUBLIC_ name because the configuration modules read no other kind; it holds nothing secret, and next.config.ts marks such a build with a
 * response header that the build-output test refuses in the gate's build).
 */
export type HostableEnv = { backend?: string | undefined; url?: string | undefined; key?: string | undefined; demoNoLogin?: string | undefined };
export function hostableConfigProblem(env: HostableEnv = {
  backend: process.env.NEXT_PUBLIC_DATA_BACKEND, url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  demoNoLogin: process.env.NEXT_PUBLIC_SPARTA_DEMO_NO_LOGIN,
}): string | null {
  const demo = env.demoNoLogin === '1';
  if (env.demoNoLogin !== undefined && env.demoNoLogin !== '' && !demo) return 'NEXT_PUBLIC_SPARTA_DEMO_NO_LOGIN must be 1 or unset.';
  if (env.backend === 'supabase') {
    if (demo) return 'NEXT_PUBLIC_SPARTA_DEMO_NO_LOGIN=1 says this is the local demo without sign-in, but NEXT_PUBLIC_DATA_BACKEND=supabase turns sign-in on. Set one or the other.';
    const missing = [!env.url && 'NEXT_PUBLIC_SUPABASE_URL', !env.key && 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'].filter((v): v is string => typeof v === 'string');
    return missing.length > 0 ? `Supabase is not configured: set ${missing.join(' and ')}.` : null;
  }
  if (demo) return null;
  return `This build would have no sign-in at all: NEXT_PUBLIC_DATA_BACKEND is ${env.backend === undefined || env.backend === '' ? 'not set' : `"${env.backend}"`}, and only "supabase" turns accounts on. `
    + 'Set NEXT_PUBLIC_DATA_BACKEND=supabase with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. '
    + 'The only build without sign-in is the local demo: bash workflow/demo/start-demo.sh --no-login.';
}

/** The no-login demo flag as the build environment gives it (see hostableConfigProblem). */
export const hostableDemoFlag = (): string | undefined => process.env.NEXT_PUBLIC_SPARTA_DEMO_NO_LOGIN;

/** The Supabase project's origin (scheme, host, port) from NEXT_PUBLIC_SUPABASE_URL, or null when it is unset or not an http(s) URL. */
export function supabaseOrigin(url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!url) return null;
  try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null; } catch { return null; }
}

/**
 * WO-0130 (audit finding A13): the full Content-Security-Policy of a signed-in-accounts build, made by the proxy for ONE request around that request's nonce.
 *  - script-src: 'self' plus the nonce plus 'strict-dynamic' (the scripts Next writes carry the nonce, and what they load is trusted); NO 'unsafe-inline' and no
 *    'unsafe-eval' (production Next and React need none; `next dev` with accounts may log eval warnings, because React's dev build uses eval for stack
 *    traces: the configuration modules may not read NODE_ENV, and development is not what is hosted).
 *  - connect-src: this site (Next's own data requests) and the Supabase origin (sign-in, data, storage). img-src: this site, blob: (photo previews) and the
 *    Supabase origin (signed storage URLs are served from it). Everything else falls back to default-src 'self'.
 *  - style-src keeps 'unsafe-inline': the app sets style attributes (React `style={{...}}`), which a nonce cannot cover. Inline STYLE can not run code; the
 *    residual risk is accepted and recorded in workflow/work-orders/Audit.md (WO-0130).
 *  - frame-ancestors, form-action, base-uri and object-src repeat the static header of next.config.ts, which stays as it was.
 * An unset or unreadable Supabase URL leaves the origin out (a stricter policy), never widens it.
 */
export function contentSecurityPolicy(nonce: string, supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string {
  const supabase = supabaseOrigin(supabaseUrl);
  const extra = supabase === null ? '' : ` ${supabase}`;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self'${extra}`,
    `img-src 'self' blob:${extra}`,
    "font-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
}

/** Session cookies (LLD 10): SameSite=Lax, Secure whenever the project URL is https (every hosted deployment). Not HttpOnly: the browser client reads them. */
export const cookieOptions = (url: string) => ({ sameSite: 'lax' as const, secure: url.startsWith('https:'), path: '/' });
