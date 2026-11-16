import { categoryOfSubType, isCategory, isColourFamily, isFit, isMaterial, isOccasion, isPattern, isSeason, isSubType, referenceSwatch, slotAssignmentOf } from '@sparta/taxonomy';
import type { Slot } from '@sparta/rules';
import { isDay } from '../purchases';
import { isMonth } from '../wishlist-plan';
import type { Cursor, Purchase, PurchaseDraft, PurchaseFilter, PurchaseInput } from '../purchases';
import type { FeedbackFacts, ItemInput, OutfitInput, PhotoFeatures, SavedOutfit, StoredItem, WishlistEntry, WishlistInput } from '../repository';
import { RepositoryError } from './errors';

// Both ways between the screens' shapes and the rows of app.items, app.outfits, app.outfit_items, app.wishlist_entries and
// app.suggestion_feedback (supabase/migrations). Pure: no client, no clock except where one is passed in. The database sets
// colour_hex, colour_family and the secondary colour itself (trigger catalog.set_colour_fields), so no row built here carries them.
type Row = Record<string, unknown>;
const bad = (what: string): never => { throw new RepositoryError('unexpected', false, `The stored ${what} could not be read.`); };
const strings = <T extends string>(v: unknown, ok: (x: unknown) => x is T, what: string): T[] => (Array.isArray(v) && v.every(ok) ? [...v] : bad(what));
const orNull = <T extends string>(v: unknown, ok: (x: unknown) => x is T, what: string): T | null => (v === null || v === undefined ? null : ok(v) ? v : bad(what));

const ITEM_COLUMNS = {
  name: 'name', category: 'category', subType: 'sub_type', fit: 'fit', material: 'material', pattern: 'pattern', seasons: 'seasons',
  occasions: 'occasions', condition: 'condition', favourite: 'favourite', neverWorn: 'never_worn', status: 'status', archiveReason: 'archive_reason',
} as const;
/** Everything a read needs from app.items (no image paths, notes or prices). */
export const ITEM_SELECT = 'id,name,category,sub_type,colour_r,colour_g,colour_b,colour_hex,colour_family,fit,material,pattern,seasons,occasions,condition,never_worn,favourite,status,archive_reason,created_at,updated_at,catalog_item_id';

/** Changed fields only, as columns. `hex`, `colourFamily` and the ids are never sent: the database derives them from the RGB. */
export function itemPatch(patch: Partial<ItemInput>): Row {
  const row: Row = {};
  for (const [key, column] of Object.entries(ITEM_COLUMNS)) {
    const v = (patch as Row)[key];
    if (v !== undefined) row[column] = Array.isArray(v) ? v.slice() : v;
  }
  if (patch.rgb) [row.colour_r, row.colour_g, row.colour_b] = patch.rgb;
  if (patch.status === 'active') row.archived_at = null; // archiving sets archived_at in the repository, which has the clock
  return row;
}

export const itemRow = (input: ItemInput, userId: string, now: string): Row => ({
  ...itemPatch(input), user_id: userId, origin: input.photo ? 'photo' : input.catalogue ? 'catalogue' : 'manual', archived_at: input.status === 'archived' ? now : null,
  ...(input.photo ? { image_path: input.photo.imagePath, image_thumb_path: input.photo.imageThumbPath } : {}),
  ...(input.barcode !== undefined && /^[0-9]{14}$/.test(input.barcode) ? { barcode: input.barcode } : {}),
  ...(input.catalogue ? { catalog_item_id: input.catalogue.id, brand: input.catalogue.brand, size_value: input.catalogue.sizeValue } : {}),
});

