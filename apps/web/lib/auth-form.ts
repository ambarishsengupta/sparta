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

/** A same-site path to go to after sign-in; anything else (another site, a scheme, a backslash trick) becomes the home page. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next?.startsWith('/')) return '/';
  const base = 'http://sparta.invalid';
  try { const u = new URL(next, base); return u.origin === base ? u.pathname + u.search : '/'; } catch { return '/'; }
}
