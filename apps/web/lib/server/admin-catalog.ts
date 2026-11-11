import type { SupabaseClient } from '@supabase/supabase-js';
import { mayAllow, parseReview, parseSource, parseTakedown, sourceIdOf } from '../admin-catalog';
import { fail, ok } from './api';
import { originAllowed } from './purge';

/** The admin catalogue routes of LLD 6 (WO-0088, FR-100 to FR-103): the source register, take-down and the review queue.
 * `caller` is the person's own session client (who they are, their role, the take-down function, which checks the role again); `admin` is the secret-key
 * client the route built after this module is handed it (it is never created here). Every call that gets past the checks writes ONE audit row
 * BEFORE it acts, through `app.write_admin_audit`: if the row cannot be written, nothing is done. A target is a row id or nothing; never free text. */
export interface AdminDeps { caller: SupabaseClient; admin: SupabaseClient }
const MAX_BODY = 20_000;
const SOURCE_COLUMNS = 'id,name,site_url,robots_allowed,terms_note,allowed,checked_on,contact,last_collected_at,takedown_at,takedown_note';
const REVIEW_COLUMNS = 'id,source_id,sku,name,brand,category,sub_type,colour_hex,price,currency,product_url';
const sources = (d: AdminDeps) => d.admin.schema('catalog').from('sources');
const items = (d: AdminDeps) => d.admin.schema('catalog').from('catalog_items');

/** The admin's id, or the refusal: another site's request 403 (mutating calls), no session 401, any role but admin 403 (the role is read from the database, not from a claim). */
async function adminId(request: Request, d: AdminDeps, mutating: boolean): Promise<string | Response> {
  if (mutating && !originAllowed(request)) return fail('forbidden');
  const who = await d.caller.auth.getUser();
  if (who.error && (who.error.status ?? 500) >= 500) return fail('unavailable');
  if (who.error || !who.data.user) return fail('not_signed_in');
  const role = await d.caller.schema('app').rpc('current_role');
  if (role.error) return fail('server_error');
  return role.data === 'admin' ? who.data.user.id : fail('forbidden');
}
const audit = async (d: AdminDeps, id: string, action: string, target: string | null): Promise<boolean> =>
  !(await d.admin.schema('app').rpc('write_admin_audit', { p_admin: id, p_action: action, p_target: target })).error;
/** The JSON body: `undefined` when there is none, `null` when it is too large or not JSON (the caller answers 400). */
async function bodyOf(request: Request): Promise<unknown> {
  try { const t = await request.text(); if (t.length > MAX_BODY) return null; return t === '' ? undefined : JSON.parse(t); } catch { return null; }
}
const guarded = async (run: () => Promise<Response>): Promise<Response> => { try { return await run(); } catch { return fail('server_error'); } };

export const listSources = (request: Request, d: AdminDeps): Promise<Response> => guarded(async () => {
  const id = await adminId(request, d, false);
  if (typeof id !== 'string') return id;
  if (!(await audit(d, id, 'source.list', null))) return fail('server_error');
  const r = await sources(d).select(SOURCE_COLUMNS).order('id');
  return r.error ? fail('server_error') : ok({ sources: r.data });
});

export const createSource = (request: Request, d: AdminDeps): Promise<Response> => guarded(async () => {
  const id = await adminId(request, d, true);
  if (typeof id !== 'string') return id;
  const parsed = parseSource(await bodyOf(request), 'create');
  if (!parsed.ok) return fail('bad_request');
  if (parsed.value.fields.allowed && !mayAllow(parsed.value.fields)) return fail('allow_refused');
  if (!(await audit(d, id, 'source.create', null))) return fail('server_error');
  const r = await sources(d).insert(parsed.value.fields).select(SOURCE_COLUMNS).single();
  return r.error ? fail('server_error') : ok({ source: r.data });
});

/** A re-allow of a taken-down source also clears `takedown_at` in the same update (the database refuses `allowed` while it is set; the audit action says so). */
export const updateSource = (request: Request, d: AdminDeps): Promise<Response> => guarded(async () => {
  const id = await adminId(request, d, true);
  if (typeof id !== 'string') return id;
  const parsed = parseSource(await bodyOf(request), 'update');
  if (!parsed.ok || parsed.value.id === undefined) return fail('bad_request');
  const { id: sourceId, fields } = parsed.value;
  const current = await sources(d).select(SOURCE_COLUMNS).eq('id', sourceId).maybeSingle();
  if (current.error) return fail('server_error');
  if (!current.data) return fail('source_not_found');
  const merged = { ...current.data, ...fields };
  if (merged.allowed === true && !mayAllow(merged)) return fail('allow_refused');
  const reallow = fields.allowed === true && current.data.takedown_at !== null;
  if (!(await audit(d, id, reallow ? 'source.reallow' : 'source.update', String(sourceId)))) return fail('server_error');
  const r = await sources(d).update(reallow ? { ...fields, takedown_at: null } : fields).eq('id', sourceId).select(SOURCE_COLUMNS).single();
  return r.error ? fail('server_error') : ok({ source: r.data });
});

/** FR-103: `catalog.take_down_source` runs as the caller (it checks the admin role itself): the items go, the source row stays with `allowed = false`. */
export const takeDownSource = (request: Request, d: AdminDeps, rawId: string): Promise<Response> => guarded(async () => {
  const id = await adminId(request, d, true);
  if (typeof id !== 'string') return id;
  const sourceId = sourceIdOf(rawId);
  const parsed = parseTakedown(await bodyOf(request));
  if (sourceId === null || !parsed.ok) return fail('bad_request');
  if (!(await audit(d, id, 'source.takedown', String(sourceId)))) return fail('server_error');
  const r = await d.caller.schema('catalog').rpc('take_down_source', { p_source: sourceId, p_note: parsed.value.note });
  if (r.error) return fail(r.error.code === 'P0002' ? 'source_not_found' : r.error.code === '42501' ? 'forbidden' : r.error.code === '22023' ? 'bad_request' : 'server_error');
  return ok({ deleted: r.data });
});

export const listReview = (request: Request, d: AdminDeps): Promise<Response> => guarded(async () => {
  const id = await adminId(request, d, false);
  if (typeof id !== 'string') return id;
  if (!(await audit(d, id, 'catalog.review.list', null))) return fail('server_error');
  const r = await items(d).select(REVIEW_COLUMNS).eq('status', 'review').order('name').order('id').limit(100);
  return r.error ? fail('server_error') : ok({ items: r.data });
});

/** FR-102: a review row becomes `active` only with a category and sub-type pair of the taxonomy, or `withdrawn`; rows in any other status are not touched. */
export const decideReview = (request: Request, d: AdminDeps): Promise<Response> => guarded(async () => {
  const id = await adminId(request, d, true);
  if (typeof id !== 'string') return id;
  const parsed = parseReview(await bodyOf(request));
  if (!parsed.ok) return fail('bad_request');
  const v = parsed.value;
  if (!(await audit(d, id, `catalog.review.${v.decision}`, v.id))) return fail('server_error');
  const patch = v.decision === 'activate' ? { status: 'active', category: v.category, sub_type: v.subType } : { status: 'withdrawn' };
  const r = await items(d).update(patch).eq('id', v.id).eq('status', 'review').select('id');
  if (r.error) return fail('server_error');
  return r.data.length === 0 ? fail('item_not_found') : ok({ id: v.id, status: patch.status });
});
