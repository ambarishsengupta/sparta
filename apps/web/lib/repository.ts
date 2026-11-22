import type { ColourFamily, Fit, Material, SubType } from '@sparta/taxonomy';
import type { Item, ItemId, Slot } from '@sparta/rules';
import type { Occasion } from '@sparta/taxonomy';
import type { CatalogueAttachment, CatalogueCollection } from './catalogue';
import type { FxRates } from './money';
import type { Cursor, CurrencyTotal, Page, Purchase, PurchaseDraft, PurchaseFilter, PurchaseInput } from './purchases';

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
  /** Set when the item was picked from a catalogue row (`catalog_item_id`); `photoId` is the H&M article id when that row is of the `hm-demo` source (WO-0121). */
  catalogueId?: string;
  photoId?: string;
}
/** What the garment model returned for a photo (LLD 7.3), kept in `item_features` for swap ordering. Only ever present when the worker's result carried it. */
export interface PhotoFeatures { modelVersion: string; garmentClass: number | null; p: number | null; embedding: number[] }
/** The stored picture of an item added by photo (the cut-out or the original, with its thumbnail) and, when the model ran, its features (WO-0073). */
export interface PhotoAttachment { imagePath: string; imageThumbPath: string | null; features: PhotoFeatures | null }
/** `catalogue`: the item was picked from the catalogue (origin `catalogue`, the link `catalog_item_id`, the brand and the size, WO-0085). */
/** `barcode`: the 14-digit padded GTIN a lookup was made with (FR-26), kept in `items.barcode` (WO-0088). */
export type ItemInput = Omit<StoredItem, 'id' | 'createdAt' | 'updatedAt'> & { photo?: PhotoAttachment; catalogue?: CatalogueAttachment; barcode?: string };

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
  /** The plan (FR-36), all optional so older entries still read: `YYYY-MM`, a budget (finite, not negative) and its currency. Null or absent: not planned. */
  plannedMonth?: string | null;
  budget?: number | null;
  currency?: string | null;
  /** The H&M article id of a photograph to show (local H&M demo only); absent: "No photo yet". */
  photoId?: string | null;
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

/** Marking a wishlist entry bought (FR-35): the purchase, plus a colour when the entry has none (an item needs one). */
export interface BoughtInput { purchase: PurchaseDraft; colourHex?: string }
export interface WishlistCollection extends Collection<WishlistEntry, WishlistInput> {
  /** One step: the entry leaves the wishlist, an item and a purchase are made (`app.wishlist_bought`). Returns the new item's id. */
  bought(id: string, input: BoughtInput): Promise<string>;
}

/** Purchases (FR-30, FR-31): newest first, keyset pages of 40, spend per currency over the whole filtered set. */
export interface PurchaseCollection {
  page(filter: PurchaseFilter, after?: Cursor | null): Promise<Page>;
  totals(filter: PurchaseFilter): Promise<CurrencyTotal[]>;
  forItem(itemId: string): Promise<Purchase[]>;
  create(input: PurchaseInput): Promise<Purchase>;
  update(id: string, patch: Partial<PurchaseDraft>): Promise<Purchase | undefined>;
  remove(id: string): Promise<boolean>;
}

/** What a price is shown against (FR-33): the profile currency and the newest exchange rates (empty until rates exist). */
export interface PriceContext { currency(): Promise<string>; rates(): Promise<FxRates> }

export interface WardrobeRepository {
  items: ItemCollection;
  outfits: Collection<SavedOutfit, OutfitInput>;
  wishlist: WishlistCollection;
  purchases: PurchaseCollection;
  prices: PriceContext;
  /** The seed catalogue for the picker (FR-21); empty where there is none. */
  catalogue: CatalogueCollection;
  /** Only the account-backed repository has one; the local repository keeps just its event log. */
  feedback?: FeedbackSink;
}
