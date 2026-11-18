import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/database.types';
import { bodyOf, guarded } from './admin-catalog';
import { fail, ok, UUID, type ErrorCode, type StorageLike } from './api';
import type { RouteLimit } from './limits';
import { originAllowed, purgeUserFolders } from './purge';

/** The admin end-of-pilot routes of LLD 6 (WO-0160, FR-69, BR-45): `/api/admin/settings`, `/api/admin/pilot/preview` and `/api/admin/pilot/end`.
 * `caller` is the person's own session client (who they are, their role); `createAdmin` builds the secret-key client and is called ONLY after the caller is
 * known to be an administrator, so no other caller ever causes the key to be read. The pilot settings and the deletion of participants are reached only through
 * the database functions of WO-0158 and WO-0159 (`ops.settings` has no grant to the secret-key role); each of them checks the administrator again and writes its own audit row. */
type Caller = Pick<SupabaseClient<Database>, 'auth' | 'schema'>;
type Admin = Pick<SupabaseClient<Database>, 'schema'> & { storage: StorageLike };
export interface PilotDeps {
  caller: Caller;
  createAdmin: () => Admin;
  /** The shared count and brake for the administrator routes (adminLimit of admin-catalog.ts). Optional only so the fake-client tests need no limiter; the three routes always pass it. */
  limitOf?: (admin: Admin) => RouteLimit;
  /** The clock for the end route's time budget (milliseconds); a test passes a fake one. */
  now?: () => number;
}

/** At most this many participants per call of the database batch function, and this many batches per call of the route (so one request stays short; the route is called again). */
export const END_BATCH = 20;
export const MAX_BATCHES = 5;
/** Wall-clock budget of one call of the end route (milliseconds). Once it is spent no NEW participant is started (one already started is finished: purge, then delete), and the call
 * answers with the counts and `more: true`, so a hosted request ends before the platform's timeout and the page calls again. */
export const TIME_BUDGET_MS = 8_000;
const MAX_VENDOR_BATCHES = 5;
export const OUTCOMES = ['close', 'continue'] as const;

const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: Json | undefined): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const record = (v: Json | null | undefined): { [key: string]: Json | undefined } | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null);
/** A real calendar date `YYYY-MM-DD`. Whether it lies in the past is the database's rule (a past date is refused only when it changes the stored date). */
export function realDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getUTCFullYear() >= 2000;   // Postgres refuses year 0000; no pilot ends before 2000
}
const isOutcome = (v: unknown): v is (typeof OUTCOMES)[number] => OUTCOMES.some((o) => o === v);
const messageOf = (e: { message?: string } | null): string => (e && typeof e.message === 'string' ? e.message : '');

/** The administrator, or the refusal. Order: another site's mutating request 403, no session 401 (an account service that fails 503), any role but admin 403 (read from the database);
 * and ONLY THEN the secret-key client is built, the administrator's own shared count is asked FIRST, then the per-process brake (WO-0130 order); an unreadable count is 503, fail closed.
 * Nothing is read or written before all of this passed. */
async function pilotAdmin(request: Request, d: PilotDeps, mutating: boolean): Promise<{ id: string; admin: Admin } | Response> {
  if (mutating && !originAllowed(request)) return fail('forbidden');
  const who = await d.caller.auth.getUser();
  if (who.error && (who.error.status ?? 500) >= 500) return fail('unavailable');
  if (who.error || !who.data.user) return fail('not_signed_in');
  const role = await d.caller.schema('app').rpc('current_role');
  if (role.error) return fail('server_error');
  if (role.data !== 'admin') return fail('forbidden');
  let admin: Admin;
  try { admin = d.createAdmin(); } catch { return fail('unavailable'); }
  const limit = d.limitOf?.(admin);
  if (limit) { try { if (!(await limit.count(`admin:${who.data.user.id}`))) return fail('rate_limited'); } catch { return fail('unavailable'); } }
  if (limit && !limit.brake()) return fail('rate_limited');
  return { id: who.data.user.id, admin };
}

// The generated type of p_target is `string | undefined`, but the SQL parameter takes null (a read has no target), so null is still sent.
const auditRow = async (admin: Admin, id: string, action: string): Promise<boolean> =>
  !(await admin.schema('app').rpc('write_admin_audit', { p_admin: id, p_action: action, p_target: null as unknown as string })).error;

/** The code an end-of-pilot database function's refusal maps to; anything unknown is a plain server error and nothing of the database's text is passed on. */
const refusal = (e: { message?: string; code?: string }): ErrorCode => {
  const m = messageOf(e);
  if (e.code === '42501' || m === 'forbidden') return 'forbidden';
  if (m === 'invalid_outcome') return 'bad_request';
  if (m === 'invalid_end_date') return 'invalid_end_date';
  if (m === 'pilot_not_ended') return 'pilot_not_ended';
  if (m === 'outcome_unset') return 'outcome_unset';
  if (m === 'notice_unset') return 'notice_unset';
  return 'server_error';
};