const FEATURE_LENGTH: Record<string, { size: number; maxClass: number }> = { 'garment-cnn-v1': { size: 32, maxClass: 9 }, 'garment-cnn-v2': { size: 64, maxClass: 19 } };
/** The `app.item_features` row for a new item, or null when the features do not fit the table's checks (a known model version, the right count of finite numbers). */
export function featuresRow(itemId: string, userId: string, f: PhotoFeatures): Row | null {
  const shape = FEATURE_LENGTH[f.modelVersion];
  if (!shape || f.embedding.length !== shape.size || !f.embedding.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if (f.garmentClass !== null && !(Number.isInteger(f.garmentClass) && f.garmentClass >= 0 && f.garmentClass <= shape.maxClass)) return null;
  if (f.p !== null && !(f.p >= 0 && f.p <= 1)) return null;
  return { item_id: itemId, user_id: userId, model_version: f.modelVersion, garment_class: f.garmentClass, garment_p: f.p, embedding: [...f.embedding] };
}

export function itemFromRow(r: Row): StoredItem {
  const { category, sub_type: subType, status } = r;
  if (!isCategory(category) || !isSubType(category, subType)) bad('item');
  const rgb = [r.colour_r, r.colour_g, r.colour_b];
  if (!rgb.every((c) => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 255)) bad('item colour');
  const family = r.colour_family;
  if (!isColourFamily(family) || typeof r.colour_hex !== 'string') bad('item colour');
  if (status !== 'active' && status !== 'archived') bad('item status');
  const reason = r.archive_reason;
  if (reason !== null && reason !== 'sold' && reason !== 'donated' && reason !== 'discarded' && reason !== 'lost') bad('item archive reason');
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.created_at !== 'string' || typeof r.updated_at !== 'string') bad('item');
  if (r.condition !== null && !Number.isInteger(r.condition)) bad('item condition');
  return {
    id: r.id as string, name: r.name as string, category: category as StoredItem['category'], subType: subType as StoredItem['subType'],
    rgb: rgb as unknown as StoredItem['rgb'], hex: (r.colour_hex as string).toUpperCase(), colourFamily: family as StoredItem['colourFamily'],
    fit: orNull(r.fit, isFit, 'item fit'), material: orNull(r.material, isMaterial, 'item material'), pattern: orNull(r.pattern, isPattern, 'item pattern'),
    seasons: strings(r.seasons, isSeason, 'item seasons'), occasions: strings(r.occasions, isOccasion, 'item occasions'),
    condition: r.condition as number | null, favourite: r.favourite === true, neverWorn: r.never_worn === true,
    status: status as StoredItem['status'], archiveReason: reason as StoredItem['archiveReason'], createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    ...(typeof r.catalog_item_id === 'string' ? { catalogueId: r.catalog_item_id } : {}),
  };
}

// ---- outfits ---------------------------------------------------------------------------------------------------------
const SLOT_ORDER: readonly Slot[] = ['top', 'bottom', 'layer', 'footwear', 'accessory'];
/** What is kept beside an outfit that has no column for it: the engine's score and reasons, lossless, in `notes`. */
const notesOf = (o: Pick<OutfitInput, 'score' | 'reasons'>): string => JSON.stringify({ v: 1, score: o.score, reasons: o.reasons });

/**
 * The outfit row and its piece rows (the caller adds `outfit_id`, which the database assigns). A piece that fills two slots (a Suit)
 * is one row, because (outfit_id, item_id) is the key; it is kept under the first slot it is in, and `outfitFromRow` puts it back in
 * every slot it fills.
 */
export function outfitRows(input: OutfitInput, userId: string): { outfit: Row; pieces: Row[] } {
  const seen = new Set<string>();
  const pieces: Row[] = [];
  for (const slot of SLOT_ORDER) {
    const item = input.items[slot];
    if (item !== null && item !== undefined && !seen.has(item)) { seen.add(item); pieces.push({ user_id: userId, item_id: item, slot }); }
  }
  return { outfit: { user_id: userId, name: `${input.occasion} outfit`, occasions: [input.occasion], seasons: [], notes: notesOf(input) }, pieces };
}

/** Changed outfit columns only (the pieces are replaced separately by the repository). */
export function outfitPatch(patch: Partial<OutfitInput>): Row {
  const row: Row = {};
  if (patch.occasion !== undefined) Object.assign(row, { occasions: [patch.occasion], name: `${patch.occasion} outfit` });
  return row;
}

export const OUTFIT_SELECT = 'id,occasions,notes,created_at,outfit_items(item_id,slot,items(sub_type))';

