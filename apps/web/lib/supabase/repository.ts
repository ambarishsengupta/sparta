import type { SupabaseClient } from '@supabase/supabase-js';
import type { FxRates } from '../money';
import { CATALOGUE_PAGE, CATALOGUE_SELECT, catalogueFromRow, cleanCatalogueFilter, parseStyle } from '../catalogue';
import type { CatalogueCollection, CatalogueCursor, CataloguePage } from '../catalogue';
import { PAGE, totalsByCurrency } from '../purchases';
import type { Cursor, Page, Purchase, PurchaseFilter } from '../purchases';
import type { Collection, FeedbackSink, ItemCollection, ItemInput, OutfitInput, PriceContext, PurchaseCollection, SavedOutfit, StoredItem, WardrobeRepository, WishlistCollection, WishlistEntry, WishlistInput } from '../repository';
import { RepositoryError, asRepositoryError, classify } from './errors';
import {
  ITEM_SELECT, OUTFIT_SELECT, PURCHASE_SELECT, WISHLIST_SELECT, boughtArgs, cleanCursor, cleanFilter, featuresRow, likePattern, purchaseFromRow, purchasePatch, purchaseRow, feedbackRow, itemFromRow, itemPatch, itemRow, outfitFromRow, outfitPatch, outfitRows, wishlistFromRow, wishlistPatch, wishlistRow,
} from './mapping';

