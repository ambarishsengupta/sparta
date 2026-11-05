'use client';
import { OCCASIONS } from '@sparta/taxonomy';
import { useRef, useState, type FormEvent } from 'react';
import { countryCode, currencyFor, hemisphereFor, OTHER_COUNTRY, validateOnboarding, type OnboardingErrors, type Option } from '../../lib/onboarding';
import { createBrowserSupabase } from '../../lib/supabase/browser';
import { completeOnboarding } from '../../lib/supabase/consent-actions';

const err = (id: string, text?: string) => text && <p id={id} className="error" role="alert">{text}</p>;

/** FR-6 and FR-9: country (the pilot's list, or any other two-letter code), hemisphere, currency and, optionally, occasions. */
export function OnboardingForm({ countries, currencies }: { countries: Option[]; currencies: Option[] }) {
  const [choice, setChoice] = useState('');
  const [typed, setTyped] = useState('');
  const [hemisphere, setHemisphere] = useState('');
  const [currency, setCurrency] = useState('');
  const [occasions, setOccasions] = useState<string[]>([]);
  const [errors, setErrors] = useState<OnboardingErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = { country: useRef<HTMLSelectElement>(null), typed: useRef<HTMLInputElement>(null), hemisphere: useRef<HTMLSelectElement>(null), currency: useRef<HTMLSelectElement>(null) };
  const country = countryCode(choice, typed);
  const outside = choice === OTHER_COUNTRY;

  /** Changing the country pre-fills hemisphere and currency; both stay editable (FR-6). */
  function chooseCountry(value: string, code: string) {
    setChoice(value);
    setErrors({ ...errors, country: undefined });
    if (/^[A-Z]{2}$/.test(code)) { setHemisphere(hemisphereFor(code)); setCurrency(currencyFor(code)); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    const found = validateOnboarding({ country, hemisphere, currency }, choice);
    setErrors(found);
    const first = found.country ? (outside ? refs.typed : refs.country) : found.hemisphere ? refs.hemisphere : found.currency ? refs.currency : null;
    if (first) return first.current?.focus();
    setBusy(true);
    const out = await completeOnboarding(createBrowserSupabase(), { country, hemisphere, currency, occasions });
    if (out.ok) return window.location.assign('/'); // the proxy sends the person to the app, or to the not-available page
    setBusy(false);
    setFailure(out.message);
  }
  const bad = (m?: string, id?: string) => ({ 'aria-invalid': m ? true : undefined, 'aria-describedby': m ? id : undefined });

  return (
    <form className="form" onSubmit={submit} noValidate>
      <h1>A few questions</h1>
      <label htmlFor="ob-country">Country</label>
      <select id="ob-country" ref={refs.country} value={choice} onChange={(e) => chooseCountry(e.target.value, e.target.value === OTHER_COUNTRY ? typed.trim().toUpperCase() : e.target.value)}
        required {...bad(errors.country && !outside ? errors.country : undefined, 'ob-country-error')}>
        <option value="">Choose your country</option>
        {countries.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        <option value={OTHER_COUNTRY}>My country is not listed</option>
      </select>
      {!outside && err('ob-country-error', errors.country)}
      {outside && (
        <>
          <label htmlFor="ob-typed">Country code (two letters, for example US)</label>
          <input id="ob-typed" ref={refs.typed} type="text" maxLength={2} autoComplete="off" value={typed}
            onChange={(e) => { setTyped(e.target.value); chooseCountry(OTHER_COUNTRY, e.target.value.trim().toUpperCase()); }}
            aria-describedby={['ob-note', errors.country ? 'ob-typed-error' : ''].filter(Boolean).join(' ')} aria-invalid={errors.country ? true : undefined} />
          {err('ob-typed-error', errors.country)}
          <p id="ob-note" className="muted" role="status">{!countries.some((c) => c.value === country) && 'The pilot is not open in a country that is not listed. If you go on, you will not be able to use Sparta until it opens there.'}</p>
        </>
      )}
      <label htmlFor="ob-hemisphere">Hemisphere (decides the seasons)</label>
      <select id="ob-hemisphere" ref={refs.hemisphere} value={hemisphere} onChange={(e) => { setHemisphere(e.target.value); setErrors({ ...errors, hemisphere: undefined }); }} required {...bad(errors.hemisphere, 'ob-hemisphere-error')}>
        <option value="">Choose</option>
        <option value="north">Northern</option>
        <option value="south">Southern</option>
      </select>
      {err('ob-hemisphere-error', errors.hemisphere)}
      <label htmlFor="ob-currency">Preferred currency</label>
      <select id="ob-currency" ref={refs.currency} value={currency} onChange={(e) => { setCurrency(e.target.value); setErrors({ ...errors, currency: undefined }); }} required {...bad(errors.currency, 'ob-currency-error')}>
        <option value="">Choose</option>
        {currencies.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      {err('ob-currency-error', errors.currency)}
      <fieldset>
        <legend>Occasions you dress for most (optional)</legend>
        {OCCASIONS.map((o) => (
          <label key={o} className="check">
            <input type="checkbox" checked={occasions.includes(o)} onChange={(e) => setOccasions(e.target.checked ? [...occasions, o] : occasions.filter((x) => x !== o))} />
            {o}
          </label>
        ))}
      </fieldset>
      <p className="muted">You can change all of these later.</p>
      {failure && <p className="error" role="alert">{failure}</p>}
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Please wait' : 'Continue'}</button>
    </form>
  );
}
