import { describe, expect, it, vi } from 'vitest';
import { describeAuthError, INVITE_ONLY_MESSAGE, requestPasswordReset, signInWithEmail, signOut, signUpWithEmail } from './auth-actions';

const never = 'Something went wrong. Please try again in a moment.';
describe('describeAuthError: sign-up and sign-in error handling', () => {
  it('passes the FR-8 refusal through word for word', () => {
    expect(INVITE_ONLY_MESSAGE).toBe('Sparta is invitation-only during the pilot.');
    expect(describeAuthError({ message: INVITE_ONLY_MESSAGE, status: 403, code: 'unknown' })).toBe('Sparta is invitation-only during the pilot.');
  });
  it('does not pass any other server text to the screen', () => {
    expect(describeAuthError({ message: 'duplicate key value violates unique constraint "users_pkey"', status: 500 })).toBe(never);
    expect(describeAuthError({ message: 'Sparta is invitation-only during the pilot. Extra', status: 403 })).toBe(never);
  });
  it('explains a short password with the minimum', () => { expect(describeAuthError({ code: 'weak_password', message: 'x' })).toMatch(/at least 10 characters/); });
  it('explains wrong credentials without saying which part was wrong', () => {
    expect(describeAuthError({ code: 'invalid_credentials' })).toBe('That email and password do not match. Check them and try again.');
  });
  it('tells an unconfirmed user to open the email link', () => { expect(describeAuthError({ code: 'email_not_confirmed' })).toMatch(/not confirmed yet/); });
  it.each([[{ status: 429 }], [{ code: 'over_email_send_rate_limit' }], [{ code: 'over_request_rate_limit', status: 429 }]])('names rate limits: %j', (e) => {
    expect(describeAuthError(e)).toMatch(/Too many attempts/);
  });
  it('falls back to a generic line', () => { expect(describeAuthError({})).toBe(never); });
});

const okClient = () => {
  const auth = {
    signUp: vi.fn(async () => ({ error: null })), signInWithPassword: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })), signOut: vi.fn(async () => ({ error: null })),
  };
  return { auth: auth as never, mock: auth };
};
describe('the auth actions', () => {
  it('sign-up sends the trimmed lower-case email, the password and the callback URL', async () => {
    const { auth, mock } = okClient();
    const chosen = 'a-long-enough-one';
    expect(await signUpWithEmail({ auth }, ' Ann@Example.com ', chosen, 'http://x/auth/callback')).toEqual({ ok: true });
    const arg = mock.signUp.mock.calls[0] as unknown as [{ email: string; password: string; options: { emailRedirectTo: string } }];
    expect(arg[0].email).toBe('ann@example.com');
    expect(arg[0].password).toBe(chosen);
    expect(arg[0].options.emailRedirectTo).toBe('http://x/auth/callback');
  });
  it('sign-up turns the invitation refusal into a failed outcome with the FR-8 message', async () => {
    const auth = { signUp: async () => ({ error: { message: INVITE_ONLY_MESSAGE, status: 403, code: 'unknown' } }) } as never;
    expect(await signUpWithEmail({ auth }, 'a@b.co', 'x'.repeat(12), 'u')).toEqual({ ok: false, message: INVITE_ONLY_MESSAGE });
  });
  it('a thrown network failure becomes a failed outcome, not an exception', async () => {
    const auth = { signInWithPassword: async () => { throw new TypeError('fetch failed'); } } as never;
    expect(await signInWithEmail({ auth }, 'a@b.co', 'x')).toEqual({ ok: false, message: never });
  });
  it('sign-in reports wrong credentials', async () => {
    const auth = { signInWithPassword: async () => ({ error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 } }) } as never;
    const out = await signInWithEmail({ auth }, 'a@b.co', 'x');
    expect(out.ok).toBe(false);
    expect(out.ok ? '' : out.message).not.toContain('Invalid login credentials');
  });
  it('reset and sign-out call the matching Auth method; sign-out is local to this device', async () => {
    const { auth, mock } = okClient();
    expect(await requestPasswordReset({ auth }, 'A@B.co', 'u')).toEqual({ ok: true });
    expect(mock.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co', { redirectTo: 'u' });
    expect(await signOut({ auth })).toEqual({ ok: true });
    expect(mock.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('sign-up of an address that already has an account (m5)', () => {
  it('gets the same neutral answer as a new sign-up, so the screen does not say who has an account', async () => {
    const auth = { signUp: async () => ({ error: { message: 'User already registered', status: 422, code: 'user_already_exists' } }) } as never;
    expect(await signUpWithEmail({ auth }, 'a@b.co', 'x'.repeat(12), 'u')).toEqual({ ok: true });
  });
  it('only that one code is neutral: the invitation refusal, a weak password and a rate limit still say what they are', async () => {
    const fail = (error: object) => signUpWithEmail({ auth: { signUp: async () => ({ error }) } as never }, 'a@b.co', 'x'.repeat(12), 'u');
    expect(await fail({ message: INVITE_ONLY_MESSAGE, status: 403, code: 'unexpected_failure' })).toEqual({ ok: false, message: INVITE_ONLY_MESSAGE });
    expect((await fail({ code: 'weak_password', message: 'x', status: 422 })).ok).toBe(false);
    expect((await fail({ code: 'over_email_send_rate_limit', message: 'x', status: 429 })).ok).toBe(false);
    expect((await fail({ code: 'email_exists', message: 'x', status: 422 })).ok).toBe(false);
  });
  it('the other actions are not affected: a sign-in or reset error with that code is still an error', async () => {
    const auth = { signInWithPassword: async () => ({ error: { code: 'user_already_exists', message: 'x', status: 422 } }) } as never;
    expect((await signInWithEmail({ auth }, 'a@b.co', 'x')).ok).toBe(false);
  });
});
