import type { SupabaseClient } from '@supabase/supabase-js';
import type { Collection, FeedbackSink, ItemCollection, ItemInput, OutfitInput, SavedOutfit, StoredItem, WardrobeRepository, WishlistEntry, WishlistInput } from '../repository';
import { RepositoryError, asRepositoryError, classify } from './errors';
import {
  ITEM_SELECT, OUTFIT_SELECT, WISHLIST_SELECT, featuresRow, feedbackRow, itemFromRow, itemPatch, itemRow, outfitFromRow, outfitPatch, outfitRows, wishlistFromRow, wishlistPatch, wishlistRow,
} from './mapping';

type Row = Record<string, unknown>;
type Answer = { data: unknown; error: { code?: string | null; message?: string | null; name?: string | null } | null; status?: number };
type Client = Pick<SupabaseClient, 'auth' | 'schema'>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The data of an answer, or the classified failure. `write` picks the wording ("your change was not saved" only for changes). */
const take = (a: Answer, write: boolean): unknown => { if (a.error) throw classify({ status: a.status ?? 500, error: a.error }, write); return a.data; };
const guard = async <T>(write: boolean, f: () => PromiseLike<T>): Promise<T> => { try { return await f(); } catch (e) { throw asRepositoryError(e, write); } };
const unsupported = (message: string): Promise<never> => Promise.reject(new RepositoryError('unsupported', true, message));

/**
 * The wardrobe in the signed-in person's Supabase account (WO-0052), over PostgREST with that person's own session and the publishable
 * key. Row-level security does the isolation: another person's id reads as "not found" and updates nothing. Nothing is cached, and a
 * failed call throws a `RepositoryError` (a fixed sentence per kind) instead of returning stale or empty data, so a screen can never
 * show an empty wardrobe for a network failure or drop a change without saying so.
 */
export class SupabaseRepository implements WardrobeRepository {
  items: ItemCollection;
  outfits: Collection<SavedOutfit, OutfitInput>;
  wishlist: Collection<WishlistEntry, WishlistInput>;
  feedback: FeedbackSink;

  constructor(private client: Client, private now: () => string = () => new Date().toISOString()) {
    const base = this.table<StoredItem, ItemInput>('items', ITEM_SELECT, itemFromRow, (n, uid) => itemRow(n, uid, this.now()), itemPatch);
    this.items = {
      ...base,
      create: (n) => this.createItem(n, base),
      archive: (id, reason) => this.setItem(id, { status: 'archived', archive_reason: reason, archived_at: this.now() }),
      restore: (id) => this.setItem(id, { status: 'active', archive_reason: null, archived_at: null }),
      remove: () => unsupported('Deleting an item is not available yet. Archive it instead: it leaves your wardrobe and your suggestions.'),
    };
    const outfits = this.table<SavedOutfit, OutfitInput>('outfits', OUTFIT_SELECT, outfitFromRow, () => ({}), outfitPatch);
    this.outfits = { ...outfits, create: (n) => this.createOutfit(n, outfits), update: (id, p) => this.updateOutfit(id, p, outfits) };
    this.wishlist = this.table<WishlistEntry, WishlistInput>('wishlist_entries', WISHLIST_SELECT, wishlistFromRow, wishlistRow, wishlistPatch);
    this.feedback = { record: async (facts) => {
      try {
        const row = feedbackRow(facts, await this.uid());
        if (row) take((await this.app().from('suggestion_feedback').insert(row)) as Answer, true);
        return true;
      } catch { return false; }
    } };
  }

  private app() { return this.client.schema('app'); }

  /**
   * The item row, then (only for an item added by photo whose result carried features) its `item_features` row. The features only order swap
   * choices, so a failure to store them never undoes or fails the save: the item exists and is returned (WO-0073; PostgREST has no transaction here).
   */
  private async createItem(input: ItemInput, base: Collection<StoredItem, ItemInput>): Promise<StoredItem> {
    const item = await base.create(input);
    const features = input.photo?.features;
    if (features) {
      try {
        const row = featuresRow(item.id, await this.uid(), features);
        if (row) take((await this.app().from('item_features').insert(row)) as Answer, true);
      } catch { /* the item is saved; only the shape numbers are missing */ }
    }
    return item;
  }