/** `GET /api/admin/settings`: the two FR-69 keys, `null` while a key is empty. Read through `app.public_setting` (its whitelist holds exactly these keys among others). */
export const getSettings = (request: Request, d: PilotDeps): Promise<Response> => guarded(async () => {
  const who = await pilotAdmin(request, d, false);
  if (who instanceof Response) return who;
  if (!(await auditRow(who.admin, who.id, 'pilot.settings_read'))) return fail('server_error');
  const date = await d.caller.schema('app').rpc('public_setting', { p_key: 'pilot_end_date' });
  const outcome = await d.caller.schema('app').rpc('public_setting', { p_key: 'pilot_outcome' });
  if (date.error || outcome.error) return fail('server_error');
  return ok({ pilot_end_date: realDate(date.data) ? date.data : null, pilot_outcome: isOutcome(outcome.data) ? outcome.data : null });
});

/** `PATCH /api/admin/settings`: exactly `{pilot_end_date: 'YYYY-MM-DD', pilot_outcome: 'close' | 'continue'}`; the rules (no date in the past that changes the date) are the database function's. */
export const patchSettings = (request: Request, d: PilotDeps): Promise<Response> => guarded(async () => {
  const who = await pilotAdmin(request, d, true);
  if (who instanceof Response) return who;
  const body = await bodyOf(request);
  if (!plain(body) || Object.keys(body).length !== 2 || !realDate(body.pilot_end_date) || !isOutcome(body.pilot_outcome)) return fail('bad_request');
  const r = await who.admin.schema('app').rpc('admin_set_pilot_end', { p_admin: who.id, p_end_date: body.pilot_end_date, p_outcome: body.pilot_outcome });
  if (r.error) return fail(refusal(r.error));
  const out = record(r.data);
  const date = out?.pilot_end_date;
  const outcome = out?.pilot_outcome;
  if (!realDate(date) || !isOutcome(outcome)) return fail('server_error');
  return ok({ pilot_end_date: date, pilot_outcome: outcome });
});

/** `GET /api/admin/pilot/preview`: the counts of `app.admin_end_pilot_preview()` and nothing else (no id, no address). */
export const previewPilot = (request: Request, d: PilotDeps): Promise<Response> => guarded(async () => {
  const who = await pilotAdmin(request, d, false);
  if (who instanceof Response) return who;
  if (!(await auditRow(who.admin, who.id, 'pilot.preview'))) return fail('server_error');
  const r = await who.admin.schema('app').rpc('admin_end_pilot_preview');
  if (r.error) return fail(refusal(r.error));
  const out = record(r.data);
  const consumers = count(out?.consumers_to_delete);
  const invitations = count(out?.unused_invitations);
  const vendors = count(out?.vendor_users);
  if (consumers === null || invitations === null || vendors === null) return fail('server_error');
  return ok({ consumers_to_delete: consumers, unused_invitations: invitations, vendor_users: vendors, ...(out?.outcome_unset === true ? { outcome_unset: true } : {}) });
});

interface Batch { ids: string[]; remaining: number; done: boolean; invitations: number }
function batchOf(data: Json): Batch | null {
  const o = record(data);
  const ids = Array.isArray(o?.user_ids) ? o.user_ids : null;
  const remaining = count(o?.remaining);
  const invitations = count(o?.invitations_deleted);
  if (!ids || remaining === null || invitations === null || typeof o?.done !== 'boolean') return null;
  const clean: string[] = [];
  for (const id of ids) { if (typeof id !== 'string' || !UUID.test(id)) return null; if (!clean.includes(id)) clean.push(id); }   // an id that is not a UUID is never purged; a repeated id is handled once
  return { ids: clean, remaining, done: o.done, invitations };
}
interface Vendors { vendor_items_withdrawn: number; vendor_users_deleted: number; remaining: number }
function vendorsOf(data: Json): Vendors | null {
  const o = record(data);
  const items = count(o?.vendor_items_withdrawn);
  const users = count(o?.vendor_users_deleted);
  const remaining = count(o?.remaining);
  return items === null || users === null || remaining === null ? null : { vendor_items_withdrawn: items, vendor_users_deleted: users, remaining };
}

interface Tally { processed: number; deleted: number; unmarked: number; already_handled: number; purge_failed: number; delete_failed: number }

/** One participant: the files first (through the one shared routine of purge.ts); the account only after that purge succeeded. Returns 'progress' when the participant is
 * handled (deleted, unmarked because they accepted the notice meanwhile, or already handled by a concurrent call), 'failed' otherwise (they stay marked and come back first). */
async function handleOne(admin: Admin, adminId: string, user: string, t: Tally): Promise<'progress' | 'failed'> {
  t.processed += 1;
  try { await purgeUserFolders(admin.storage, user); } catch { t.purge_failed += 1; return 'failed'; }
  try {
    const r = await admin.schema('app').rpc('admin_end_pilot_delete', { p_admin: adminId, p_user: user });
    if (r.error) {
      if (messageOf(r.error) === 'not_marked') { t.already_handled += 1; return 'progress'; }   // a concurrent call finished this participant after our purge succeeded
      t.delete_failed += 1; return 'failed';
    }
    const o = record(r.data);
    if (o?.deleted === true) t.deleted += 1;
    else if (o?.unmarked === true) t.unmarked += 1;
    else { t.delete_failed += 1; return 'failed'; }
    return 'progress';
  } catch { t.delete_failed += 1; return 'failed'; }
}