type Row = Record<string, unknown>;
type Answer = { data: unknown; error: { code?: string | null; message?: string | null; name?: string | null } | null; status?: number };
type Client = Pick<SupabaseClient, 'auth' | 'schema'>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The data of an answer, or the classified failure. `write` picks the wording ("your change was not saved" only for changes). */
const take = (a: Answer, write: boolean): unknown => { if (a.error) throw classify({ status: a.status ?? 500, error: a.error }, write); return a.data; };
const guard = async <T>(write: boolean, f: () => PromiseLike<T>): Promise<T> => { try { return await f(); } catch (e) { throw asRepositoryError(e, write); } };
/** A value inside a PostgREST `or(...)` list: double-quoted, so commas, brackets and dots in a name cannot change the filter. */
const quoted = (s: string): string => `"${s.replace(/[\\"]/g, '\\$&')}"`;
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
  wishlist: WishlistCollection;
  purchases: PurchaseCollection;
  prices: PriceContext;
  catalogue: CatalogueCollection;
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
    const wish = this.table<WishlistEntry, WishlistInput>('wishlist_entries', WISHLIST_SELECT, wishlistFromRow, wishlistRow, wishlistPatch);
    this.wishlist = {
      ...wish,
      // an entry already marked bought has left the wishlist: only open ones are listed
      list: () => guard(false, async () => ((take((await this.app().from('wishlist_entries').select(WISHLIST_SELECT).eq('status', 'open').order('created_at', { ascending: false })) as Answer, false) as Row[] | null) ?? []).flatMap((r) => wishlistFromRow(r))),
      bought: (id, input) => guard(true, async () => {
        if (!UUID.test(id)) throw new RepositoryError('rejected', true);
        const id2 = take((await this.app().rpc('wishlist_bought', boughtArgs(id, input.purchase, input.colourHex))) as Answer, true);
        return typeof id2 === 'string' ? id2 : Promise.reject(new RepositoryError('unexpected', true));
      }),
    };
    this.purchases = this.purchaseCollection();
    this.prices = {
      currency: () => guard(false, async () => {
        const row = take((await this.app().from('profiles').select('currency').eq('id', await this.uid()).maybeSingle()) as Answer, false) as Row | null;
        return typeof row?.currency === 'string' ? row.currency : 'USD';
      }),
      rates: () => guard(false, async () => {
        const rows = (take((await this.app().rpc('latest_fx_rates')) as Answer, false) as Row[] | null) ?? [];
        const out: FxRates = {};
        for (const r of rows) if (typeof r.currency === 'string' && typeof r.rate_date === 'string' && Number(r.per_usd) > 0) out[r.currency] = { rateDate: r.rate_date, perUsd: Number(r.per_usd) };
        return out;
      }),
    };
    this.catalogue = this.catalogueCollection();
    this.feedback = { record: async (facts) => {
      try {
        const row = feedbackRow(facts, await this.uid());
        if (row) take((await this.app().from('suggestion_feedback').insert(row)) as Answer, true);
        return true;
      } catch { return false; }
    } };
  }

  private app() { return this.client.schema('app'); }

  /** The active catalogue rows, read with the person's own session (row-level security shows consumers active rows only; `status = 'active'` is asked for as well). Name then id, 40 per page. */
  private catalogueCollection(): CatalogueCollection {
    const table = () => this.client.schema('catalog').from('catalog_items');
    return {
      page: (filter, after) => guard(false, async (): Promise<CataloguePage> => {
        const f = cleanCatalogueFilter(filter);
        const c: CatalogueCursor | null = after && typeof after.name === 'string' && UUID.test(after.id) ? after : null;
        let q = table().select(CATALOGUE_SELECT).eq('status', 'active');
        if (f.q) q = q.or(`name.ilike.${quoted(likePattern(f.q))},brand.ilike.${quoted(likePattern(f.q))}`);
        if (f.category) q = q.eq('category', f.category);
        if (f.brand) q = q.eq('brand', f.brand);
        if (f.colourFamily) q = q.eq('colour_family', f.colourFamily);
        const style = parseStyle(f.style);
        if (style) q = style.kind === 'occasion' ? q.contains('occasions', [style.value]) : q.eq(style.kind, style.value);
        if (c) q = q.or(`name.gt.${quoted(c.name)},and(name.eq.${quoted(c.name)},id.gt.${c.id})`);
        const rows = (take((await q.order('name', { ascending: true }).order('id', { ascending: true }).limit(CATALOGUE_PAGE + 1)) as Answer, false) as Row[] | null) ?? [];
        const last = rows[CATALOGUE_PAGE - 1];
        return { rows: rows.slice(0, CATALOGUE_PAGE).flatMap((r) => catalogueFromRow(r) ?? []), next: rows.length > CATALOGUE_PAGE && last ? { name: String(last.name), id: String(last.id) } : null };
      }),
      byGtin: (gtin) => guard(false, async () => {
        if (!/^[0-9]{14}$/.test(gtin)) return [];
        const rows = (take((await table().select(CATALOGUE_SELECT).eq('status', 'active').eq('gtin', gtin).order('name', { ascending: true }).order('id', { ascending: true }).limit(20)) as Answer, false) as Row[] | null) ?? [];
        return rows.flatMap((r) => catalogueFromRow(r) ?? []);
      }),
      brands: () => guard(false, async () => {
        const rows = (take((await table().select('brand').eq('status', 'active').not('brand', 'is', null).order('brand').limit(1000)) as Answer, false) as Row[] | null) ?? [];
        return [...new Set(rows.flatMap((r) => (typeof r.brand === 'string' && r.brand !== '' ? r.brand : [])))];
      }),
    };
  }

  /** The purchases that match the filter (a dated row of the signed-in person; row-level security does the rest), inner-joined to their item for brand and category. */
  private purchaseQuery(filter: PurchaseFilter, select: string) {
    const f = cleanFilter(filter);
    let q = this.app().from('purchases').select(select).not('purchase_date', 'is', null);
    if (f.store) q = q.ilike('store', likePattern(f.store));
    if (f.brand) q = q.ilike('items.brand', likePattern(f.brand));
    if (f.category) q = q.eq('items.category', f.category);
    if (f.from) q = q.gte('purchase_date', f.from);
    if (f.to) q = q.lte('purchase_date', f.to);
    return q;
  }

  private purchaseCollection(): PurchaseCollection {
    const read = (rows: unknown) => ((rows as Row[] | null) ?? []).flatMap((r) => purchaseFromRow(r) ?? []);
    const byId = async (id: string): Promise<Purchase | undefined> => {
      const r = UUID.test(id) ? take((await this.app().from('purchases').select(PURCHASE_SELECT).eq('id', id).maybeSingle()) as Answer, false) : null;
      return r ? read([r])[0] : undefined;
    };
    return {
      page: (filter, after) => guard(false, async (): Promise<Page> => {
        const c: Cursor | null = cleanCursor(after);
        let q = this.purchaseQuery(filter, PURCHASE_SELECT);
        if (c) q = q.or(`purchase_date.lt.${c.date},and(purchase_date.eq.${c.date},id.lt.${c.id})`);
        const rows = (take((await q.order('purchase_date', { ascending: false }).order('id', { ascending: false }).limit(PAGE + 1)) as Answer, false) as Row[] | null) ?? [];
        const last = rows[PAGE - 1];
        return { rows: read(rows.slice(0, PAGE)), next: rows.length > PAGE && last ? { date: String(last.purchase_date), id: String(last.id) } : null };
      }),
      totals: (filter) => guard(false, async () => {
        const all: Purchase[] = [];
        for (let from = 0; from < 20_000; from += 1000) { // PostgREST answers at most 1000 rows at a time
          const rows = (take((await this.purchaseQuery(filter, PURCHASE_SELECT).order('id').range(from, from + 999)) as Answer, false) as Row[] | null) ?? [];
          all.push(...read(rows));
          if (rows.length < 1000) break;
        }
        return totalsByCurrency(all);
      }),
      forItem: (itemId) => (UUID.test(itemId) ? guard(false, async () => read(take((await this.app().from('purchases').select(PURCHASE_SELECT).eq('item_id', itemId).order('purchase_date', { ascending: false, nullsFirst: false }).order('id', { ascending: false })) as Answer, false))) : Promise.resolve([])),
      create: (input) => guard(true, async () => {
        const made = take((await this.app().from('purchases').insert(purchaseRow(input, await this.uid())).select('id').single()) as Answer, true) as { id: string };
        return (await byId(made.id)) ?? Promise.reject(new RepositoryError('unexpected', true));
      }),
      update: (id, patch) => {
        const row = purchasePatch(patch);
        if (!UUID.test(id) || Object.keys(row).length === 0) return byId(id);
        return guard(true, async () => { take((await this.app().from('purchases').update(row).eq('id', id)) as Answer, true); return byId(id); });
      },
      remove: (id) => (UUID.test(id) ? guard(true, async () => ((take((await this.app().from('purchases').delete().eq('id', id).select('id')) as Answer, true) as Row[] | null) ?? []).length > 0) : Promise.resolve(false)),
    };
  }

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
      update: (id, p) => guard(true, async () => patch(p)).then((row) => {
        if (!UUID.test(id) || Object.keys(row).length === 0) return get(id);
        return guard(true, async () => one(take((await t().update(row).eq('id', id).select(select).maybeSingle()) as Answer, true)));
      }),
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
