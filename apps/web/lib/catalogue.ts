import { FITS, OCCASIONS, PATTERNS, isCategory, isColourFamily, isFit, isMaterial, isOccasion, isPattern, isSeason, isSubType } from '@sparta/taxonomy';
import type { Category, ColourFamily, Fit, Material, Occasion, Pattern, Season, SubType } from '@sparta/taxonomy';
import { DEFAULT_HEX, emptyForm } from './item-form';
import type { ItemFormValues } from './item-form';
import type { PurchaseDraft } from './purchases';
import { validatePurchase } from './purchase-form';
import type { PurchaseErrors } from './purchase-form';

export const CATALOGUE_PAGE = 40;
/** One active row of `catalog.catalog_items` as the picker reads it (FR-21). Nothing here is an image: a catalogue item is drawn, never photographed (FR-24, BR-41). */
export interface CatalogueItem {
  id: string; name: string; brand: string | null; category: Category; subType: SubType; hex: string; colourFamily: ColourFamily | null;
  fit: Fit | null; pattern: Pattern | null; material: Material | null; seasons: Season[]; occasions: Occasion[]; sizes: string[];
  price: number | null; currency: string | null; productUrl: string;
  /** The row's sku and the name of its source, when known (WO-0121: only the local H&M demo source, `hm-demo`, has photographs). */
  sku?: string; source?: string;
}
/** `style` is one tag: `fit:Slim`, `pattern:Solid` or `occasion:Casual` (glossary: "style" is a fit, pattern or occasion tag). */
export interface CatalogueFilter { q: string; category: string; brand: string; colourFamily: string; style: string }
export const NO_CATALOGUE_FILTER: CatalogueFilter = { q: '', category: '', brand: '', colourFamily: '', style: '' };
/** Name then id: the keyset the next page continues after. */
export interface CatalogueCursor { name: string; id: string }
export interface CataloguePage { rows: CatalogueItem[]; next: CatalogueCursor | null }
/** Read with the person's own session only (the database shows consumers active rows and nothing else). */
export interface CatalogueCollection {
  page(filter: CatalogueFilter, after?: CatalogueCursor | null): Promise<CataloguePage>;
  /** The brands in the active catalogue, sorted, for the brand filter. */
  brands(): Promise<string[]>;
  /** Barcode lookup (FR-26): the active items whose GTIN is this padded 14-digit code, name then id, at most 20. The code is the only thing sent. */
  byGtin(gtin: string): Promise<CatalogueItem[]>;
}

export const STYLES: readonly string[] = [...FITS.map((f) => `fit:${f}`), ...PATTERNS.map((p) => `pattern:${p}`), ...OCCASIONS.map((o) => `occasion:${o}`)];
/** `Slim (fit)`: the value with the kind of tag it is, so a fit and a pattern never read alike. */
export const styleLabel = (style: string): string => `${style.slice(style.indexOf(':') + 1)} (${style.slice(0, style.indexOf(':'))})`;
export const parseStyle = (style: string): { kind: 'fit' | 'pattern' | 'occasion'; value: string } | null => {
  const [kind, value] = [style.slice(0, style.indexOf(':')), style.slice(style.indexOf(':') + 1)];
  return (kind === 'fit' && isFit(value)) || (kind === 'pattern' && isPattern(value)) || (kind === 'occasion' && isOccasion(value)) ? { kind, value } : null;
};

/** The filter with every value checked: a category, colour family or style the taxonomy does not know is dropped, the text is trimmed and capped. */
export function cleanCatalogueFilter(f: CatalogueFilter): CatalogueFilter {
  return {
    q: f.q.trim().slice(0, 80), category: isCategory(f.category) ? f.category : '', brand: f.brand.trim().slice(0, 120),
    colourFamily: isColourFamily(f.colourFamily) ? f.colourFamily : '', style: parseStyle(f.style) ? f.style : '',
  };
}

