import type {
  ArchiveReason, Collection, ItemCollection, ItemInput, OutfitInput, SavedOutfit, StoredItem,
  WardrobeRepository, WishlistEntry, WishlistInput,
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
}
const empty = (): Doc => ({ version: 1, seq: 0, items: [], outfits: [], wishlist: [] });

function read(storage: StorageLike | null): Doc {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const doc = JSON.parse(raw) as Partial<Doc>;
    if (doc.version !== 1 || !Array.isArray(doc.items) || !Array.isArray(doc.outfits) || !Array.isArray(doc.wishlist)) return empty();
    return { ...empty(), ...doc, seq: typeof doc.seq === 'number' ? doc.seq : 0 } as Doc;
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
  wishlist: Collection<WishlistEntry, WishlistInput>;

  constructor(private storage: StorageLike | null = browserStorage(), private now: () => string = () => new Date().toISOString()) {
    this.persistent = storage !== null;
    this.doc = read(storage);
    const base = this.collection<'items', StoredItem, ItemInput>('items', 'item');
    this.items = {
      ...base,
      archive: (id, reason: ArchiveReason) => base.update(id, { status: 'archived', archiveReason: reason }),
      restore: (id) => base.update(id, { status: 'active', archiveReason: null }),
    };
    this.outfits = this.collection<'outfits', SavedOutfit, OutfitInput>('outfits', 'outfit');
    this.wishlist = this.collection<'wishlist', WishlistEntry, WishlistInput>('wishlist', 'wish');
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
