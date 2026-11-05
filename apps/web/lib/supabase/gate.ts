/** Access gating of LLD 9.1 as pure functions. These only guide the interface; the database policies (LLD 4.5) are the enforcement. */
export type GateState =
  | 'unauthenticated' | 'needs_email_confirmation' | 'needs_documents' | 'needs_pilot_notice' | 'needs_onboarding' | 'not_available' | 'ready';
export type Decision = { action: 'allow' } | { action: 'redirect'; to: string };

/** What the session and the person's own rows say. Each flag is true when that step is done. */
export interface Facts {
  emailConfirmed: boolean; role: string; eligible: boolean;
  ageConfirmed: boolean; termsCurrent: boolean; privacyCurrent: boolean; noticeCurrent: boolean; country: string | null;
}

/** The first step still open, in the order of LLD 9.1. Anything that is not eligible for another reason (a country off the list,
 * a role other than consumer, maintenance mode) is held at not-available: this release has no vendor area or maintenance page. */
export function stateFromFacts(f: Facts): GateState {
  if (!f.emailConfirmed) return 'needs_email_confirmation';
  if (f.role !== 'consumer') return 'not_available';
  if (f.eligible) return 'ready';
  if (!f.ageConfirmed || !f.termsCurrent || !f.privacyCurrent) return 'needs_documents';
  if (!f.noticeCurrent) return 'needs_pilot_notice';
  if (f.country === null) return 'needs_onboarding';
  return 'not_available';
}

const HOME: Record<Exclude<GateState, 'unauthenticated'>, string> = {
  needs_email_confirmation: '/check-your-email', needs_documents: '/accept-terms', needs_pilot_notice: '/pilot-notice',
  needs_onboarding: '/onboarding', not_available: '/not-available', ready: '/',
};
const AUTH_PAGES = ['/sign-in', '/sign-up', '/check-your-email', '/reset'];
const GATE_PAGES = ['/accept-terms', '/pilot-notice', '/onboarding', '/not-available'];
const PUBLIC_PAGES = ['/about', '/privacy', '/terms', '/notice', '/maintenance'];
const PUBLIC = [...PUBLIC_PAGES, '/auth/callback', '/auth/sign-out'];
/** Reachable while held at a gate step (LLD 9.1): export my data and Leave the pilot. */
const HELD_API = ['/api/account/export', '/api/exports', '/api/account/delete'];
const INVALID = '/__invalid__';

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

/** Pages and the sign-out post that need no session check. The proxy decides these before it calls the session updater, so they still
 * work while the account service is down (LLD 9.1: privacy and terms are public; signing out must always be possible). */
export function needsNoSession(method: string, rawPath: string): boolean {
  const path = normalisePath(rawPath);
  return PUBLIC_PAGES.includes(path) || (method === 'POST' && path === '/auth/sign-out');
}

export function decideRoute(state: GateState, rawPath: string): Decision {
  const path = normalisePath(rawPath);
  if (PUBLIC.includes(path)) return ALLOW;
  if (state === 'unauthenticated') {
    if (AUTH_PAGES.includes(path)) return ALLOW;
    // The sign-in page sends the person back to the page they asked for, query string included; the value is encoded as one parameter.
    return redirect(path === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(path + (path === INVALID ? '' : searchOf(rawPath)))}`);
  }
  if (state === 'ready') return AUTH_PAGES.includes(path) || GATE_PAGES.includes(path) ? redirect('/') : ALLOW;
  const heldApi = state !== 'needs_email_confirmation' && HELD_API.some((p) => path === p || path.startsWith(`${p}/`));
  return path === HOME[state] || heldApi ? ALLOW : redirect(HOME[state]);
}
