import { isCategory, isSubType } from '@sparta/taxonomy';

/** The checks of the admin catalogue routes and page (WO-0088, LLD 6, Data Sourcing Policy section 4), as pure functions. No request, no URL literal. */
export const NAME_MAX = 120;
export const URL_MAX = 300;
export const TERMS_MAX = 1000;
export const CONTACT_MAX = 200;
export const TAKEDOWN_NOTE_MAX = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

export interface SourceFields { name: string; site_url: string; robots_allowed: boolean; terms_note: string; checked_on: string; contact: string | null; allowed: boolean }
export type Parsed<T> = { ok: true; value: T } | { ok: false };
const bad = { ok: false } as const;
const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasControl = (v: string): boolean => [...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const oneLine = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' && v.trim().length <= max && !hasControl(v) ? v.trim() : null);

/** `https` anywhere, or `http` on this machine only (the local test host); no login in the address. */
export function siteUrlOk(s: unknown): s is string {
  if (typeof s !== 'string' || s.length > URL_MAX || /^[a-z]+:\/\/[^/?#]*@/i.test(s)) return false;   // no login part, not even an empty one
  try {
    const u = new URL(s);
    return u.username === '' && u.password === '' && (u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTS.includes(u.hostname)));
  } catch { return false; }
}

/** A real calendar date `YYYY-MM-DD`, not later than tomorrow in UTC (an admin east of Greenwich may already be on the next date). */
export function checkDateOk(s: unknown, now: Date = new Date()): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getTime() <= now.getTime() + 86_400_000;
}

/** Data Sourcing Policy section 4: a source may be allowed only when robots.txt permits it and the terms note and the check date are recorded. */
export const mayAllow = (s: { robots_allowed?: unknown; terms_note?: unknown; checked_on?: unknown }): boolean =>
  s.robots_allowed === true && typeof s.terms_note === 'string' && s.terms_note.trim() !== '' && typeof s.checked_on === 'string' && s.checked_on !== '';

const FIELDS = ['name', 'site_url', 'robots_allowed', 'terms_note', 'checked_on', 'contact', 'allowed'] as const;
/** The body of POST (every field but `contact` and `allowed` required) or PATCH (`id` plus at least one field). Unknown keys refuse the whole body. */
export function parseSource(body: unknown, mode: 'create' | 'update', now?: Date): Parsed<{ id?: number; fields: Partial<SourceFields> }> {
  if (!plain(body)) return bad;
  const allowedKeys: string[] = mode === 'update' ? ['id', ...FIELDS] : [...FIELDS];
  if (Object.keys(body).some((k) => !allowedKeys.includes(k))) return bad;
  const f: Partial<SourceFields> = {};
  if ('name' in body) { const v = oneLine(body.name, NAME_MAX); if (v === null) return bad; f.name = v; }
  if ('site_url' in body) { if (!siteUrlOk(body.site_url)) return bad; f.site_url = body.site_url; }
  if ('robots_allowed' in body) { if (typeof body.robots_allowed !== 'boolean') return bad; f.robots_allowed = body.robots_allowed; }
  if ('terms_note' in body) { if (typeof body.terms_note !== 'string' || body.terms_note.length > TERMS_MAX) return bad; f.terms_note = body.terms_note.trim(); }
  if ('checked_on' in body) { if (!checkDateOk(body.checked_on, now)) return bad; f.checked_on = body.checked_on; }
  if ('contact' in body) { const v = body.contact === null || body.contact === '' ? null : oneLine(body.contact, CONTACT_MAX); if (v === null && body.contact !== null && body.contact !== '') return bad; f.contact = v; }
  if ('allowed' in body) { if (typeof body.allowed !== 'boolean') return bad; f.allowed = body.allowed; }
  if (mode === 'create') return ['name', 'site_url', 'robots_allowed', 'terms_note', 'checked_on'].every((k) => k in f) ? { ok: true, value: { fields: { allowed: false, contact: null, ...f } } } : bad;
  if (typeof body.id !== 'number' || !Number.isSafeInteger(body.id) || body.id < 1 || Object.keys(f).length === 0) return bad;
  return { ok: true, value: { id: body.id, fields: f } };
}

/** The source id in the path: digits only, a positive integer that fits the column. */
export const sourceIdOf = (raw: string): number | null => (/^[1-9][0-9]{0,9}$/.test(raw) && Number(raw) <= 2_147_483_647 ? Number(raw) : null);

/** The optional note of a take-down: absent or null gives null; text is one trimmed string of at most 500 characters. */
export function parseTakedown(body: unknown): Parsed<{ note: string | null }> {
  if (body === undefined) return { ok: true, value: { note: null } };
  if (!plain(body) || Object.keys(body).some((k) => k !== 'note')) return bad;
  if (body.note === undefined || body.note === null || body.note === '') return { ok: true, value: { note: null } };
  return typeof body.note === 'string' && body.note.trim().length <= TAKEDOWN_NOTE_MAX ? { ok: true, value: { note: body.note.trim() || null } } : bad;
}

export type Review = { id: string; decision: 'activate'; category: string; subType: string } | { id: string; decision: 'withdraw' };
/** The review decision: `activate` needs a category and a sub-type of that category from the taxonomy; `withdraw` takes nothing else. */
export function parseReview(body: unknown): Parsed<Review> {
  if (!plain(body) || typeof body.id !== 'string' || !UUID_PATTERN.test(body.id)) return bad;
  if (body.decision === 'withdraw') return Object.keys(body).every((k) => k === 'id' || k === 'decision') ? { ok: true, value: { id: body.id, decision: 'withdraw' } } : bad;
  if (body.decision !== 'activate' || Object.keys(body).some((k) => !['id', 'decision', 'category', 'sub_type'].includes(k))) return bad;
  const { category, sub_type: subType } = body;
  return isCategory(category) && isSubType(category, subType) ? { ok: true, value: { id: body.id, decision: 'activate', category, subType } } : bad;
}
