import type { ColourFamily, Fit, Material, SubType } from '@sparta/taxonomy';
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
  /** The engine's score; null once the person has swapped a piece, because the edited outfit was not scored. */
  score: number | null;
  reasons: string[];
  createdAt: string;
}
export type OutfitInput = Omit<SavedOutfit, 'id' | 'createdAt'>;

/** `unlock` marks an entry made by Wardrobe unlock (FR-59b); it never counts toward vendor figures (see lib/wishlist.ts). */
export type WishlistOrigin = 'user' | 'unlock';
export interface WishlistEntry {
  id: string;
  name: string;
  subType: SubType;
  /** Both optional so entries saved before R4 still read; no origin means 'user'. */
  colourFamily?: ColourFamily | null;
  origin?: WishlistOrigin;
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

/** What a suggestion answer tells the rule-tuning table (FDD 16): the occasion, the rules involved and the engine switches, never an item id or name. */
export interface FeedbackFacts { type: string; occasion: string | null; engine_config: string; rule_ids: readonly string[] }
export interface FeedbackSink {
  /** Sends one accepted or rejected suggestion; any other type is ignored. Never throws: false means it could not be stored. */
  record(facts: FeedbackFacts): Promise<boolean>;
}

export interface WardrobeRepository {
  items: ItemCollection;
  outfits: Collection<SavedOutfit, OutfitInput>;
  wishlist: Collection<WishlistEntry, WishlistInput>;
  /** Only the account-backed repository has one; the local repository keeps just its event log. */
  feedback?: FeedbackSink;
}