export const CATALOGUE_SELECT = 'id,sku,name,brand,category,sub_type,colour_hex,colour_family,fit,pattern,material,seasons,occasions,sizes_available,price,currency,product_url,sources(name)';
type Row = Record<string, unknown>;
const list = <T extends string>(v: unknown, ok: (x: unknown) => x is T): T[] => (Array.isArray(v) ? v.filter(ok) : []);
const orNull = <T extends string>(v: unknown, ok: (x: unknown) => x is T): T | null => (ok(v) ? v : null);

export const HM_DEMO_SOURCE = 'hm-demo';
/** The source's name as the database gives it: the catalogue read embeds `sources(name)` through the foreign key (a consumer may read id and name of a source with active items, nothing else). */
const sourceNameFrom = (v: unknown): string | undefined => {
  const name = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Row).name : undefined;
  return typeof name === 'string' && name !== '' ? name : undefined;
};
/** The 10-digit H&M article id whose photograph a tile may show: only for the `hm-demo` source and a sku of exactly 10 digits. */
export const hmPhotoId = (sku: string | undefined, source: string | undefined): string | null => (source === HM_DEMO_SOURCE && sku !== undefined && /^[0-9]{10}$/.test(sku) ? sku : null);

/** A catalogue row, or null when it cannot be shown (no id, name or link, or a category and sub-type the taxonomy does not know). */
export function catalogueFromRow(r: Row): CatalogueItem | null {
  const { category, sub_type: subType } = r;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.product_url !== 'string' || !isCategory(category) || !isSubType(category, subType)) return null;
  const hex = typeof r.colour_hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(r.colour_hex) ? r.colour_hex.toUpperCase() : DEFAULT_HEX.toUpperCase();
  const source = sourceNameFrom(r.sources);
  const price = r.price === null || r.price === undefined ? null : Number(r.price);
  return {
    id: r.id, name: r.name, brand: typeof r.brand === 'string' && r.brand !== '' ? r.brand : null, category, subType, hex, colourFamily: orNull(r.colour_family, isColourFamily),
    fit: orNull(r.fit, isFit), pattern: orNull(r.pattern, isPattern), material: orNull(r.material, isMaterial), seasons: list(r.seasons, isSeason), occasions: list(r.occasions, isOccasion),
    sizes: Array.isArray(r.sizes_available) ? r.sizes_available.filter((s): s is string => typeof s === 'string' && s.length <= 20) : [],
    price: price !== null && Number.isFinite(price) && price >= 0 ? price : null, currency: typeof r.currency === 'string' && /^[A-Za-z]{3}$/.test(r.currency.trim()) ? r.currency.trim().toUpperCase() : null,
    productUrl: r.product_url,
    ...(typeof r.sku === 'string' ? { sku: r.sku } : {}), ...(source !== undefined ? { source } : {}),
  };
}

/** The source page link, only for an `https:` address without a login in it (FR-24); anything else shows no link. */
export function sourceLink(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.username === '' && u.password === '' ? u.href : null;
  } catch { return null; }
}

