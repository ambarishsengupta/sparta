'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { MIN_PW_LENGTH, finishSignIn, validateAuth, type AuthErrors, type AuthMode } from '../../lib/auth-form';
import { requestPasswordReset, signInWithEmail, signUpWithEmail, type Outcome } from '../../lib/supabase/auth-actions';
import { createBrowserSupabase } from '../../lib/supabase/browser';

const COPY = {
  'sign-up': { title: 'Create your account', button: 'Create account' },
  'sign-in': { title: 'Sign in', button: 'Sign in' },
  reset: { title: 'Reset your password', button: 'Send reset link' },
} as const;

const PW_AUTOCOMPLETE = { 'sign-up': 'new-password', 'sign-in': 'current-password' } as const;

/** One form for sign-up, sign-in and password reset. Errors sit next to their field and are announced (role="alert"). */
export function AuthForm({ mode, next, notice }: { mode: AuthMode; next?: string; notice?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [errors, setErrors] = useState<AuthErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    const found = validateAuth(mode, email, pw);
    setErrors(found);
    if (found.email) return emailRef.current?.focus();
    if (found.pw) return pwRef.current?.focus();
    setBusy(true);
    const client = createBrowserSupabase();
    const back = `${window.location.origin}/auth/callback`;
    let out: Outcome;
    if (mode === 'sign-up') out = await signUpWithEmail(client, email, pw, back);
    else if (mode === 'sign-in') out = await signInWithEmail(client, email, pw);
    else out = await requestPasswordReset(client, email, back);
    setBusy(false);
    if (!out.ok) return setFailure(out.message);
    if (mode === 'sign-up') router.replace('/check-your-email');
    else if (mode === 'sign-in') finishSignIn(next, (to) => window.location.assign(to));
    else setSent(true);
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <h1>{COPY[mode].title}</h1>
      {notice && <p role="status">{notice}</p>}
      <label htmlFor="auth-email">Email address</label>
      <input id="auth-email" ref={emailRef} type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
        aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? 'auth-email-error' : undefined} />
      {errors.email && <p id="auth-email-error" className="error" role="alert">{errors.email}</p>}
      {mode !== 'reset' && (
        <>
          <label htmlFor="auth-pw">Password</label>
          <input id="auth-pw" ref={pwRef} type="password" name="password" autoComplete={PW_AUTOCOMPLETE[mode]} required
            value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={errors.pw ? true : undefined}
            aria-describedby={[mode === 'sign-up' ? 'auth-pw-hint' : '', errors.pw ? 'auth-pw-error' : ''].filter(Boolean).join(' ') || undefined} />
          {mode === 'sign-up' && <p id="auth-pw-hint" className="muted">At least {MIN_PW_LENGTH} characters.</p>}
          {errors.pw && <p id="auth-pw-error" className="error" role="alert">{errors.pw}</p>}
        </>
      )}
      {failure && <p className="error" role="alert">{failure}</p>}
      {sent && <p role="status">If that address has an account, a reset link is on its way. It may take a minute.</p>}
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Please wait' : COPY[mode].button}</button>
      <p>
        {mode === 'sign-in' && <><Link href="/sign-up">Create an account</Link> · <Link href="/reset">Forgot your password?</Link></>}
        {mode !== 'sign-in' && <Link href="/sign-in">Back to sign in</Link>}
      </p>
    </form>
  );
}
