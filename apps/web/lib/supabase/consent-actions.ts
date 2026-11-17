import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/** Calls for the three steps after sign-in (LLD 9.1, 4.9), made with the caller's own session. The versions come from `app.public_setting`, never from a constant. */
export interface Versions { terms: string; privacy: string; notice: string }
export type Step = { ok: true } | { ok: false; message: string };
export type OnboardingResult = { ok: true; result: 'ok' | 'unsupported_country' } | { ok: false; message: string };
type Client = Pick<SupabaseClient<Database>, 'auth' | 'schema'>;

const GENERIC = 'Something went wrong. Please try again in a moment.';
const RELOAD = 'These documents were updated while you were reading. Reload the page to see the latest version, then try again.';
const SIGNED_OUT = 'Your session has ended. Sign in again to continue.';

/** The current Terms, Privacy Policy and notice versions, or null when any cannot be read (the page then shows an error instead of a form). */
export async function readVersions(client: Client): Promise<Versions | null> {
  try {
    const get = async (key: string): Promise<string> => {
      const r = await client.schema('app').rpc('public_setting', { p_key: key });
      if (r.error || typeof r.data !== 'string' || r.data === '') throw new Error('no version');
      return r.data;
    };
    const [terms, privacy, notice] = await Promise.all([get('current_terms_version'), get('current_privacy_version'), get('current_notice_version')]);
    return { terms, privacy, notice };
  } catch { return null; }
}

/** The countries the pilot is open in (codes), or an empty list when they cannot be read. */
export async function readSupportedCountries(client: Client): Promise<string[]> {
  try { const r = await client.schema('app').rpc('supported_countries'); return !r.error && Array.isArray(r.data) ? r.data.filter((c: unknown): c is string => typeof c === 'string') : []; } catch { return []; }
}

/** FR-2, FR-68: records the Terms and Privacy Policy versions the person was shown. The database refuses a version that is no longer current. */
export async function acceptDocuments(client: Client, shown: Pick<Versions, 'terms' | 'privacy'>, ageConfirmed: boolean): Promise<Step> {
  try {
    const { error } = await client.schema('app').rpc('accept_documents', { p_terms_version: shown.terms, p_privacy_version: shown.privacy, p_age_confirmed: ageConfirmed });
    if (!error) return { ok: true };
    if (error.message.includes('stale_version')) return { ok: false, message: RELOAD };
    if (error.message.includes('age_not_confirmed')) return { ok: false, message: 'Confirm that you are 18 or over to continue.' };
    return { ok: false, message: GENERIC };
  } catch { return { ok: false, message: GENERIC }; }
}

/** FR-3 to FR-5: stores the consent record for the notice version the person was shown. The insert policy refuses a version that is not current. */
export async function acceptPilotNotice(client: Client, shownVersion: string): Promise<Step> {
  try {
    const { data } = await client.auth.getUser();
    if (!data.user) return { ok: false, message: SIGNED_OUT };
    const { error } = await client.schema('app').from('consent_records').insert({ user_id: data.user.id, notice_version: shownVersion });
    if (!error || error.code === '23505') return { ok: true }; // 23505: this version was already accepted; nothing to add
    return { ok: false, message: error.code === '42501' ? RELOAD : GENERIC };
  } catch { return { ok: false, message: GENERIC }; }
}

/** FR-6, FR-9: stores the answers. An unsupported country is not an error: the person is then held at the not-available page. */
export async function completeOnboarding(client: Client, a: { country: string; hemisphere: string; currency: string; occasions: string[] }): Promise<OnboardingResult> {
  try {
    const { data, error } = await client.schema('app').rpc('complete_onboarding', { p_country: a.country, p_hemisphere: a.hemisphere, p_currency: a.currency, p_occasions: a.occasions });
    if (error) return { ok: false, message: GENERIC };
    return data === 'ok' || data === 'unsupported_country' ? { ok: true, result: data } : { ok: false, message: GENERIC };
  } catch { return { ok: false, message: GENERIC }; }
}
