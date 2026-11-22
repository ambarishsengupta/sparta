import { categoryOfSubType, colourFamily, hexToRgb, referenceSwatch } from '@sparta/taxonomy';
import { HM_DEMO_SOURCE, filterCatalogue, hmPhotoId } from './catalogue';
import { DEMO_CATALOGUE } from './demo-catalogue';
import { demoArticleForGtin } from './demo-barcodes';
import { isNoLoginDemo } from './demo-mode';
import type { CatalogueItem } from './catalogue';
import { PAGE, afterCursor, matches, newestFirst, totalsByCurrency } from './purchases';
import type { Purchase, PurchaseInput } from './purchases';
import type { CatalogueCollection } from './catalogue';
import type {
  ArchiveReason, BoughtInput, Collection, ItemCollection, ItemInput, OutfitInput, PriceContext, PurchaseCollection, SavedOutfit, StoredItem,
  WardrobeRepository, WishlistCollection, WishlistEntry, WishlistInput,
} from './repository';

/** The part of the browser's Storage the repository uses, so tests can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Bump the suffix when the stored shape changes; an unknown version is ignored, never overwritten blindly. */
export const STORAGE_KEY = 'sparta.wardrobe.v1';

interface Doc {
  version: 1;
  seq: number;
  items: StoredItem[];
  outfits: SavedOutfit[];
  wishlist: WishlistEntry[];
  /** Absent in documents saved before R6; read as none. */
  purchases: (PurchaseInput & { id: string; createdAt: string })[];
}
const empty = (): Doc => ({ version: 1, seq: 0, items: [], outfits: [], wishlist: [], purchases: [] });

function read(storage: StorageLike | null): Doc {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const doc = JSON.parse(raw) as Partial<Doc>;
    if (doc.version !== 1 || !Array.isArray(doc.items) || !Array.isArray(doc.outfits) || !Array.isArray(doc.wishlist)) return empty();
    return { ...empty(), ...doc, purchases: Array.isArray(doc.purchases) ? doc.purchases : [], seq: typeof doc.seq === 'number' ? doc.seq : 0 } as Doc;
  } catch {
    return empty();
  }
}