  /** The signed-in person's id, from the session the browser already holds. Row-level security checks it again on every write. */
  private async uid(): Promise<string> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw classify({ status: error.status ?? 0, error }, true);
    if (!data.session) throw new RepositoryError('session', true);
    return data.session.user.id;
  }

  /** Archive and restore in one request, with the clock for archived_at (itemPatch has none). */
  private async setItem(id: string, patch: Row): Promise<StoredItem | undefined> {
    if (!UUID.test(id)) return undefined;
    return guard(true, async () => { const r = take((await this.app().from('items').update(patch).eq('id', id).select(ITEM_SELECT).maybeSingle()) as Answer, true) as Row | null; return r ? itemFromRow(r) : undefined; });
  }

  private table<T extends { id: string }, N>(name: string, select: string, from: (r: Row) => T | null, insert: (n: N, uid: string) => Row, patch: (p: Partial<N>) => Row): Collection<T, N> {
    const t = () => this.app().from(name);
    const one = (r: unknown): T | undefined => (r ? from(r as Row) ?? undefined : undefined);
    const get = (id: string) => (UUID.test(id) ? guard(false, async () => one(take((await t().select(select).eq('id', id).maybeSingle()) as Answer, false))) : Promise.resolve(undefined));
    return {
      list: () => guard(false, async () => ((take((await t().select(select).order('created_at', { ascending: false })) as Answer, false) as Row[] | null) ?? []).flatMap((r) => from(r) ?? [])),
      get,
      create: (n) => guard(true, async () => one(take((await t().insert(insert(n, await this.uid())).select(select).single()) as Answer, true)) ?? Promise.reject(new RepositoryError('unexpected', true))),
      update: (id, p) => {
        const row = patch(p);
        if (!UUID.test(id) || Object.keys(row).length === 0) return get(id);
        return guard(true, async () => one(take((await t().update(row).eq('id', id).select(select).maybeSingle()) as Answer, true)));
      },
      remove: (id) => (UUID.test(id) ? guard(true, async () => ((take((await t().delete().eq('id', id).select('id')) as Answer, true) as Row[] | null) ?? []).length > 0) : Promise.resolve(false)),
    };
  }

  /** The outfit row, then its pieces. If the pieces fail the outfit is removed again, so no empty outfit is left behind. */
  private createOutfit(input: OutfitInput, outfits: Collection<SavedOutfit, OutfitInput>): Promise<SavedOutfit> {
    return guard(true, async () => {
      const { outfit, pieces } = outfitRows(input, await this.uid());
      const made = take((await this.app().from('outfits').insert(outfit).select('id').single()) as Answer, true) as { id: string };
      try {
        if (pieces.length > 0) take((await this.app().from('outfit_items').insert(pieces.map((p) => ({ ...p, outfit_id: made.id })))) as Answer, true);
      } catch (e) {
        await this.app().from('outfits').delete().eq('id', made.id); // best effort; the error below is what the person sees
        throw e;
      }
      return (await outfits.get(made.id))!;
    });
  }

  /** Pieces are added or moved first and the ones no longer used are removed last, so a failure part-way never leaves an outfit without its pieces. */
  private updateOutfit(id: string, patch: Partial<OutfitInput>, outfits: Collection<SavedOutfit, OutfitInput>): Promise<SavedOutfit | undefined> {
    return guard(true, async () => {
      const current = await outfits.get(id);
      if (!current) return undefined;
      const next = { ...current, ...patch };
      const { outfit, pieces: loose } = outfitRows(next, await this.uid());
      const pieces = loose.map((p) => ({ ...p, outfit_id: id }));
      take((await this.app().from('outfits').update({ ...outfitPatch(patch), notes: outfit.notes }).eq('id', id)) as Answer, true);
      if (patch.items) {
        if (pieces.length > 0) take((await this.app().from('outfit_items').upsert(pieces, { onConflict: 'outfit_id,item_id' })) as Answer, true);
        const keep = loose.map((p) => p.item_id as string);
        const q = this.app().from('outfit_items').delete().eq('outfit_id', id);
        take((await (keep.length > 0 ? q.not('item_id', 'in', `(${keep.join(',')})`) : q)) as Answer, true);
      }
      return outfits.get(id);
    });
  }
}