/** One batch of `app.admin_end_pilot_vendors`: the counts, 'skip' when it does not apply (not the close outcome, or a participant is left), 'error' otherwise. */
async function vendorStep(admin: Admin, adminId: string): Promise<Vendors | 'skip' | 'error'> {
  try {
    const r = await admin.schema('app').rpc('admin_end_pilot_vendors', { p_admin: adminId, p_limit: END_BATCH });
    if (r.error) { const m = messageOf(r.error); return m === 'not_closing' || m === 'participants_remaining' ? 'skip' : 'error'; }
    return vendorsOf(r.data) ?? 'error';
  } catch { return 'error'; }
}

/** One call of `app.admin_end_pilot_next`: the batch, or the fixed code of the refusal. */
async function nextBatch(admin: Admin, adminId: string): Promise<Batch | ErrorCode> {
  try {
    const r = await admin.schema('app').rpc('admin_end_pilot_next', { p_admin: adminId, p_limit: END_BATCH });
    return r.error ? refusal(r.error) : batchOf(r.data) ?? 'server_error';
  } catch { return 'unavailable'; }
}

/** `POST /api/admin/pilot/end`: body exactly `{confirm: "END"}` (400 `confirmation_required` before any pilot database call). Takes participants ONLY from `app.admin_end_pilot_next`,
 * purges each one's files, then deletes the account; at most MAX_BATCHES batches per call, so the route is called again until `done`. Stops (and reports `stuck`) when a batch makes no progress:
 * participants whose purge keeps failing stay marked and come back first, so the same ones would be tried for ever. After the last participant one more `next` call records the end;
 * then, under the close outcome, `app.admin_end_pilot_vendors` runs in batches (it refuses with `not_closing` otherwise, which is not an error here). */
export const endPilot = (request: Request, d: PilotDeps): Promise<Response> => guarded(async () => {
  const who = await pilotAdmin(request, d, true);
  if (who instanceof Response) return who;
  const body = await bodyOf(request);
  if (!plain(body) || Object.keys(body).length !== 1 || body.confirm !== 'END') return fail('confirmation_required');

  const now = d.now ?? Date.now;
  const deadline = now() + TIME_BUDGET_MS;
  let more = false;
  const t: Tally = { processed: 0, deleted: 0, unmarked: 0, already_handled: 0, purge_failed: 0, delete_failed: 0 };
  let batches = 0; let remaining = 0; let done = false; let invitations = 0; let stuck = false; let interrupted = false;
  while (batches < MAX_BATCHES) {
    if (t.processed > 0 && now() >= deadline) { more = true; break; }   // the budget is checked between batches and between participants, never inside one
    const next = await nextBatch(who.admin, who.id);
    if (typeof next === 'string') { if (batches === 0) return fail(next); interrupted = true; break; }   // a refusal of the very first call means nothing was done; later it only stops this call
    batches += 1; remaining = next.remaining; done = next.done; invitations += next.invitations;
    if (next.ids.length === 0) break;                  // nothing selected: this call is the final one that records the end
    let progress = 0; let failed = 0;
    let skipped = 0;
    for (const id of next.ids) {
      if (t.processed > 0 && now() >= deadline) { skipped += 1; continue; }   // not started: stays marked, the next call takes it
      if ((await handleOne(who.admin, who.id, id, t)) === 'progress') progress += 1; else failed += 1;
    }
    remaining += failed + skipped;                               // participants that failed stay marked and are still to do
    done = false;
    if (progress === 0 || (failed > 0 && remaining === failed)) { stuck = true; break; }   // no progress, or only the failing ones are left: report, do not loop; this comes BEFORE the budget case, so slow failures are never answered with `more` for ever (then `more` stays false: the page stops)
    if (skipped > 0) { more = true; break; }
  }

  let vendors: Vendors | null = null;
  if (done && now() >= deadline) more = true;   // the end is recorded; the vendor step waits for the next call
  if (done && !more) {
    let items = 0; let users = 0; let left = 0; let ran = false;
    for (let i = 0; i < MAX_VENDOR_BATCHES; i++) {
      if (now() >= deadline) { more = true; break; }
      const v = await vendorStep(who.admin, who.id);
      if (v === 'skip') break;
      if (v === 'error') { interrupted = true; break; }
      ran = true; items += v.vendor_items_withdrawn; users += v.vendor_users_deleted; left = v.remaining;
      if (v.remaining === 0 || v.vendor_users_deleted === 0) break;
    }
    if (ran) vendors = { vendor_items_withdrawn: items, vendor_users_deleted: users, remaining: left };
  }
  return ok({ ...t, batches, remaining, done, invitations_deleted: invitations, stuck, interrupted, more, vendors });
});
