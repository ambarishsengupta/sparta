import { NO_CONNECTION, NOT_UNDERSTOOD, browserSend, type Send } from './admin-actions';

/** The browser side of the end-of-pilot routes (WO-0173, LLD 6): the three fixed paths, the answers read into plain values (counts and flags only, never an id or an address). Nothing here throws. */
export const SETTINGS_PATH = '/api/admin/settings';
export const PREVIEW_PATH = '/api/admin/pilot/preview';
export const END_PATH = '/api/admin/pilot/end';
/** The typed word, and the body of the end call. */
export const CONFIRM_WORD = 'END';
export const END_BODY = { confirm: CONFIRM_WORD } as const;
/** One run never makes more calls than this, and a platform timeout (an answer that is not JSON) is retried at most MAX_RETRIES times in a row: the page gives up at the next one, so MAX_RETRIES + 1 calls in all. */
export const MAX_CALLS = 200;
export const MAX_RETRIES = 3;
export const OUTCOMES = ['close', 'continue'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface PilotSettings { date: string | null; outcome: Outcome | null }
export interface PilotPreview { consumers: number; invitations: number; vendors: number; outcomeUnset: boolean }
export interface VendorCounts { items: number; users: number; remaining: number }
/** One answer of the end route, as the page uses it. */
export interface EndAnswer {
  processed: number; deleted: number; unmarked: number; alreadyHandled: number; purgeFailed: number; deleteFailed: number;
  remaining: number; done: boolean; invitations: number; stuck: boolean; interrupted: boolean; more: boolean; vendors: VendorCounts | null;
}
export type EndStep = { kind: 'data'; data: EndAnswer } | { kind: 'retry' } | { kind: 'error'; message: string };
export type Read<T> = { ok: true; data: T } | { ok: false; message: string };

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const isOutcome = (v: unknown): v is Outcome => OUTCOMES.some((o) => o === v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readSettings(json: unknown): PilotSettings | null {
  const o = obj(json);
  if (!o) return null;
  const date = o.pilot_end_date; const outcome = o.pilot_outcome;
  if (!(date === null || (typeof date === 'string' && DATE.test(date)))) return null;
  if (!(outcome === null || isOutcome(outcome))) return null;
  return { date, outcome };
}
export function readPreview(json: unknown): PilotPreview | null {
  const o = obj(json);
  const consumers = num(o?.consumers_to_delete); const invitations = num(o?.unused_invitations); const vendors = num(o?.vendor_users);
  if (consumers === null || invitations === null || vendors === null) return null;
  return { consumers, invitations, vendors, outcomeUnset: o?.outcome_unset === true };
}
export function readEnd(json: unknown): EndAnswer | null {
  const o = obj(json);
  if (!o) return null;
  const n = ['processed', 'deleted', 'unmarked', 'already_handled', 'purge_failed', 'delete_failed', 'remaining', 'invitations_deleted'].map((k) => num(o[k]));
  if (n.some((x) => x === null)) return null;
  if (typeof o.done !== 'boolean' || typeof o.stuck !== 'boolean' || typeof o.interrupted !== 'boolean' || typeof o.more !== 'boolean') return null;
  let vendors: VendorCounts | null = null;
  if (o.vendors !== null && o.vendors !== undefined) {
    const v = obj(o.vendors);
    const items = num(v?.vendor_items_withdrawn); const users = num(v?.vendor_users_deleted); const left = num(v?.remaining);
    if (items === null || users === null || left === null) return null;
    vendors = { items, users, remaining: left };
  }
  const [processed, deleted, unmarked, alreadyHandled, purgeFailed, deleteFailed, remaining, invitations] = n as number[];
  return { processed: processed!, deleted: deleted!, unmarked: unmarked!, alreadyHandled: alreadyHandled!, purgeFailed: purgeFailed!, deleteFailed: deleteFailed!, remaining: remaining!, done: o.done, invitations: invitations!, stuck: o.stuck, interrupted: o.interrupted, more: o.more, vendors };
}

/** What the server said, if it said it in the fixed error shape. */
const sentence = (json: unknown): string | null => {
  const m = obj(obj(json)?.error)?.message;
  return typeof m === 'string' ? m : null;
};

/** A GET or PATCH of the settings or the preview: the answer read with `read`, or the server's fixed sentence, or a plain one. */
export async function pilotRead<T>(path: string, method: 'GET' | 'PATCH', read: (json: unknown) => T | null, body?: unknown, send: Send = browserSend): Promise<Read<T>> {
  try {
    const res = await send(path, { method, credentials: 'same-origin', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    let json: unknown = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    if (res.ok) { const data = read(json); if (data !== null) return { ok: true, data }; }
    return { ok: false, message: sentence(json) ?? NOT_UNDERSTOOD };
  } catch { return { ok: false, message: NO_CONNECTION }; }
}

/** One call of the end route with the fixed body. An answer that is not JSON and has a 5xx status (a platform timeout) is `retry`: the work is done in batches, so calling again is safe. */
export async function endCall(send: Send = browserSend): Promise<EndStep> {
  try {
    const res = await send(END_PATH, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(END_BODY) });
    let json: unknown = null;
    let parsed = false;
    try { json = await res.json(); parsed = true; } catch { /* not JSON */ }
    if (!parsed && res.status >= 500) return { kind: 'retry' };
    if (res.ok) { const data = readEnd(json); if (data) return { kind: 'data', data }; }
    return { kind: 'error', message: sentence(json) ?? NOT_UNDERSTOOD };
  } catch { return { kind: 'error', message: NO_CONNECTION }; }
}
