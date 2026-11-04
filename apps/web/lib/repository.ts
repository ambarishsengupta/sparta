import type { Fit, Material, SubType } from '@sparta/taxonomy';
import type { Item, ItemId, Slot } from '@sparta/rules';
import type { Occasion } from '@sparta/taxonomy';

export type ArchiveReason = 'sold' | 'donated' | 'discarded' | 'lost';

/** What the engine reads (`Item`) plus the fields only the screens use (FDD 13). */
export interface StoredItem extends Item {
  hex: string;
  fit: Fit | null;
  material: Material | null;
  neverWorn: boolean;
  archiveReason: ArchiveReason | null;
  createdAt: string;
  updatedAt: string;
}
export type ItemInput = Omit<StoredItem, 'id' | 'createdAt' | 'updatedAt'>;

export interface SavedOutfit {
  id: string;
  occasion: Occasion;
  items: Record<Slot, ItemId | null>;
  score: number;
  reasons: string[];
  createdAt: string;
}
export type OutfitInput = Omit<SavedOutfit, 'id' | 'createdAt'>;

export interface WishlistEntry {
  id: string;
  name: string;
  subType: SubType;
  note: string | null;
  createdAt: string;
}
export type WishlistInput = Omit<WishlistEntry, 'id' | 'createdAt'>;

/** One collection. Every call is async so a network-backed implementation (R2, Supabase) fits the same interface. */
export interface Collection<T extends { id: string }, N> {
  /** Newest first. */
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  create(input: N): Promise<T>;
  update(id: string, patch: Partial<N>): Promise<T | undefined>;
  /** Permanent delete; false when the id is unknown. */
  remove(id: string): Promise<boolean>;
}

export interface ItemCollection extends Collection<StoredItem, ItemInput> {
  /** Archived items leave the active wardrobe and stay out of suggestions (FR-15). */
  archive(id: string, reason: ArchiveReason): Promise<StoredItem | undefined>;
  restore(id: string): Promise<StoredItem | undefined>;
}

export interface WardrobeRepository {
  items: ItemCollection;
  outfits: Collection<SavedOutfit, OutfitInput>;
  wishlist: Collection<WishlistEntry, WishlistInput>;
}
