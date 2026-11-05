import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProfilePatch } from '../../lib/settings-form';
import { classify, type FailureKind } from '../../lib/supabase/errors';

/** Calls behind Settings, Export my data and Leave the pilot (FR-62, FR-66), all made with the caller's own session through the publishable key. */
type Client = Pick<SupabaseClient, 'auth' | 'schema'>;
export type Step = { ok: true } | { ok: false; message: string };

// ---- export -------------------------------------------------------------------------------------------------------------

export type ExportResult = { ok: true; text: string; filename: string } | { ok: false; message: string };
const EXPORT_FAILURE: Record<FailureKind, string> = {
  network: 'Could not reach the server, so the export was not made. Check your connection and try again.',
  session: 'Your session has ended. Sign in again to export your data.',
  refused: 'Your account is not allowed to export data.',
  rejected: 'The export could not be made. Please try again in a moment.',
  unsupported: 'The export could not be made. Please try again in a moment.',
  unexpected: 'The export could not be made. Please try again in a moment.',
};

/** The file name carries the date and nothing about the person. */
export const exportFilename = (now: Date): string => `sparta-export-${now.toISOString().slice(0, 10)}.json`;

/** The document `app.export_my_data()` returns has a format version and the account block; anything else is refused rather than saved as an export. */
export function isExportDocument(d: unknown): d is Record<string, unknown> {
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return false;
  const doc = d as Record<string, unknown>;
  const account = doc.account as Record<string, unknown> | null | undefined;
  return doc.format_version === 1 && typeof doc.generated_at === 'string' && typeof account?.id === 'string' && Array.isArray(doc.profiles);
}

/** FR-62: one document with every row the person owns, from the database function that acts on the caller's own session. */
export async function exportMyData(client: Client, now: Date = new Date()): Promise<ExportResult> {
  try {
    const r = await client.schema('app').rpc('export_my_data');
    if (r.error) return { ok: false, message: EXPORT_FAILURE[classify({ status: r.status, error: r.error }, false).kind] };
    if (!isExportDocument(r.data)) return { ok: false, message: EXPORT_FAILURE.unexpected };
    return { ok: true, text: JSON.stringify(r.data, null, 2), filename: exportFilename(now) };
  } catch (e) {
    return { ok: false, message: EXPORT_FAILURE[e instanceof TypeError ? 'network' : 'unexpected'] };
  }
}

// ---- leave the pilot ----------------------------------------------------------------------------------------------------

export type LeaveFailure = 'credentials' | 'session' | 'failed' | 'unsure';
export type LeaveResult = { ok: true; result: 'deleted' | 'already_deleted' } | { ok: false; reason: LeaveFailure; message: string };
const LEAVE: Record<LeaveFailure, string> = {
  credentials: 'That password is not right, so nothing was deleted. Check it and try again.',
  session: 'Your session has ended, so nothing was deleted. Sign in again, then leave the pilot.',
  failed: 'Something went wrong before anything was deleted. Please try again in a moment.',
  unsure: 'We could not confirm the result. Try to sign in: if your account is gone, it was deleted.',
};
const NO_CONNECTION = 'Could not reach the server, so nothing was deleted. Check your connection and try again.';
const leaveFailure = (reason: LeaveFailure, message = LEAVE[reason]): LeaveResult => ({ ok: false, reason, message });

/**
 * FR-63, FR-66: the person types their password again (a fresh sign-in, so a session left open on a shared screen is not enough), and only
 * then is `app.delete_my_account()` called. The function deletes the signed-in account, which only the caller's own session can name.
 * Every failure before the call says that nothing was deleted; a failure during or after it says the result is unknown, never "not deleted".
 */
export async function leaveThePilot(client: Client, password: string): Promise<LeaveResult> {
  if (password === '') return leaveFailure('credentials', 'Enter your password to confirm.');
  try {
    const { data, error } = await client.auth.getUser();
    const email = data.user?.email;
    if (error?.name === 'AuthRetryableFetchError' || (error?.status ?? 0) >= 500) return leaveFailure('failed', NO_CONNECTION);
    if (error || !email) return leaveFailure('session');
    const again = await client.auth.signInWithPassword({ email, password });
    if (again.error) {
      if (again.error.code === 'invalid_credentials') return leaveFailure('credentials');
      if (again.error.status === 429 || again.error.code?.startsWith('over_')) return leaveFailure('failed', 'Too many attempts, so nothing was deleted. Please wait a few minutes and try again.');
      return leaveFailure('failed');
    }
  } catch { return leaveFailure('failed', NO_CONNECTION); }
  try {
    const r = await client.schema('app').rpc('delete_my_account');
    if (r.error) return r.status >= 400 && r.status < 500 && r.error.code === '42501' ? leaveFailure('failed', 'Your account is not allowed to leave the pilot this way. Write to the privacy contact address.') : leaveFailure('unsure');
    if (r.data !== 'deleted' && r.data !== 'already_deleted') return leaveFailure('unsure');
    await endSession(client);
    return { ok: true, result: r.data };
  } catch { return leaveFailure('unsure'); }
}

/** The account is gone, so the server cannot end the session; this removes it from the browser (the cookies are swept next). Never throws. */
async function endSession(client: Client): Promise<void> {
  try { await client.auth.signOut({ scope: 'local' }); } catch { /* the cookie sweep below does not depend on it */ }
}

/** The session cookies in a `document.cookie` string (supabase names them `sb-...`, in numbered pieces when long). */
export const sessionCookieNames = (cookieString: string): string[] =>
  cookieString.split(';').map((p) => p.split('=')[0]!.trim()).filter((n) => n.startsWith('sb-'));

// ---- settings -----------------------------------------------------------------------------------------------------------

export interface ProfileView { displayName: string; country: string | null; hemisphere: 'north' | 'south' | null; currency: string; occasions: string[] }
const SAVE_FAILED = 'Your changes were not saved. Please try again in a moment.';

/** The caller's own profile row (the policy lets a person read it at any gate step), or null when it cannot be read. */
export async function readProfile(client: Client): Promise<ProfileView | null> {
  try {
    const r = await client.schema('app').from('profiles').select('display_name, country, hemisphere, currency, occasions').maybeSingle();
    if (r.error || !r.data) return null;
    const d = r.data as { display_name: string | null; country: string | null; hemisphere: string | null; currency: string; occasions: string[] | null };
    return { displayName: d.display_name ?? '', country: d.country, hemisphere: d.hemisphere === 'north' || d.hemisphere === 'south' ? d.hemisphere : null, currency: d.currency, occasions: d.occasions ?? [] };
  } catch { return null; }
}

/** The columns a person may change on their own profile (display name, hemisphere, currency, occasions); the database grants no others. */
export async function saveProfile(client: Client, patch: ProfilePatch): Promise<Step> {
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return { ok: false, message: 'Your session has ended. Sign in again to save your changes.' };
    const r = await client.schema('app').from('profiles').update(patch).eq('id', data.user.id).select('id');
    if (r.error) return { ok: false, message: r.status === 0 ? 'Could not reach the server, so your changes were not saved. Check your connection and try again.' : SAVE_FAILED };
    return Array.isArray(r.data) && r.data.length === 1 ? { ok: true } : { ok: false, message: SAVE_FAILED };
  } catch (e) {
    return { ok: false, message: e instanceof TypeError ? 'Could not reach the server, so your changes were not saved. Check your connection and try again.' : SAVE_FAILED };
  }
}