/** The browser's localStorage, or null where it is missing or blocked (private mode, server render). */
export function browserStorage(): StorageLike | null {
  try {
    const s = (globalThis as { localStorage?: StorageLike }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/**
 * Repository kept in one JSON document under STORAGE_KEY. Reads happen once at construction (a "reload" is a new
 * instance over the same storage); every change writes through. If storage is missing or throws, the data lives in memory
 * for this session only and `persistent` turns false.
 */
export class LocalRepository implements WardrobeRepository {
  persistent: boolean;
  private doc: Doc;
  items: ItemCollection;
  outfits: Collection<SavedOutfit, OutfitInput>;
  wishlist: WishlistCollection;
  purchases: PurchaseCollection;
  /** The browser-only demo has no profile and no exchange rates: prices show in their own currency only. */
  prices: PriceContext = { currency: async () => 'USD', rates: async () => ({}) };
  /** The bundled SYNTHETIC demo catalogue (lib/demo-catalogue.ts) unless a test passes another list; an empty list gives the picker its empty state. */
  catalogue: CatalogueCollection;

  constructor(private storage: StorageLike | null = browserStorage(), private now: () => string = () => new Date().toISOString(), catalogue: readonly CatalogueItem[] = DEMO_CATALOGUE) {
    this.catalogue = { page: async (f, after = null) => filterCatalogue(catalogue, f, after, catalogue.some((c) => c.source === HM_DEMO_SOURCE)), brands: async () => [...new Set(catalogue.flatMap((i) => i.brand ?? []))].sort(), byGtin: async (gtin) => { /* only the five demo barcodes (lib/demo-barcodes.ts) answer, in the no-login demo; the bundled items carry no barcode number */
      const a = isNoLoginDemo() ? demoArticleForGtin(gtin) : undefined;
      const item = a ? catalogue.find((c) => c.id === `hm-${a.sku}`) : undefined;
      return item ? [item] : [];
    } };
    this.persistent = storage !== null;
    this.doc = read(storage);
    const base = this.collection<'items', StoredItem, ItemInput>('items', 'item');
    this.items = {
      ...base,
      // WO-0122: an item picked from an H&M demo article keeps its photograph, like the signed-in app (photoId from the catalogue row)
      create: async (input) => {
        const picked = input.catalogue ? catalogue.find((c) => c.id === input.catalogue?.id) : undefined;
        const photoId = picked ? hmPhotoId(picked.sku, picked.source) : null;
        return base.create(photoId ? { ...input, photoId, catalogueId: picked?.id } : input);
      },
      archive: (id, reason: ArchiveReason) => base.update(id, { status: 'archived', archiveReason: reason }),
      restore: (id) => base.update(id, { status: 'active', archiveReason: null }),
      remove: async (id) => {
        const gone = await base.remove(id);
        if (gone) { this.doc.purchases = this.doc.purchases.filter((p) => p.itemId !== id); this.save(); } // like the database: an item's purchases go with it
        return gone;
      },
    };
    this.outfits = this.collection<'outfits', SavedOutfit, OutfitInput>('outfits', 'outfit');
    const wishlist = this.collection<'wishlist', WishlistEntry, WishlistInput>('wishlist', 'wish');
    this.wishlist = { ...wishlist, bought: (id, input) => this.bought(id, input, wishlist) };
    this.purchases = this.purchaseCollection();
  }

  private view(p: Doc['purchases'][number]): Purchase {
    const item = this.doc.items.find((i) => i.id === p.itemId);
    return { ...p, itemName: item?.name ?? '', category: item?.category ?? null, brand: null, photoId: item?.photoId ?? null };
  }

  private purchaseCollection(): PurchaseCollection {
    const all = () => this.doc.purchases.map((p) => this.view(p)).sort(newestFirst);
    return {
      page: async (f, after = null) => {
        const rest = all().filter((p) => matches(p, f) && afterCursor(p, after));
        const rows = rest.slice(0, PAGE);
        const last = rows[PAGE - 1];
        return { rows, next: rest.length > PAGE && last ? { date: last.date, id: last.id } : null };
      },
      totals: async (f) => totalsByCurrency(all().filter((p) => matches(p, f))),
      forItem: async (itemId) => all().filter((p) => p.itemId === itemId),
      create: async (input) => {
        if (!this.doc.items.some((i) => i.id === input.itemId)) throw new Error('unknown item');
        const row = { ...JSON.parse(JSON.stringify(input)) as PurchaseInput, id: `buy-${++this.doc.seq}`, createdAt: this.now() };
        this.doc.purchases.push(row);
        this.save();
        return this.view(row);
      },
      update: async (id, patch) => {
        const row = this.doc.purchases.find((p) => p.id === id);
        if (!row) return undefined;
        Object.assign(row, JSON.parse(JSON.stringify(patch)) as object);
        this.save();
        return this.view(row);
      },
      remove: async (id) => {
        const at = this.doc.purchases.findIndex((p) => p.id === id);
        if (at < 0) return false;
        this.doc.purchases.splice(at, 1);
        this.save();
        return true;
      },
    };
  }

  /** The entry becomes an item (its attributes, the given colour when it has none) and a purchase, then leaves the wishlist. */
  private async bought(id: string, input: BoughtInput, wishlist: Collection<WishlistEntry, WishlistInput>): Promise<string> {
    const entry = await wishlist.get(id);
    if (!entry) throw new Error('entry not found');
    const hex = input.colourHex ?? (entry.colourFamily && entry.colourFamily !== 'Multi' ? referenceSwatch(entry.colourFamily)?.hex : undefined);
    if (!hex) throw new Error('a colour is needed');
    const rgb = hexToRgb(hex);
    const item = await this.items.create({
      name: entry.name, category: categoryOfSubType(entry.subType)!, subType: entry.subType, hex: hex.toUpperCase(), rgb, colourFamily: colourFamily(...rgb) as ItemInput['colourFamily'],
      fit: null, material: null, pattern: null, seasons: [], occasions: [], condition: null, favourite: false, neverWorn: false, status: 'active', archiveReason: null,
    });
    await this.purchases.create({ ...input.purchase, itemId: item.id });
    await wishlist.remove(id);
    return item.id;
  }

  private save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.doc));
    } catch {
      this.persistent = false; // quota or blocked: keep working in memory
    }
  }

  private collection<K extends 'items' | 'outfits' | 'wishlist', T extends { id: string; createdAt: string }, N>(
    key: K, prefix: string,
  ): Collection<T, N> {
    const rows = (): T[] => this.doc[key] as unknown as T[];
    const copy = <R>(row: R): R => JSON.parse(JSON.stringify(row)) as R;
    return {
      list: async () => rows().map(copy).reverse(),
      get: async (id) => { const r = rows().find((x) => x.id === id); return r && copy(r); },
      create: async (input) => {
        const at = this.now();
        const row = { ...copy(input), id: `${prefix}-${++this.doc.seq}`, createdAt: at, ...(key === 'items' ? { updatedAt: at } : {}) } as unknown as T;
        rows().push(row);
        this.save();
        return copy(row);
      },
      update: async (id, patch) => {
        const row = rows().find((x) => x.id === id);
        if (!row) return undefined;
        Object.assign(row, copy(patch), { id, createdAt: row.createdAt });
        if ('updatedAt' in row) (row as { updatedAt: string }).updatedAt = this.now();
        this.save();
        return copy(row);
      },
      remove: async (id) => {
        const list = rows();
        const at = list.findIndex((x) => x.id === id);
        if (at < 0) return false;
        list.splice(at, 1);
        this.save();
        return true;
      },
    };
  }
}

let shared: LocalRepository | null = null;
/** One repository per page load, over the browser's localStorage. */
export function sharedRepository(): LocalRepository {
  return (shared ??= new LocalRepository());
}
