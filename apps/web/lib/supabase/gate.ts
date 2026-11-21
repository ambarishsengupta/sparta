/** Access gating of LLD 9.1 as pure functions. These only guide the interface; the database policies (LLD 4.5) are the enforcement. */
export type GateState =
  | 'unauthenticated' | 'needs_email_confirmation' | 'needs_documents' | 'needs_pilot_notice' | 'needs_onboarding' | 'not_available' | 'admin' | 'needs_vendor_agreement' | 'vendor' | 'ready';
export type Decision = { action: 'allow' } | { action: 'redirect'; to: string };

/** What the session and the person's own rows say. Each flag is true when that step is done. */
export interface Facts {
  emailConfirmed: boolean; role: string; eligible: boolean;
  ageConfirmed: boolean; termsCurrent: boolean; privacyCurrent: boolean; noticeCurrent: boolean; country: string | null;
  /** WO-0103, role `vendor` only: exactly one membership (the vendor functions refuse zero or several) and the current agreement accepted. Absent means no membership. */
  vendor?: { member: boolean; agreed: boolean };
}

/** The first step still open, in the order of LLD 9.1. Anything that is not eligible for another reason (a country off the list,
 * a role other than consumer, maintenance mode) is held at not-available: this release has no vendor area or maintenance page. */
export function stateFromFacts(f: Facts): GateState {
  if (!f.emailConfirmed) return 'needs_email_confirmation';
  if (f.role === 'admin') return 'admin';   // WO-0088: the catalogue admin page; the routes behind it check the role again in the database
  if (f.role === 'vendor') return !f.vendor?.member ? 'not_available' : f.vendor.agreed ? 'vendor' : 'needs_vendor_agreement';   // LLD 9.1 steps 6 and 7
  if (f.role !== 'consumer') return 'not_available';
  if (f.eligible) return 'ready';
  if (!f.ageConfirmed || !f.termsCurrent || !f.privacyCurrent) return 'needs_documents';
  if (!f.noticeCurrent) return 'needs_pilot_notice';
  if (f.country === null) return 'needs_onboarding';
  return 'not_available';
}

const HOME: Record<Exclude<GateState, 'unauthenticated'>, string> = {
  needs_email_confirmation: '/check-your-email', needs_documents: '/accept-terms', needs_pilot_notice: '/pilot-notice',
  needs_onboarding: '/onboarding', not_available: '/not-available', admin: '/admin/catalog', needs_vendor_agreement: '/vendor/agreement', vendor: '/vendor', ready: '/',
};
const AUTH_PAGES = ['/sign-in', '/sign-up', '/check-your-email', '/reset'];
const GATE_PAGES = ['/accept-terms', '/pilot-notice', '/onboarding', '/not-available'];
const PUBLIC_PAGES = ['/about', '/privacy', '/terms', '/notice', '/maintenance', '/goodbye'];
const PUBLIC = [...PUBLIC_PAGES, '/auth/callback', '/auth/sign-out'];
/** Reachable while held at a gate step (LLD 9.1): export my data and Leave the pilot. */
const HELD_API = ['/api/account/export', '/api/exports', '/api/account/delete', '/api/account/purge-storage'];
/** The one account page a held person may open: the confirmation step of Leave the pilot (FR-4, FR-66). Export is a button, not a page. */
const HELD_PAGES = ['/leave'];
const INVALID = '/__invalid__';
/** WO-0088: the admin routes answer 401 or 403 themselves in every state (an API client cannot follow a redirect to a sign-in page); the admin page belongs to the admin state only. */
const ADMIN_API = '/api/admin';
const ADMIN_PAGES = ['/admin/catalog', '/admin/pilot'];   // WO-0173: the end-of-pilot page is an admin page like the catalogue
/** WO-0103: the vendor portal. A vendor without the current agreement can open only its agreement page; a vendor with it lives under /vendor; no one else gets in. */
const isVendorPath = (path: string): boolean => path === '/vendor' || path.startsWith('/vendor/');

/** A request path read against a placeholder host that is never contacted (the one URL literal in this file). */
const asUrl = (raw: string): URL => new URL(`http://sparta.invalid${raw.startsWith('/') ? '' : '/'}${raw}`);

/** A request path as the router will see it: decoded once, with dot segments resolved. Anything odd becomes a path no rule matches. */
export function normalisePath(raw: string): string {
  let p: string;
  try { p = decodeURIComponent(asUrl(raw).pathname); } catch { return INVALID; }
  if (/[\\?#]|\/\.\.?(\/|$)|\/\//.test(p)) return INVALID;
  return p.length > 1 ? p.replace(/\/$/, '') : p;
}

const redirect = (to: string): Decision => ({ action: 'redirect', to });
const ALLOW: Decision = { action: 'allow' };

/** The query string of a request path (with its leading `?`), or an empty string. */
const searchOf = (raw: string): string => { try { return asUrl(raw).search; } catch { return ''; } };

/** The route the Python worker calls with a bearer token instead of a session cookie (LLD 6, 7.1). It answers 401 itself without the token. */
const WORKER_API = '/api/worker/signed-urls';

/** Pages and the sign-out post that need no session check. The proxy decides these before it calls the session updater, so they still
 * work while the account service is down (LLD 9.1: privacy and terms are public; signing out must always be possible). */
export function needsNoSession(method: string, rawPath: string): boolean {
  const path = normalisePath(rawPath);
  return PUBLIC_PAGES.includes(path) || (method === 'POST' && path === '/auth/sign-out') || path === WORKER_API;
}

export function decideRoute(state: GateState, rawPath: string): Decision {
  const path = normalisePath(rawPath);
  if (PUBLIC.includes(path) || path === ADMIN_API || path.startsWith(`${ADMIN_API}/`)) return ALLOW;
  if (state === 'unauthenticated') {
    if (AUTH_PAGES.includes(path)) return ALLOW;
    // The sign-in page sends the person back to the page they asked for, query string included; the value is encoded as one parameter.
    return redirect(path === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(path + (path === INVALID ? '' : searchOf(rawPath)))}`);
  }
  if (state === 'ready') return AUTH_PAGES.includes(path) || GATE_PAGES.includes(path) || ADMIN_PAGES.includes(path) || isVendorPath(path) ? redirect('/') : ALLOW;
  if (state === 'admin' && ADMIN_PAGES.includes(path)) return ALLOW;   // WO-0173: every admin page is open to the admin state (before, only the home page /admin/catalog was)
  if (state === 'vendor') return isVendorPath(path) && path !== HOME.needs_vendor_agreement ? ALLOW : redirect(HOME.vendor);
  const held = state !== 'needs_email_confirmation' && state !== 'needs_vendor_agreement' && (HELD_PAGES.includes(path) || HELD_API.some((p) => path === p || path.startsWith(`${p}/`)));
  return path === HOME[state] || held ? ALLOW : redirect(HOME[state]);
}
