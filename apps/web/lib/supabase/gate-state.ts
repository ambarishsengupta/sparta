import { AuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import { stateFromFacts, type Facts, type GateState } from './gate';

const rows = <T>(r: { data: T; error: unknown }): T => { if (r.error) throw new Error('gate: a query failed'); return r.data; };
const list = <T>(r: { data: T[] | null; error: unknown }): T[] => rows(r) ?? [];

/** The caller's gate state, read with the caller's own session (LLD 9.1). A signed-out or expired session is `unauthenticated`;
 * a failure to reach the service throws, so the caller can refuse the request instead of guessing. */
export async function loadGateState(client: SupabaseClient): Promise<GateState> {
  const { data, error } = await client.auth.getUser();
  if (error && (error instanceof AuthRetryableFetchError || (error.status ?? 500) >= 500)) throw error;
  const user = data.user;
  if (error || !user) return 'unauthenticated';
  const app = client.schema('app');
  const [profile, consent] = await Promise.all([app.from('profiles').select('role, age_confirmed, country').maybeSingle(), app.rpc('has_consent')]);
  const row = rows(profile);
  const facts: Facts = {
    emailConfirmed: Boolean(user.email_confirmed_at), role: row?.role ?? 'none', eligible: rows(consent) === true,
    ageConfirmed: true, termsCurrent: true, privacyCurrent: true, noticeCurrent: true, country: row?.country ?? null,
  };
  if (!facts.eligible && row && facts.emailConfirmed && row.role === 'consumer') {
    const setting = (key: string) => app.rpc('public_setting', { p_key: key });
    const [terms, privacy, notice, docs, notices] = await Promise.all([
      setting('current_terms_version'), setting('current_privacy_version'), setting('current_notice_version'),
      app.from('document_acceptances').select('document, version'), app.from('consent_records').select('notice_version'),
    ]);
    const accepted = (doc: string, version: unknown) => list(docs).some((d: { document: string; version: string }) => d.document === doc && d.version === version);
    facts.ageConfirmed = row.age_confirmed === true;
    facts.termsCurrent = accepted('terms', rows(terms));
    facts.privacyCurrent = accepted('privacy_policy', rows(privacy));
    facts.noticeCurrent = list(notices).some((n: { notice_version: string }) => n.notice_version === rows(notice));
  }
  return stateFromFacts(facts);
}
