'use client';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { validateAcceptance, type AcceptanceErrors } from '../../lib/consent-form';
import { createBrowserSupabase } from '../../lib/supabase/browser';
import { acceptDocuments, type Versions } from '../../lib/supabase/consent-actions';

/** FR-2 and FR-68: the 18-or-over tick and the Terms and Privacy Policy tick on one screen. The versions shown are the ones sent. */
export function AcceptTermsForm({ versions }: { versions: Pick<Versions, 'terms' | 'privacy'> }) {
  const [age, setAge] = useState(false);
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<AcceptanceErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ageRef = useRef<HTMLInputElement>(null);
  const agreeRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    const found = validateAcceptance(age, agree);
    setErrors(found);
    if (found.age) return ageRef.current?.focus();
    if (found.agree) return agreeRef.current?.focus();
    setBusy(true);
    const out = await acceptDocuments(createBrowserSupabase(), versions, age);
    if (out.ok) return window.location.assign('/'); // the proxy sends the person to the next step
    setBusy(false);
    setFailure(out.message);
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <h1>Before you start</h1>
      <p>Read the documents, then tick both boxes. They open in a new tab:
        {' '}<Link href="/terms" target="_blank" rel="noopener">Terms of Use (version {versions.terms})</Link>{' and '}
        <Link href="/privacy" target="_blank" rel="noopener">Privacy Policy (version {versions.privacy})</Link>.</p>
      <label className="check" htmlFor="accept-age">
        <input id="accept-age" ref={ageRef} type="checkbox" checked={age} onChange={(e) => { setAge(e.target.checked); setErrors({ ...errors, age: undefined }); }}
          aria-invalid={errors.age ? true : undefined} aria-describedby={errors.age ? 'accept-age-error' : undefined} />
        I am 18 or over.
      </label>
      {errors.age && <p id="accept-age-error" className="error" role="alert">{errors.age}</p>}
      <label className="check" htmlFor="accept-agree">
        <input id="accept-agree" ref={agreeRef} type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); setErrors({ ...errors, agree: undefined }); }}
          aria-invalid={errors.agree ? true : undefined} aria-describedby={errors.agree ? 'accept-agree-error' : undefined} />
        I agree to the Terms of Use and the Privacy Policy.
      </label>
      {errors.agree && <p id="accept-agree-error" className="error" role="alert">{errors.agree}</p>}
      {failure && <p className="error" role="alert">{failure}</p>}
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Please wait' : 'Continue'}</button>
    </form>
  );
}