/** null when the row has no occasion the app knows (an outfit this app did not write). */
export function outfitFromRow(r: Row): SavedOutfit | null {
  const occasion = Array.isArray(r.occasions) ? r.occasions.find(isOccasion) : undefined;
  if (!occasion || typeof r.id !== 'string' || typeof r.created_at !== 'string') return null;
  const items: SavedOutfit['items'] = { top: null, bottom: null, layer: null, footwear: null, accessory: null };
  for (const p of (Array.isArray(r.outfit_items) ? r.outfit_items : []) as Row[]) {
    if (typeof p.item_id !== 'string' || !SLOT_ORDER.includes(p.slot as Slot)) bad('outfit piece');
    items[p.slot as Slot] = p.item_id as string;
    const sub = (p.items as Row | null)?.sub_type;
    const fill = typeof sub === 'string' ? slotAssignmentOf(sub) : undefined;
    if (fill?.fill === 'both') for (const s of fill.slots) items[s.toLowerCase() as Slot] = p.item_id as string;
  }
  let score: number | null = null;
  let reasons: string[] = [];
  try {
    const n = JSON.parse(typeof r.notes === 'string' ? r.notes : 'null') as { score?: unknown; reasons?: unknown } | null;
    if (typeof n?.score === 'number') score = n.score;
    if (Array.isArray(n?.reasons) && n.reasons.every((x) => typeof x === 'string')) reasons = n.reasons as string[];
  } catch { /* notes written by someone else: no score or reasons */ }
  return { id: r.id, occasion, items, score, reasons, createdAt: r.created_at };
}

// ---- wishlist --------------------------------------------------------------------------------------------------------
/** A colour family becomes the RGB of its reference swatch (the database turns it back into the same family); Multi is the flag. */
function wishColour(family: WishlistInput['colourFamily']): Row {
  if (family === 'Multi') return { colour_r: null, colour_g: null, colour_b: null, is_multicolour: true };
  const swatch = family ? referenceSwatch(family) : undefined;
  const rgb = swatch ? ([1, 3, 5] as const).map((i) => parseInt(swatch.hex.slice(i, i + 2), 16)) : [null, null, null];
  return { colour_r: rgb[0], colour_g: rgb[1], colour_b: rgb[2], is_multicolour: false };
}

export function wishlistPatch(patch: Partial<WishlistInput>): Row {
  const row: Row = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.subType !== undefined) Object.assign(row, { sub_type: patch.subType, category: categoryOfSubType(patch.subType) });
  if (patch.note !== undefined) row.notes = patch.note;
  if (patch.origin !== undefined) row.origin = patch.origin;
  if (patch.colourFamily !== undefined) Object.assign(row, wishColour(patch.colourFamily));
  // the plan (FR-36): `YYYY-MM` becomes the first day of the month; anything else never reaches a request
  if (patch.plannedMonth !== undefined) row.planned_month = patch.plannedMonth === null ? null : isMonth(patch.plannedMonth) ? `${patch.plannedMonth}-01` : badPlan();
  if (patch.budget !== undefined) row.budget = patch.budget === null ? null : Number.isFinite(patch.budget) && patch.budget >= 0 ? patch.budget : badPlan();
  if (patch.currency !== undefined) row.currency = patch.currency === null ? null : /^[A-Z]{3}$/.test(patch.currency) ? patch.currency : badPlan();
  return row;
}
const badPlan = (): never => { throw new RepositoryError('rejected', true); };
export const wishlistRow = (input: WishlistInput, userId: string): Row => ({ origin: 'user', ...wishColour(null), ...wishlistPatch(input), user_id: userId });

export const WISHLIST_SELECT = 'id,name,category,sub_type,colour_family,notes,origin,created_at,planned_month,budget,currency';
export function wishlistFromRow(r: Row): WishlistEntry {
  const family = r.colour_family;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.created_at !== 'string' || !isCategory(r.category) || !isSubType(r.category, r.sub_type)) bad('wishlist entry');
  if (r.origin !== 'user' && r.origin !== 'unlock') bad('wishlist origin');
  return {
    id: r.id as string, name: r.name as string, subType: r.sub_type as WishlistEntry['subType'], colourFamily: orNull(family, isColourFamily, 'wishlist colour'),
    origin: r.origin as 'user' | 'unlock', note: typeof r.notes === 'string' ? r.notes : null, createdAt: r.created_at as string,
    ...planFromRow(r),
  };
}

/** The stored plan: a first-of-month date, a finite non-negative budget (numeric comes as a number or a string) and a currency; a malformed one is refused, never shown. */
function planFromRow(r: Row): Pick<WishlistEntry, 'plannedMonth' | 'budget' | 'currency'> {
  const month = r.planned_month === null || r.planned_month === undefined ? null : typeof r.planned_month === 'string' && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(r.planned_month) ? r.planned_month.slice(0, 7) : bad('planned month');
  const budget = r.budget === null || r.budget === undefined ? null : Number.isFinite(Number(r.budget)) && Number(r.budget) >= 0 && r.budget !== '' ? Number(r.budget) : bad('budget');
  const currency = r.currency === null || r.currency === undefined ? null : typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) ? r.currency : bad('currency');
  return { ...(month ? { plannedMonth: month } : {}), ...(budget !== null ? { budget } : {}), ...(currency ? { currency } : {}) }; // only what is set, like the other optional fields
}

