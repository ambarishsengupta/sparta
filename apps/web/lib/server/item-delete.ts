import { fail, ok, UUID, type StorageLike } from './api';
import type { RouteLimit } from './limits';
import { originAllowed } from './purge';

/** `/api/items/[id]` DELETE (LLD 6, FR-16, WO-0183): deletes one item of the caller for good, with its image and thumbnail.
 *
 * `authenticated` has no delete right on `app.items` (LLD 4.6), so this route is the only way. The order is the point:
 *  1. the item is read with the CALLER's session, so row-level security decides who owns it and whether consent holds; a missing item, an item of someone else and an id that is
 *     not a UUID all get the same 404, and the route reveals nothing about which it was;
 *  2. the two objects are removed from `item-images` with the secret-key client's storage (an object that is already gone is not an error);
 *  3. the row is deleted last, with the secret-key client, matched on the id AND on the caller's user id (purchases and outfit links cascade in the database).
 * A storage failure stops at step 2: the row stays, so the person can try again and no row ever points at nothing it did not already point at. The ids and paths are never echoed. */
export interface ItemPaths { image_path: string | null; image_thumb_path: string | null }
export interface ItemDeleteDeps {
  /** The caller's own session (the server client). */
  getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
  /** Reads the item through the caller's session (row-level security applies). `data` is null when there is no such row for this caller. */
  readItem(id: string): PromiseLike<{ data: ItemPaths | null; error: unknown }>;
  /** The secret-key client's storage. */
  storage: StorageLike;
  /** Deletes the row with the secret-key client, matched on id and user id. `data` lists the rows deleted. */
  deleteRow(id: string, uid: string): PromiseLike<{ data: unknown[] | null; error: unknown }>;
  /** The per-process brake and the shared count. The route always passes it (pinned by route.test.ts). */
  limit?: RouteLimit;
  publicOrigin?: string | null;
}

export const ITEM_BUCKET = 'item-images';
/** LLD section 10 ("Rate limiting") names no figure for deleting an item. This route counts per person in the database (every instance): at most 30 deletions in 600 seconds. The purge route's 6 in 600
 * seconds was too tight: it protects a call that empties a whole account, once, while clearing out a wardrobe is many deletions in a row. 30 stops a runaway script and does not stop a person.
 * The per-process brake is the purge route's (WO-0130): 30 per minute over all callers of one process. */
export const ITEM_DELETE_LIMIT = { max: 30, windowSeconds: 600 } as const;
export const ITEM_DELETE_BRAKE = { max: 30, windowMs: 60_000 } as const;

export async function handleItemDelete(req: Request, id: string, deps: ItemDeleteDeps): Promise<Response> {
  if (req.method !== 'DELETE') return fail('method_not_allowed');
  if (!originAllowed(req, deps.publicOrigin)) return fail('forbidden');

  let uid: string;
  try {
    const { data, error } = await deps.getUser();
    if (error || !data.user) return fail('not_signed_in');
    uid = data.user.id;
  } catch { return fail('unavailable'); }
  if (!UUID.test(uid)) return fail('server_error');
  // The shared count first, then the per-process brake (as handlePurge: a call the person's own limit refuses must not use up the brake everyone shares). Fail closed when the count cannot be read.
  if (deps.limit) { try { if (!(await deps.limit.count(`item-delete:${uid}`))) return fail('rate_limited'); } catch { return fail('unavailable'); } }
  if (deps.limit && !deps.limit.brake()) return fail('rate_limited');

  if (!UUID.test(id)) return fail('item_not_found');
  let item: ItemPaths | null;
  try {
    const r = await deps.readItem(id);
    if (r.error) return fail('unavailable');
    item = r.data;
  } catch { return fail('unavailable'); }
  if (!item) return fail('item_not_found');

  // The database already holds each path to `<user id>/<one file name>` (WO-0075); it is checked again here so that nothing outside the caller's own folder can ever be removed.
  const paths = [...new Set([item.image_path, item.image_thumb_path].filter((p): p is string => typeof p === 'string' && p !== ''))];
  if (paths.some((p) => !p.startsWith(`${uid}/`) || p.includes('..'))) return fail('server_error');
  if (paths.length > 0) {
    try { const r = await deps.storage.from(ITEM_BUCKET).remove(paths); if (r.error) return fail('storage_unavailable'); } catch { return fail('storage_unavailable'); }
  }
  try {
    const r = await deps.deleteRow(id, uid);
    if (r.error) return fail('server_error');
    if (!r.data || r.data.length === 0) return fail('item_not_found');   // gone already (a second press): the files were removed above too
  } catch { return fail('server_error'); }
  return ok({ ok: true });
}
