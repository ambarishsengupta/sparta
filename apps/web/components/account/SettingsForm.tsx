'use client';
import { OCCASIONS } from '@sparta/taxonomy';
import { useRef, useState, type SubmitEvent } from 'react';
import type { Option } from '../../lib/onboarding';
import { MAX_NAME, settingsPatch, validateSettings, type SettingsErrors, type SettingsInput } from '../../lib/settings-form';
import { saveProfile } from './account-actions';
import { createBrowserSupabase } from '../../lib/supabase/browser';
import { showRejection } from '../../lib/supabase/errors';

/** The profile fields a person may change (FR-6): display name, hemisphere, currency and occasions. Country is shown by the page and is not editable. */
export function SettingsForm({ initial, currencies }: { initial: SettingsInput; currencies: Option[] }) {
  const [v, setV] = useState<SettingsInput>(initial);
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const refs = { displayName: useRef<HTMLInputElement>(null), hemisphere: useRef<HTMLSelectElement>(null), currency: useRef<HTMLSelectElement>(null) };
  const change = (patch: Partial<SettingsInput>) => { setV({ ...v, ...patch }); setSaved(false); };

  function submit(e: SubmitEvent) {
    e.preventDefault();
    save().catch(showRejection(setBusy, setFailure)); // a rejection is shown, never left unhandled
  }
  async function save() {
    setFailure(null);
    setSaved(false);
    const found = validateSettings(v, currencies.map((c) => c.value));
    setErrors(found);
    const first = found.displayName ? refs.displayName : found.hemisphere ? refs.hemisphere : found.currency ? refs.currency : null;
    if (first) return first.current?.focus();
    setBusy(true);
    const out = await saveProfile(createBrowserSupabase(), settingsPatch(v));
    setBusy(false);
    if (out.ok) return setSaved(true);
    setFailure(out.message);
  }
  const bad = (m: string | undefined, id: string) => ({ 'aria-invalid': m ? true : undefined, 'aria-describedby': m ? id : undefined });
  const err = (id: string, text?: string) => text && <p id={id} className="error" role="alert">{text}</p>;

  return (
    <form className="form" onSubmit={submit} noValidate>
      <label htmlFor="set-name">Display name (optional)</label>
      <input id="set-name" ref={refs.displayName} type="text" maxLength={MAX_NAME} autoComplete="nickname" value={v.displayName} onChange={(e) => change({ displayName: e.target.value })} {...bad(errors.displayName, 'set-name-error')} />
      {err('set-name-error', errors.displayName)}
      <label htmlFor="set-hemisphere">Hemisphere (decides the seasons)</label>
      <select id="set-hemisphere" ref={refs.hemisphere} value={v.hemisphere} onChange={(e) => change({ hemisphere: e.target.value })} {...bad(errors.hemisphere, 'set-hemisphere-error')}>
        {v.hemisphere === '' && <option value="">Choose</option>}
        <option value="north">Northern</option>
        <option value="south">Southern</option>
      </select>
      {err('set-hemisphere-error', errors.hemisphere)}
      <label htmlFor="set-currency">Preferred currency</label>
      <select id="set-currency" ref={refs.currency} value={v.currency} onChange={(e) => change({ currency: e.target.value })} {...bad(errors.currency, 'set-currency-error')}>
        {currencies.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      {err('set-currency-error', errors.currency)}
      <fieldset>
        <legend>Occasions you dress for most</legend>
        {OCCASIONS.map((o) => (
          <label key={o} className="check">
            <input type="checkbox" checked={v.occasions.includes(o)} onChange={(e) => change({ occasions: e.target.checked ? [...v.occasions, o] : v.occasions.filter((x) => x !== o) })} />
            {o}
          </label>
        ))}
      </fieldset>
      {failure && <p className="error" role="alert">{failure}</p>}
      <p role="status">{saved ? 'Your changes were saved.' : ''}</p>
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Please wait' : 'Save changes'}</button>
    </form>
  );
}