const lower = (s: string | null) => (s ?? '').toLowerCase();
/** The rows (already in name order) dealt out one category at a time: Tops, Bottoms, Footwear, Outerwear, Accessories, Occasion wear, then the rest; socks and underwear come last. */
const DEAL: readonly string[] = ['Tops', 'Bottoms', 'Footwear', 'Outerwear', 'Accessories', 'Occasion wear'];
function interleave(rows: readonly CatalogueItem[]): CatalogueItem[] {
  const lanes = new Map<string, CatalogueItem[]>();
  for (const r of rows) { const lane = DEAL.includes(r.category) ? r.category : 'rest'; lanes.set(lane, [...(lanes.get(lane) ?? []), r]); }
  const order = [...DEAL, 'rest'].map((l) => lanes.get(l) ?? []);
  const out: CatalogueItem[] = [];
  for (let n = 0; order.some((l) => n < l.length); n++) for (const l of order) if (n < l.length) out.push(l[n]!);
  return out;
}
/** The same search and filters over a list in memory (the browser-only demo catalogue), in the order the database gives: name, then id. */
export function filterCatalogue(items: readonly CatalogueItem[], filter: CatalogueFilter, after: CatalogueCursor | null = null, mixed = false): CataloguePage {
  const f = cleanCatalogueFilter(filter);
  const style = parseStyle(f.style);
  const q = f.q.toLowerCase();
  const key = (a: { name: string; id: string }) => `${a.name}\u0000${a.id}`;
  const rest = items.filter((i) => (!q || lower(i.name).includes(q) || lower(i.brand).includes(q)) && (!f.category || i.category === f.category) && (!f.brand || i.brand === f.brand)
    && (!f.colourFamily || i.colourFamily === f.colourFamily)
    && (!style || (style.kind === 'fit' ? i.fit === style.value : style.kind === 'pattern' ? i.pattern === style.value : (i.occasions as string[]).includes(style.value)))
    && (mixed || !after || key(i) > key(after))).sort((a, b) => (key(a) < key(b) ? -1 : 1));
  if (mixed) { // the local H&M demo only: one of each category in turn, so the first screen is a mix and not a page of socks; the cursor is found by id
    const order = interleave(rest);
    const from = after ? order.findIndex((i) => i.id === after.id) + 1 : 0;
    const rows = order.slice(from, from + CATALOGUE_PAGE);
    const last = rows[CATALOGUE_PAGE - 1];
    return { rows, next: from + CATALOGUE_PAGE < order.length && last ? { name: last.name, id: last.id } : null };
  }
  const rows = rest.slice(0, CATALOGUE_PAGE);
  const last = rows[CATALOGUE_PAGE - 1];
  return { rows, next: rest.length > CATALOGUE_PAGE && last ? { name: last.name, id: last.id } : null };
}

/** The item form's start: the catalogue name is kept (FDD 13), the stored colour, category, sub-type and attributes are filled in, and the person adjusts. */
export function formFromCatalogue(c: CatalogueItem): ItemFormValues {
  return { ...emptyForm(), category: c.category, subType: c.subType, hex: c.hex, name: c.name, nameEdited: true, fit: c.fit ?? '', material: c.material ?? '', pattern: c.pattern ?? '', seasons: [...c.seasons], occasions: [...c.occasions] };
}

/** What a catalogue item carries into the item row: the link, the brand and the size picked (all optional). */
export interface CatalogueAttachment { id: string; brand: string | null; sizeValue: string | null }
export const attachmentOf = (c: CatalogueItem, size: string): CatalogueAttachment => ({ id: c.id, brand: c.brand, sizeValue: size.trim() === '' ? null : size.trim().slice(0, 20) });

/** The optional "price paid" block of the catalogue form, as typed. Entering a price or a date makes it a purchase (FR-30); both are then needed. */
export interface PaidValues { price: string; currency: string; date: string; store: string }
export const emptyPaid = (currency: string): PaidValues => ({ price: '', currency, date: '', store: '' });
export const paidEntered = (p: PaidValues): boolean => p.price.trim() !== '' || p.date.trim() !== '';
export type PaidResult = { ok: true; draft: PurchaseDraft | null } | { ok: false; errors: PurchaseErrors };
/** Nothing typed: no purchase. Otherwise the WO-0081 rules for one piece (price, a real date not in the future, store). */
export function checkPaid(p: PaidValues, today: string): PaidResult {
  if (!paidEntered(p)) return { ok: true, draft: null };
  const r = validatePurchase({ date: p.date.trim(), store: p.store, price: p.price, currency: p.currency, quantity: '1', notes: '' }, today);
  return r.ok ? { ok: true, draft: r.draft } : { ok: false, errors: r.errors };
}
