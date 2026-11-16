import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { MIN_PW_LENGTH, normaliseEmail } from '../auth-form';

/** FR-8: the refusal for an address that is not on the invitation list, word for word as the sign-up hook sends it. */
export const INVITE_ONLY_MESSAGE = 'Sparta is invitation-only during the pilot.';
const GENERIC = 'Something went wrong. Please try again in a moment.';
export type Outcome = { ok: true } | { ok: false; message: string };
type AuthClient = Pick<SupabaseClient<Database>, 'auth'>;

/** Plain-language text for an Auth error. Only the FR-8 refusal is passed through; no other server text reaches the screen. */
export function describeAuthError(e: { message?: string; code?: string; status?: number }): string {
  if (e.message === INVITE_ONLY_MESSAGE) return INVITE_ONLY_MESSAGE;
  if (e.code === 'weak_password') return `Choose a password of at least ${MIN_PW_LENGTH} characters.`;
  if (e.code === 'invalid_credentials') return 'That email and password do not match. Check them and try again.';
  if (e.code === 'email_not_confirmed') return 'Your email is not confirmed yet. Open the link in the message we sent you, then sign in.';
  if (e.status === 429 || e.code?.startsWith('over_')) return 'Too many attempts. Please wait a few minutes and try again.';
  return GENERIC;
}

const run = async (call: () => Promise<{ error: { message?: string; code?: string; status?: number } | null }>): Promise<Outcome> => {
  try { const { error } = await call(); return error ? { ok: false, message: describeAuthError(error) } : { ok: true }; } catch { return { ok: false, message: GENERIC }; }
};

/** An address that already has an account gets the same answer as a new one (the "check your email" page), so the screen does not say who has an account. */
export const signUpWithEmail = (c: AuthClient, email: string, pw: string, redirectTo: string) =>
  run(async () => {
    const { error } = await c.auth.signUp({ email: normaliseEmail(email), password: pw, options: { emailRedirectTo: redirectTo } });
    return { error: error?.code === 'user_already_exists' ? null : error };
  });
export const signInWithEmail = (c: AuthClient, email: string, pw: string) =>
  run(() => c.auth.signInWithPassword({ email: normaliseEmail(email), password: pw }));
/** Always `ok` for an address the service does not know, so the screen cannot be used to find out who has an account. */
export const requestPasswordReset = (c: AuthClient, email: string, redirectTo: string) =>
  run(() => c.auth.resetPasswordForEmail(normaliseEmail(email), { redirectTo }));
export const signOut = (c: AuthClient) => run(() => c.auth.signOut({ scope: 'local' }));