// ---- suggestion feedback ---------------------------------------------------------------------------------------------
/** A feedback row is built from the four `FeedbackFacts` fields, listed one by one: no item id, item name or free text can be added by accident. */
const RULE_ID = /^[A-Z][A-Z0-9_]{0,15}$/;

/** null for anything that is not an accepted or rejected suggestion. */
export function feedbackRow(e: FeedbackFacts, userId: string): Row | null {
  if ((e.type !== 'suggestion_accepted' && e.type !== 'suggestion_rejected') || !e.occasion) return null;
  return { user_id: userId, occasion: e.occasion, rule_ids: e.rule_ids.filter((r) => RULE_ID.test(r)), accepted: e.type === 'suggestion_accepted', engine_config: e.engine_config };
}

// ---- purchases (FR-30, WO-0081) --------------------------------------------------------------------------------------
/** The purchase and, inner-joined, the attributes of its item that the filters use. `price` is the UNIT price; spend is price x quantity. */
export const PURCHASE_SELECT = 'id,item_id,purchase_date,store,price,currency,quantity,notes,created_at,items!inner(name,category,brand)';
const num = (v: unknown, what: string): number => { const n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : bad(what); };

export function purchaseFromRow(r: Row): Purchase | null {
  const item = (Array.isArray(r.items) ? r.items[0] : r.items) as Row | null | undefined;
  if (typeof r.id !== 'string' || typeof r.item_id !== 'string' || typeof r.created_at !== 'string' || !item || typeof item.name !== 'string') return bad('purchase');
  if (r.purchase_date === null || r.price === null || r.currency === null) return null; // a purchase made before R6 without a date, price or currency: not listed
  return {
    id: r.id as string, itemId: r.item_id as string, date: typeof r.purchase_date === 'string' ? r.purchase_date : bad('purchase date'), store: typeof r.store === 'string' ? r.store : null, price: num(r.price, 'purchase price'),
    currency: typeof r.currency === 'string' ? r.currency : bad('purchase currency'), quantity: num(r.quantity, 'purchase quantity'), notes: typeof r.notes === 'string' ? r.notes : null, createdAt: r.created_at as string,
    itemName: item.name as string, category: isCategory(item.category) ? item.category : null, brand: typeof item.brand === 'string' ? item.brand : null,
  };
}

const draftColumns = (d: Partial<PurchaseDraft>): Row => {
  const row: Row = {};
  if (d.date !== undefined) row.purchase_date = d.date;
  if (d.store !== undefined) row.store = d.store;
  if (d.price !== undefined) row.price = d.price;
  if (d.currency !== undefined) row.currency = d.currency;
  if (d.quantity !== undefined) row.quantity = d.quantity;
  if (d.notes !== undefined) row.notes = d.notes;
  return row;
};
export const purchaseRow = (i: PurchaseInput, userId: string): Row => ({ ...draftColumns(i), user_id: userId, item_id: i.itemId });
export const purchasePatch = draftColumns;
/** The `p_item` colour and the `p_purchase` document for `app.wishlist_bought` (its keys are the function's own). */
export function boughtArgs(entry: string, draft: PurchaseDraft, colourHex?: string): Row {
  const rgb = colourHex ? ([1, 3, 5] as const).map((i) => parseInt(colourHex.slice(i, i + 2), 16)) : [];
  return { p_entry: entry, p_item: colourHex ? { colour_r: rgb[0], colour_g: rgb[1], colour_b: rgb[2] } : {}, p_purchase: draftColumns(draft) };
}

/** A filter with only well-formed values: a date that is not a day, or a cursor that is not a day and a uuid, is dropped before it reaches a request. */
export const cleanFilter = (f: PurchaseFilter): PurchaseFilter => ({ ...f, from: isDay(f.from) ? f.from : '', to: isDay(f.to) ? f.to : '' });
export const cleanCursor = (c: Cursor | null | undefined): Cursor | null => (c && isDay(c.date) && /^[0-9a-f-]{36}$/i.test(c.id) ? c : null);
/** Escapes `%`, `_` and `\` so the store filter is a plain "contains". */
export const likePattern = (s: string): string => `%${s.replace(/[\\%_]/g, '\\$&')}%`;
