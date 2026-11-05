/** Sign-up, sign-in and reset form rules. The server enforces the same password length (supabase/config.toml minimum_password_length). */
export const MIN_PW_LENGTH = 10;
export type AuthMode = 'sign-up' | 'sign-in' | 'reset';
export type AuthErrors = { email?: string; pw?: string };

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field errors for a form; an empty object means the form may be sent. Sign-in only asks for a password, so older accounts are never locked out by a length rule. */
export function validateAuth(mode: AuthMode, email: string, pw: string): AuthErrors {
  const errors: AuthErrors = {};
  const address = normaliseEmail(email);
  if (address === '') errors.email = 'Enter your email address.';
  else if (!EMAIL.test(address)) errors.email = 'Enter a valid email address, like name@example.com.';
  if (mode === 'sign-up' && [...pw].length < MIN_PW_LENGTH) errors.pw = `Choose a password of at least ${MIN_PW_LENGTH} characters.`;
  if (mode === 'sign-in' && pw === '') errors.pw = 'Enter your password.';
  return errors;
}

const unsafeChar = (c: string): boolean => c === '\\' || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f;
/** A same-site path to go to after sign-in or confirmation; anything else becomes the home page. The answer never starts with two slashes
 * (a browser reads `//host` as another site), never holds a backslash or a control character, and always keeps the origin of the placeholder. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next?.startsWith('/') || [...next].some(unsafeChar)) return '/';
  const base = 'http://sparta.invalid';
  try {
    const u = new URL(next, base);
    const out = u.pathname + u.search;
    return u.origin === base && !out.startsWith('//') ? out : '/';
  } catch { return '/'; }
}

/** The one place the sign-in form leaves the page: a full navigation to the checked path, so the new cookies are sent with the request. */
export const finishSignIn = (next: string | null | undefined, assign: (to: string) => void): void => assign(safeNextPath(next));
