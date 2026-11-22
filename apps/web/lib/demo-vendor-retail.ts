import { colourFamily } from '@sparta/taxonomy';
import { HM_ARTICLES, type HmArticle } from './demo-hm';

/**
 * FIXED RETAIL DEMO DATA for the vendor dashboard of the no-login demo (vendor plan, section 2). One data source for every vendor retail screen: stores, products, weekly facts and the
 * derived helpers. It is made by a small seeded generator (a fixed seed, no Math.random), so the numbers are the same on every load. Nothing is read from a network or a database.
 * Simulated demo data: no real users or sales. The vendor is "Northline Apparel (demo vendor)" (see demo-vendor.ts); photographs are the H&M demo articles of NEXT_PUBLIC_HM_DEMO_ARTICLES
 * (with no list, a product has no article id and its photo is the neutral "No photo yet" tile).
 *
 * Shape of the data (hand-made, so the screens have something to say): a seasonal lift on outerwear, two best sellers (the graphic T-shirt and the slim jeans), two slow movers (shorts, blazer),
 * three products heading for a stockout within 2 weeks at named stores (hoodie, cargo trousers, bomber jacket), one overstocked (sandals), one new launch, the 25-34 group the largest overall and
 * 18-24 leading in the streetwear-like items. The weeks run Mon 31 Aug 2026 to Sun 22 Nov 2026 (12 weeks, "now" is the end of week 12), plus a 4-week forecast; the 12 weeks before them are used
 * only for the "versus previous period" figures.
 */

// ---- types ----------------------------------------------------------------------------------------------------------------------------------------------------------------

export type Region = 'North' | 'South' | 'East' | 'West';
export type StoreSize = 'S' | 'M' | 'L';
export type Category = 'Tops' | 'Bottoms' | 'Outerwear' | 'Footwear' | 'Accessories';
export type AgeGroup = '18–24' | '25–34' | '35–44' | '45+';
export type Gender = 'Men' | 'Women' | 'Other or not said';
export type StockStatus = 'Healthy' | 'Watch' | 'Restock now' | 'Overstock';
export type Style = 'street' | 'core' | 'formal';

export interface Store { id: string; name: string; city: string; region: Region; size: StoreSize; opened: number; online: boolean }
export interface Product {
  id: string;
  /** The H&M article id (10 digits) for its photo, or null when the build has no article list. */
  articleId: string | null;
  name: string;
  category: Category;
  subType: string;
  colour: string;
  /** In INR. */
  price: number;
  /** In INR, 55% of the price. */
  cost: number;
  /** The week index (0 to 11 are the 12 weeks shown; negative is before them) in which it went on sale. */
  launchWeek: number;
  /** The Monday of that week, YYYY-MM-DD. */
  launchDate: string;
  style: Style;
}
/** The filters every screen shares. `store` is a store id. */
export interface Filters { weeks: 4 | 12; store?: string | undefined; region?: Region | undefined; ageGroup?: AgeGroup | undefined; category?: Category | undefined }
/** A fact for one product, store, age group and week. Weeks 0 to 11 are actual, 12 to 15 are the forecast (only `units` and the money figures made from it are forecast). */
export interface WeeklyFact { product: string; store: string; ageGroup: AgeGroup; week: number; forecast: boolean; units: number; revenue: number; wishlistAdds: number; returns: number }
/** Stock for one product and store at the end of a week. */
export interface StockFact { product: string; store: string; week: number; forecast: boolean; onHand: number; onOrder: number }
/** In-store visits of one store in one week (for Online: sessions). */
export interface VisitFact { store: string; week: number; forecast: boolean; visits: number }
export interface Thresholds { /** Restock now when cover is under this many weeks and demand is rising. */ restockCover: number; /** Watch when under this. */ watchCover: number; /** Overstock when over this. */ overstockCover: number }
export interface RestockLine {
  product: Product; store: Store; status: StockStatus;
  /** Weeks of cover (stock divided by the average weekly units of the last 4 weeks). */
  cover: number;
  /** The date the stock is expected to run out, YYYY-MM-DD. */
  stockoutDate: string;
  onHand: number; onOrder: number;
  /** The average weekly units of the last 4 weeks. */
  weeklyUnits: number;
  topAge: AgeGroup;
  /** The quantity to reach 6 weeks of cover, in packs of 6, and its cost in INR. */
  suggestedUnits: number; cost: number;
}
export interface RestockItem { product: Product; lines: RestockLine[]; stores: Store[]; cover: number; stockoutDate: string; topAge: AgeGroup }
export type Metric = 'units' | 'revenue' | 'wishlist' | 'returns' | 'visits' | 'stock' | 'demand4' | 'sellThrough' | 'cover' | 'restockItems';
export type Dimension = 'region' | 'store' | 'category' | 'age' | 'gender' | 'product';
export interface Series { label: string; values: number[] }
export interface Slice { label: string; value: number }
export interface Kpi { key: string; label: string; value: number; unit: 'inr' | 'count' | 'percent' | 'weeks'; display: string; previous: number; changePct: number | null; spark: number[]; accent?: boolean }
export interface ProductSummary { product: Product; units: number; revenue: number; sellThrough: number; cover: number; status: StockStatus; topAge: AgeGroup; wishlist: number; returnsPct: number; onHand: number; onOrder: number; spark: number[] }
export interface StoreSummary { store: Store; units: number; revenue: number; sellThrough: number; cover: number; counts: Record<StockStatus, number>; restockCount: number; spark: number[]; best: Product | null; urgent: Product | null }

// ---- constants -----------------------------------------------------------------------------------------------------------------------------------------------------------

export const AGE_GROUPS: readonly AgeGroup[] = ['18–24', '25–34', '35–44', '45+'];
export const GENDERS: readonly Gender[] = ['Men', 'Women', 'Other or not said'];
export const CATEGORIES: readonly Category[] = ['Tops', 'Bottoms', 'Outerwear', 'Footwear', 'Accessories'];
export const REGIONS: readonly Region[] = ['North', 'South', 'East', 'West'];
export const STOCK_STATUSES: readonly StockStatus[] = ['Healthy', 'Watch', 'Restock now', 'Overstock'];
export const DEFAULT_THRESHOLDS: Thresholds = { restockCover: 2, watchCover: 4, overstockCover: 12 };
export const DEFAULT_FILTERS: Filters = { weeks: 12 };
/** Sell-through target of the store chart, in percent. */
export const SELL_THROUGH_TARGET = 65;
/** The restock suggestion reaches this many weeks of cover. */
export const TARGET_COVER_WEEKS = 6;
export const PACK_SIZE = 6;
export const HISTORY_WEEKS = 12;
export const FORECAST_WEEKS = 4;
export const WEEK_COUNT = HISTORY_WEEKS + FORECAST_WEEKS;

/** The 9 stores: 8 shops and Online (Online is counted in the West, where its warehouse is). */
export const STORES: readonly Store[] = [
  { id: 'mumbai', name: 'Mumbai Linking Road', city: 'Mumbai', region: 'West', size: 'L', opened: 2016, online: false },
  { id: 'delhi', name: 'Delhi Select Citywalk', city: 'Delhi', region: 'North', size: 'L', opened: 2017, online: false },
  { id: 'bengaluru', name: 'Bengaluru Indiranagar', city: 'Bengaluru', region: 'South', size: 'M', opened: 2018, online: false },
  { id: 'hyderabad', name: 'Hyderabad Inorbit', city: 'Hyderabad', region: 'South', size: 'M', opened: 2019, online: false },
  { id: 'chennai', name: 'Chennai Phoenix', city: 'Chennai', region: 'South', size: 'M', opened: 2019, online: false },
  { id: 'pune', name: 'Pune Koregaon Park', city: 'Pune', region: 'West', size: 'S', opened: 2021, online: false },
  { id: 'kolkata', name: 'Kolkata Quest', city: 'Kolkata', region: 'East', size: 'M', opened: 2020, online: false },
  { id: 'ahmedabad', name: 'Ahmedabad Alpha One', city: 'Ahmedabad', region: 'West', size: 'S', opened: 2022, online: false },
  { id: 'online', name: 'Online', city: 'Online', region: 'West', size: 'L', opened: 2015, online: true },
];

// ---- weeks ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const PRE = 12;                       // hidden weeks before week 0, used only for the previous-period figures
const T_NOW = PRE + HISTORY_WEEKS - 1; // internal index of the last actual week (public week 11)
const T = PRE + WEEK_COUNT;           // internal weeks 0 to 27
const DAY = 86_400_000;
const WEEK0 = Date.UTC(2026, 7, 31);  // Monday 31 August 2026
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** The Monday of public week w (0 to 15; negative is before the 12 shown). */
export const weekStart = (w: number): string => iso(WEEK0 + w * 7 * DAY);
/** The Sunday that ends public week w. */
export const weekEnd = (w: number): string => iso(WEEK0 + (w * 7 + 6) * DAY);
/** Short x-axis labels for the 16 weeks ("31 Aug"). */
export const WEEK_LABELS: readonly string[] = Array.from({ length: WEEK_COUNT }, (_, w) => { const d = new Date(WEEK0 + w * 7 * DAY); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; });
/** The index of the first forecast week, for `forecastFrom`. */
export const FORECAST_FROM = HISTORY_WEEKS;
/** Today in the demo: the end of the last actual week. */
export const DEMO_TODAY = weekEnd(HISTORY_WEEKS - 1);

// ---- the seeded generator -------------------------------------------------------------------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = mulberry32(20261122);

// ---- products ------------------------------------------------------------------------------------------------------------------------------------------------------------

type Role = 'best' | 'slow' | 'risk' | 'over' | 'new';
interface Spec { cat: Category; sub: string; name: string; colour: string; price: number; base: number; style: Style; role?: Role; /** weeks of cover to force at a store (all under 2: a stockout is near) */ short?: Record<string, number>; /** weeks of cover to force at a store (all over 12: stock to move) */ heavy?: Record<string, number>; surge?: AgeGroup; rising?: boolean }
const SPECS: readonly Spec[] = [
  { cat: 'Tops', sub: 'T-shirt', name: 'Graphic Print T-shirt', colour: 'Black', price: 799, base: 200, style: 'core', role: 'best', surge: '18–24' },
  { cat: 'Tops', sub: 'Shirt', name: 'Oxford Cotton Shirt', colour: 'Blue', price: 1499, base: 115, style: 'core' },
  { cat: 'Tops', sub: 'Polo shirt', name: 'Pique Polo Shirt', colour: 'Navy', price: 1299, base: 105, style: 'core' },
  { cat: 'Tops', sub: 'Hoodie', name: 'Oversized Hoodie', colour: 'Grey', price: 2499, base: 135, style: 'street', role: 'risk', short: { mumbai: 0.9, delhi: 1.2, bengaluru: 1.5 }, heavy: { ahmedabad: 14, kolkata: 13 } },
  { cat: 'Tops', sub: 'Shirt', name: 'Linen Blend Shirt', colour: 'Beige', price: 1799, base: 60, style: 'core', role: 'new' },
  { cat: 'Tops', sub: 'Sweatshirt', name: 'Crew Neck Sweatshirt', colour: 'Olive', price: 1999, base: 95, style: 'street' },
  { cat: 'Tops', sub: 'T-shirt', name: 'Slim Fit Henley', colour: 'White', price: 999, base: 90, style: 'core', short: { pune: 1.7 }, rising: true },
  { cat: 'Bottoms', sub: 'Jeans', name: 'Slim Fit Jeans', colour: 'Blue', price: 2499, base: 150, style: 'core', role: 'best', short: { online: 1.4 } },
  { cat: 'Bottoms', sub: 'Chinos', name: 'Slim Chinos', colour: 'Khaki', price: 1999, base: 105, style: 'formal' },
  { cat: 'Bottoms', sub: 'Trousers', name: 'Cargo Trousers', colour: 'Olive', price: 2299, base: 100, style: 'street', role: 'risk', short: { delhi: 1, hyderabad: 1.4, chennai: 0.8 }, heavy: { kolkata: 13, pune: 12.5 } },
  { cat: 'Bottoms', sub: 'Joggers', name: 'Jersey Joggers', colour: 'Grey', price: 1499, base: 105, style: 'street', short: { mumbai: 1.8 }, rising: true },
  { cat: 'Bottoms', sub: 'Shorts', name: 'Chino Shorts', colour: 'Beige', price: 999, base: 28, style: 'core', role: 'slow' },
  { cat: 'Outerwear', sub: 'Bomber jacket', name: 'Bomber Jacket', colour: 'Black', price: 3999, base: 60, style: 'street', role: 'risk', short: { bengaluru: 1.1, mumbai: 1.6, online: 1.3 }, heavy: { ahmedabad: 14.5 } },
  { cat: 'Outerwear', sub: 'Denim jacket', name: 'Denim Jacket', colour: 'Blue', price: 3499, base: 50, style: 'core' },
  { cat: 'Outerwear', sub: 'Puffer jacket', name: 'Padded Puffer Jacket', colour: 'Navy', price: 4999, base: 42, style: 'core', short: { delhi: 1.5 }, rising: true },
  { cat: 'Outerwear', sub: 'Blazer', name: 'Tailored Blazer', colour: 'Grey', price: 4499, base: 22, style: 'formal', role: 'slow' },
  { cat: 'Footwear', sub: 'Sneakers', name: 'Low-top Sneakers', colour: 'White', price: 2999, base: 90, style: 'street' },
  { cat: 'Footwear', sub: 'Loafers', name: 'Leather Loafers', colour: 'Brown', price: 3499, base: 40, style: 'formal' },
  { cat: 'Footwear', sub: 'Sandals', name: 'Strap Sandals', colour: 'Black', price: 1499, base: 70, style: 'core', role: 'over' },
  { cat: 'Footwear', sub: 'Boots', name: 'Chelsea Boots', colour: 'Brown', price: 4299, base: 30, style: 'formal' },
  { cat: 'Accessories', sub: 'Belt', name: 'Leather Belt', colour: 'Black', price: 799, base: 70, style: 'formal' },
  { cat: 'Accessories', sub: 'Cap', name: 'Baseball Cap', colour: 'Navy', price: 599, base: 95, style: 'street' },
  { cat: 'Accessories', sub: 'Watch', name: 'Analogue Watch', colour: 'Black', price: 4999, base: 22, style: 'formal' },
  { cat: 'Accessories', sub: 'Wallet', name: 'Leather Wallet', colour: 'Brown', price: 1299, base: 55, style: 'core' },
];
const NEW_LAUNCH = 5;   // week index of the one new launch

/** Picks, per category in sku order, the first unused article of the wanted sub-type, else the next unused one; reuses articles when a category has fewer than it needs. */
function pickArticles(): (HmArticle | null)[] {
  const out: (HmArticle | null)[] = [];
  const used = new Set<string>();
  for (const spec of SPECS) {
    const pool = HM_ARTICLES.filter((a) => a.category === spec.cat).sort((a, b) => (a.sku < b.sku ? -1 : 1));
    const fresh = pool.filter((a) => !used.has(a.sku));
    const from = fresh.length > 0 ? fresh : pool;
    const pick = from.find((a) => a.subType === spec.sub) ?? from[0] ?? null;
    if (pick) used.add(pick.sku);
    out.push(pick);
  }
  return out;
}
const ARTICLES = pickArticles();

export const PRODUCTS: readonly Product[] = SPECS.map((s, i): Product => {
  const a = ARTICLES[i] ?? null;
  const launchWeek = s.role === 'new' ? NEW_LAUNCH : -(8 + ((i * 7) % 36));
  return {
    id: `p${String(i + 1).padStart(2, '0')}`,
    articleId: a?.sku ?? null,
    name: a?.name ?? s.name,
    category: s.cat,
    subType: a?.subType ?? s.sub,
    colour: (a?.rgb ? colourFamily(...a.rgb) : null) ?? s.colour,
    price: s.price,
    cost: Math.round(s.price * 0.55),
    launchWeek,
    launchDate: weekStart(launchWeek),
    style: s.style,
  };
});

// ---- the generator -------------------------------------------------------------------------------------------------------------------------------------------------------

const NP = PRODUCTS.length;
const NS = STORES.length;
const NA = AGE_GROUPS.length;
const STORE_WEIGHT = [1.35, 1.25, 1.2, 0.95, 0.85, 0.8, 0.7, 0.6, 1.5];
const WEIGHT_SUM = STORE_WEIGHT.reduce((a, b) => a + b, 0);
/** Younger shops (Bengaluru, Online) and older ones (Kolkata, Ahmedabad) tilt the age mix a little. */
const AGE_SKEW: Record<string, number[]> = { bengaluru: [1.2, 1.05, 0.9, 0.75], online: [1.15, 1.1, 0.9, 0.75], kolkata: [0.85, 0.95, 1.05, 1.2], ahmedabad: [0.85, 0.95, 1.05, 1.2], pune: [1.1, 1.05, 0.95, 0.85] };
const STYLE_SHARE: Record<Style, number[]> = { street: [0.4, 0.32, 0.18, 0.1], core: [0.17, 0.38, 0.28, 0.17], formal: [0.08, 0.36, 0.34, 0.22] };
const WISH_BY_AGE = [1.8, 1.3, 0.9, 0.6];
const RETURN_RATE: Record<Category, number> = { Tops: 0.06, Bottoms: 0.08, Outerwear: 0.05, Footwear: 0.1, Accessories: 0.03 };
const WOMEN_SHARE: Record<Category, number> = { Tops: 0.12, Bottoms: 0.08, Outerwear: 0.1, Footwear: 0.09, Accessories: 0.15 };
const OTHER_SHARE = 0.03;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
function season(c: Category, t: number): number {
  if (c === 'Outerwear') return 0.45 + 1.25 * sigmoid((t - 20) / 3);   // the winter lift
  if (c === 'Footwear') return 1 + 0.05 * Math.sin(t / 3);
  return 1 + 0.06 * Math.sin(t / 2.5);
}
function growth(spec: Spec, i: number): number {
  if (spec.role === 'best') return 0.012;
  if (spec.role === 'risk') return 0.022;
  if (spec.role === 'slow') return -0.004;
  if (spec.role === 'over') return -0.015;
  if (spec.rising || spec.short) return 0.02;
  return ((i * 37) % 11) / 1000 - 0.003;  // between -0.003 and +0.007 a week
}
const roleOf = (i: number): Role | undefined => SPECS[i]?.role;

// cube[p][s][a][t]
const UN: number[][][][] = [];
const WI: number[][][][] = [];
const RE: number[][][][] = [];
const HAND: number[][][] = [];      // [p][s][t] on hand at week end
const ORD: number[][][] = [];       // [p][s][t] on order at week end
const TOT: number[][][] = [];       // [p][s][t] units, all ages
const VIS: number[][] = [];         // [s][t]

for (let p = 0; p < NP; p++) {
  const spec = SPECS[p] as Spec;
  const launchT = PRE + (PRODUCTS[p] as Product).launchWeek;
  UN.push([]); WI.push([]); RE.push([]); HAND.push([]); ORD.push([]); TOT.push([]);
  for (let s = 0; s < NS; s++) {
    const store = STORES[s] as Store;
    const share = STYLE_SHARE[spec.style];
    const skew = AGE_SKEW[store.id] ?? [1, 1, 1, 1];
    const cell = AGE_GROUPS.map(() => 0.9 + rand() * 0.2);
    const un: number[][] = AGE_GROUPS.map(() => new Array<number>(T).fill(0));
    const wi: number[][] = AGE_GROUPS.map(() => new Array<number>(T).fill(0));
    const re: number[][] = AGE_GROUPS.map(() => new Array<number>(T).fill(0));
    for (let a = 0; a < NA; a++) {
      for (let t = 0; t < T; t++) {
        const surge = spec.surge === AGE_GROUPS[a] && t > T_NOW - 4 ? 1 + 0.12 * (t - (T_NOW - 4)) : 1;
        const lam = t < launchT ? 0
          : spec.base * ((STORE_WEIGHT[s] as number) / WEIGHT_SUM) * (share[a] as number) * (skew[a] as number) * (cell[a] as number) * season(spec.cat, t) * Math.exp(growth(spec, p) * (t - T_NOW)) * surge;
        const noisy = t > T_NOW ? lam : lam * (0.85 + rand() * 0.3);   // the forecast is the smooth expectation
        const u = Math.round(noisy);
        (un[a] as number[])[t] = u;
        (wi[a] as number[])[t] = t < launchT ? 0 : Math.round(noisy * (WISH_BY_AGE[a] as number) * (spec.style === 'street' ? 1.4 : 1) * (t > T_NOW ? 1 : 0.8 + rand() * 0.4));
        (re[a] as number[])[t] = Math.round(noisy * RETURN_RATE[spec.cat] * (t > T_NOW ? 1 : 0.6 + rand() * 0.8));
      }
    }
    UN[p]!.push(un); WI[p]!.push(wi); RE[p]!.push(re);
    TOT[p]!.push(Array.from({ length: T }, (_, t) => un.reduce((acc, row) => acc + (row[t] as number), 0)));
  }
}

/** The weeks of cover the generator aims for at the end of the last actual week, per product and store. */
function targetCover(p: number, s: number): number {
  const spec = SPECS[p] as Spec;
  const sid = (STORES[s] as Store).id;
  const forced = spec.short?.[sid] ?? spec.heavy?.[sid];
  const r = rand();
  if (forced !== undefined) return forced;
  if (spec.role === 'over') return 15 + r * 7;
  if (spec.role === 'slow') return 7 + r * 4;
  if (spec.role === 'best') return 3.6 + r * 2.4;
  if (spec.role === 'risk') return 4.5 + r * 3;          // the other stores of a risky product are fine
  return 3.4 + r * 5.4;
}
const mean = (a: number[], lo: number, hi: number): number => { let sum = 0; let n = 0; for (let i = Math.max(0, lo); i <= hi; i++) { sum += a[i] as number; n++; } return n === 0 ? 0 : sum / n; };

for (let p = 0; p < NP; p++) {
  const spec = SPECS[p] as Spec;
  const launchT = PRE + (PRODUCTS[p] as Product).launchWeek;
  for (let s = 0; s < NS; s++) {
    const tot = TOT[p]![s] as number[];
    const sid = (STORES[s] as Store).id;
    const tight = spec.short?.[sid] !== undefined;
    const heavy = spec.heavy?.[sid] !== undefined || spec.role === 'over';
    const hand = new Array<number>(T).fill(0);
    const arr = new Array<number>(T).fill(0);
    const phase = (p * 3 + s) % 4;
    const planned = (t: number): number => {
      if (t < launchT) return 0;
      if ((tight || spec.role === 'risk') && t >= T_NOW - 3) return 0;   // nothing comes in over the last 4 weeks: that is how the stockout happens
      if (heavy && t >= T_NOW - 5) return 0;
      return (t + phase) % 4 === 0 ? Math.round(4 * mean(tot, Math.min(t, T_NOW) - 3, Math.min(t, T_NOW))) : 0;
    };
    hand[T_NOW] = Math.max(0, Math.round(targetCover(p, s) * mean(tot, T_NOW - 3, T_NOW)));
    for (let t = T_NOW; t >= 1; t--) {
      const cap = (hand[t] as number) + (tot[t] as number);
      arr[t] = t === launchT ? cap : t < launchT ? 0 : Math.min(planned(t), cap);
      hand[t - 1] = cap - (arr[t] as number);
    }
    for (let t = T_NOW + 1; t < T; t++) {
      arr[t] = planned(t);
      hand[t] = Math.max(0, (hand[t - 1] as number) + (arr[t] as number) - (tot[t] as number));
    }
    HAND[p]!.push(hand);
    ORD[p]!.push(hand.map((_, t) => (arr[t + 1] ?? 0) + (arr[t + 2] ?? 0)));
  }
}
for (let s = 0; s < NS; s++) {
  const online = (STORES[s] as Store).online;
  VIS.push(Array.from({ length: T }, (_, t) => {
    let u = 0;
    for (let p = 0; p < NP; p++) u += (TOT[p]![s] as number[])[t] as number;
    return Math.round(u * (online ? 38 : 11 + (s % 3)) * (t > T_NOW ? 1 : 0.9 + rand() * 0.2));
  }));
}

/** Every weekly fact of the 16 weeks shown (12 actual and 4 forecast), per product, store and age group. */
export const WEEKLY_FACTS: readonly WeeklyFact[] = (() => {
  const rows: WeeklyFact[] = [];
  for (let p = 0; p < NP; p++) for (let s = 0; s < NS; s++) for (let a = 0; a < NA; a++) for (let w = 0; w < WEEK_COUNT; w++) {
    const t = PRE + w;
    const units = UN[p]![s]![a]![t] as number;
    rows.push({ product: (PRODUCTS[p] as Product).id, store: (STORES[s] as Store).id, ageGroup: AGE_GROUPS[a] as AgeGroup, week: w, forecast: w >= HISTORY_WEEKS, units, revenue: units * (PRODUCTS[p] as Product).price, wishlistAdds: WI[p]![s]![a]![t] as number, returns: RE[p]![s]![a]![t] as number });
  }
  return rows;
})();
export const STOCK_FACTS: readonly StockFact[] = (() => {
  const rows: StockFact[] = [];
  for (let p = 0; p < NP; p++) for (let s = 0; s < NS; s++) for (let w = 0; w < WEEK_COUNT; w++) rows.push({ product: (PRODUCTS[p] as Product).id, store: (STORES[s] as Store).id, week: w, forecast: w >= HISTORY_WEEKS, onHand: HAND[p]![s]![PRE + w] as number, onOrder: ORD[p]![s]![PRE + w] as number });
  return rows;
})();
export const VISIT_FACTS: readonly VisitFact[] = STORES.flatMap((st, s) => Array.from({ length: WEEK_COUNT }, (_, w) => ({ store: st.id, week: w, forecast: w >= HISTORY_WEEKS, visits: VIS[s]![PRE + w] as number })));

// ---- lookups and scope ---------------------------------------------------------------------------------------------------------------------------------------------------

export type ProductRef = Product | string;
export type StoreRef = Store | string;
const pIndex = (r: ProductRef): number => PRODUCTS.findIndex((p) => p.id === (typeof r === 'string' ? r : r.id));
const sIndex = (r: StoreRef): number => STORES.findIndex((s) => s.id === (typeof r === 'string' ? r : r.id));
export const getProduct = (id: string): Product | undefined => PRODUCTS.find((p) => p.id === id);
export const getStore = (id: string): Store | undefined => STORES.find((s) => s.id === id);
const ALL_A = AGE_GROUPS.map((_, i) => i);
interface Scope { pi: number[]; si: number[]; ai: number[] }
function scopeOf(f: Filters): Scope {
  return {
    pi: PRODUCTS.map((_, i) => i).filter((i) => !f.category || (PRODUCTS[i] as Product).category === f.category),
    si: STORES.map((_, i) => i).filter((i) => (!f.store || (STORES[i] as Store).id === f.store) && (!f.region || (STORES[i] as Store).region === f.region)),
    ai: f.ageGroup ? [AGE_GROUPS.indexOf(f.ageGroup)] : ALL_A,
  };
}
const unitsAt = (p: number, s: number, ai: number[], t: number): number => (ai.length === NA ? (TOT[p]![s] as number[])[t] as number : ai.reduce((acc, a) => acc + (UN[p]![s]![a] as number[])[t]!, 0));
const range = (f: Filters): [number, number] => [T_NOW - f.weeks + 1, T_NOW];
const prevRange = (f: Filters): [number, number] => [T_NOW - 2 * f.weeks + 1, T_NOW - f.weeks];

/** The share of the last 4 weeks' units that the chosen age groups make, used to give an age group its part of the stock (stock is not kept by age). */
function agePart(p: number, s: number, ai: number[], t: number): number {
  if (ai.length === NA) return 1;
  let all = 0; let mine = 0;
  for (let k = t - 3; k <= t; k++) { if (k < 0) continue; all += (TOT[p]![s] as number[])[k] as number; mine += unitsAt(p, s, ai, k); }
  return all === 0 ? ai.length / NA : mine / all;
}

function sumMetric(m: 'units' | 'revenue' | 'wishlist' | 'returns', sc: Scope, t0: number, t1: number): number {
  let sum = 0;
  for (const p of sc.pi) for (const s of sc.si) for (const a of sc.ai) {
    const src = m === 'wishlist' ? WI : m === 'returns' ? RE : UN;
    const row = src[p]![s]![a] as number[];
    let u = 0;
    for (let t = Math.max(0, t0); t <= t1; t++) u += row[t] as number;
    sum += m === 'revenue' ? u * (PRODUCTS[p] as Product).price : u;
  }
  return sum;
}
const stockAt = (sc: Scope, t: number, which: 'hand' | 'order' = 'hand'): number => {
  let sum = 0;
  for (const p of sc.pi) for (const s of sc.si) sum += ((which === 'hand' ? HAND : ORD)[p]![s] as number[])[t]! * agePart(p, s, sc.ai, Math.min(t, T_NOW));
  return sum;
};
/** Average weekly units (all ages) over the 4 weeks ending at t, summed over the products and stores. */
const avg4 = (pi: number[], si: number[], t: number, ai: number[] = ALL_A): number => { let sum = 0; for (const p of pi) for (const s of si) for (let k = t - 3; k <= t; k++) if (k >= 0) sum += unitsAt(p, s, ai, k); return sum / 4; };

const coverOf = (stock: number, weekly: number): number => (weekly > 0 ? Math.min(99, stock / weekly) : stock > 0 ? 99 : 0);
function statusFor(pi: number[], si: number[], t: number, th: Thresholds): { status: StockStatus; cover: number } {
  let stock = 0;
  for (const p of pi) for (const s of si) stock += (HAND[p]![s] as number[])[t] as number;
  const cur = avg4(pi, si, t);
  const prev = t >= 7 ? avg4(pi, si, t - 4) : cur;
  const cover = coverOf(stock, cur);
  const rising = cur > prev;
  const status: StockStatus = cover < th.restockCover && rising ? 'Restock now' : cover < th.watchCover ? 'Watch' : cover > th.overstockCover ? 'Overstock' : 'Healthy';
  return { status, cover };
}

// ---- derived helpers (plan, section 2) -----------------------------------------------------------------------------------------------------------------------------------

/** Sell-through in percent: units sold over the last `weeks` weeks (12 by default) divided by those units plus the stock on hand at the end. One store, or all stores with none. */
export function sellThrough(product: ProductRef, store?: StoreRef, weeks: 4 | 12 = 12): number {
  const p = pIndex(product);
  const si = store === undefined ? STORES.map((_, i) => i) : [sIndex(store)];
  if (p < 0 || si.some((s) => s < 0)) return 0;
  const sc: Scope = { pi: [p], si, ai: ALL_A };
  const sold = sumMetric('units', sc, T_NOW - weeks + 1, T_NOW);
  const stock = stockAt(sc, T_NOW);
  return sold + stock === 0 ? 0 : Math.round((sold / (sold + stock)) * 1000) / 10;
}
/** Weeks of cover: stock on hand divided by the average weekly units of the last 4 weeks (99 when nothing sells). */
export function weeksOfCover(product: ProductRef, store?: StoreRef): number {
  const p = pIndex(product);
  const si = store === undefined ? STORES.map((_, i) => i) : [sIndex(store)];
  if (p < 0 || si.some((s) => s < 0)) return 0;
  return Math.round(statusFor([p], si, T_NOW, DEFAULT_THRESHOLDS).cover * 10) / 10;
}
/** Restock now if cover is under 2 weeks and demand is rising; Watch if under 4; Overstock if over 12; otherwise Healthy. `thresholds` lets the alert settings change this everywhere. */
export function stockStatus(product: ProductRef, store?: StoreRef, thresholds: Thresholds = DEFAULT_THRESHOLDS): StockStatus {
  const p = pIndex(product);
  const si = store === undefined ? STORES.map((_, i) => i) : [sIndex(store)];
  if (p < 0 || si.some((s) => s < 0)) return 'Healthy';
  return statusFor([p], si, T_NOW, thresholds).status;
}
/** The age groups' units for one product (all stores, or those the filters pick) over the filter's period, with each share. */
export function ageMix(product: ProductRef, filters: Filters = DEFAULT_FILTERS): { ageGroup: AgeGroup; units: number; share: number }[] {
  const p = pIndex(product);
  const sc = scopeOf({ ...filters, ageGroup: undefined, category: undefined });
  const [t0, t1] = range(filters);
  const units = AGE_GROUPS.map((_, a) => (p < 0 ? 0 : sumMetric('units', { pi: [p], si: sc.si, ai: [a] }, t0, t1)));
  const total = units.reduce((x, y) => x + y, 0);
  return AGE_GROUPS.map((g, a) => ({ ageGroup: g, units: units[a] as number, share: total === 0 ? 0 : (units[a] as number) / total }));
}
const topAgeOf = (p: number, f: Filters): AgeGroup => { const mix = ageMix(PRODUCTS[p] as Product, f); return mix.reduce((best, m) => (m.units > best.units ? m : best), mix[0] as (typeof mix)[number]).ageGroup; };

/** A restock suggestion for one product at one store: the quantity that reaches 6 weeks of cover (on hand plus on order), rounded up to a pack of 6, and its cost in INR. */
export function restockSuggestion(product: ProductRef, store: StoreRef): { units: number; cost: number } {
  const p = pIndex(product); const s = sIndex(store);
  if (p < 0 || s < 0) return { units: 0, cost: 0 };
  const weekly = avg4([p], [s], T_NOW);
  const have = (HAND[p]![s] as number[])[T_NOW]! + (ORD[p]![s] as number[])[T_NOW]!;
  const need = Math.max(0, TARGET_COVER_WEEKS * weekly - have);
  const units = Math.ceil(need / PACK_SIZE) * PACK_SIZE;
  return { units, cost: units * (PRODUCTS[p] as Product).cost };
}
function lineOf(p: number, s: number, f: Filters, th: Thresholds): RestockLine {
  const prod = PRODUCTS[p] as Product;
  const { status, cover } = statusFor([p], [s], T_NOW, th);
  const sug = restockSuggestion(prod, STORES[s] as Store);
  return { product: prod, store: STORES[s] as Store, status, cover: Math.round(cover * 10) / 10, stockoutDate: iso(WEEK0 + (HISTORY_WEEKS * 7 - 1 + Math.round(cover * 7)) * DAY), onHand: (HAND[p]![s] as number[])[T_NOW]!, onOrder: (ORD[p]![s] as number[])[T_NOW]!, weeklyUnits: Math.round(avg4([p], [s], T_NOW) * 10) / 10, topAge: topAgeOf(p, { ...f, store: undefined, region: undefined }), suggestedUnits: sug.units, cost: sug.cost };
}
/** Every product-and-store line that is "Restock now" under the filters (store, region, category; period and age group do not apply), the earliest stockout first. */
export function needsRestock(filters: Filters = DEFAULT_FILTERS, thresholds: Thresholds = DEFAULT_THRESHOLDS): RestockLine[] {
  const sc = scopeOf(filters);
  const lines: RestockLine[] = [];
  for (const p of sc.pi) for (const s of sc.si) if (statusFor([p], [s], T_NOW, thresholds).status === 'Restock now') lines.push(lineOf(p, s, filters, thresholds));
  return lines.sort((a, b) => (a.stockoutDate === b.stockoutDate ? a.cover - b.cover || b.weeklyUnits - a.weeklyUnits : a.stockoutDate < b.stockoutDate ? -1 : 1));
}
/** The restock lines grouped by product, the most urgent product first: for the "Needs stock now" cards. */
export function needsRestockItems(filters: Filters = DEFAULT_FILTERS, thresholds: Thresholds = DEFAULT_THRESHOLDS): RestockItem[] {
  const by = new Map<string, RestockLine[]>();
  for (const l of needsRestock(filters, thresholds)) by.set(l.product.id, [...(by.get(l.product.id) ?? []), l]);
  return [...by.values()].map((lines): RestockItem => ({ product: (lines[0] as RestockLine).product, lines, stores: lines.map((l) => l.store), cover: Math.min(...lines.map((l) => l.cover)), stockoutDate: (lines[0] as RestockLine).stockoutDate, topAge: (lines[0] as RestockLine).topAge }))
    .sort((a, b) => (a.stockoutDate === b.stockoutDate ? b.stores.length - a.stores.length : a.stockoutDate < b.stockoutDate ? -1 : 1));
}
/** The date the product's stock (at one store, or in all) is expected to run out, YYYY-MM-DD. */
export function stockoutDate(product: ProductRef, store?: StoreRef): string {
  const c = weeksOfCover(product, store);
  return iso(WEEK0 + (HISTORY_WEEKS * 7 - 1 + Math.round(c * 7)) * DAY);
}

/** The top `n` products by units (default) or by sell-through for the period and filters. */
export function topSellers(n: number, filters: Filters = DEFAULT_FILTERS, by: 'units' | 'sellThrough' = 'units'): ProductSummary[] {
  return productSummaries(filters).sort((a, b) => (by === 'units' ? b.units - a.units : b.sellThrough - a.sellThrough || b.units - a.units)).slice(0, Math.max(0, n));
}
/** A product's figures under the filters: units, revenue, sell-through, cover, status, top age group, wishlist adds, returns percent, stock, and its 12 actual weeks of units. */
export function productSummary(product: ProductRef, filters: Filters = DEFAULT_FILTERS, thresholds: Thresholds = DEFAULT_THRESHOLDS): ProductSummary {
  const p = pIndex(product);
  const prod = PRODUCTS[Math.max(p, 0)] as Product;
  const sc = { ...scopeOf(filters), pi: [Math.max(p, 0)] };
  const [t0, t1] = range(filters);
  const units = sumMetric('units', sc, t0, t1);
  const stock = stockAt(sc, T_NOW);
  const weekly = avg4(sc.pi, sc.si, T_NOW, sc.ai);
  const returns = sumMetric('returns', sc, t0, t1);
  const st = statusFor(sc.pi, sc.si, T_NOW, thresholds);
  return {
    product: prod, units, revenue: units * prod.price, sellThrough: units + stock === 0 ? 0 : Math.round((units / (units + stock)) * 1000) / 10,
    cover: Math.round(coverOf(stock, weekly) * 10) / 10, status: st.status, topAge: topAgeOf(Math.max(p, 0), filters), wishlist: sumMetric('wishlist', sc, t0, t1),
    returnsPct: units === 0 ? 0 : Math.round((returns / units) * 1000) / 10, onHand: Math.round(stock), onOrder: Math.round(stockAt(sc, T_NOW, 'order')),
    spark: weekSeries('units', sc, 0, HISTORY_WEEKS - 1),
  };
}
/** Every product that passes the category filter, summarised. */
export function productSummaries(filters: Filters = DEFAULT_FILTERS, thresholds: Thresholds = DEFAULT_THRESHOLDS): ProductSummary[] {
  return scopeOf(filters).pi.map((p) => productSummary(PRODUCTS[p] as Product, filters, thresholds));
}
/** How many products are in each status at a store. */
export function storeHealth(store: StoreRef, thresholds: Thresholds = DEFAULT_THRESHOLDS): Record<StockStatus, number> {
  const s = sIndex(store);
  const counts: Record<StockStatus, number> = { Healthy: 0, Watch: 0, 'Restock now': 0, Overstock: 0 };
  if (s < 0) return counts;
  for (let p = 0; p < NP; p++) counts[statusFor([p], [s], T_NOW, thresholds).status]++;
  return counts;
}
/** A store's figures under the filters (category and age group; the store and region filters pick which stores are listed by `storeSummaries`). */
export function storeSummary(store: StoreRef, filters: Filters = DEFAULT_FILTERS, thresholds: Thresholds = DEFAULT_THRESHOLDS): StoreSummary {
  const s = Math.max(sIndex(store), 0);
  const sc = { ...scopeOf({ ...filters, store: undefined, region: undefined }), si: [s] };
  const [t0, t1] = range(filters);
  const units = sumMetric('units', sc, t0, t1);
  const stock = stockAt(sc, T_NOW);
  const counts: Record<StockStatus, number> = { Healthy: 0, Watch: 0, 'Restock now': 0, Overstock: 0 };
  let best: { p: number; v: number } | null = null; let urgent: { p: number; c: number } | null = null;
  for (const p of sc.pi) {
    const st = statusFor([p], [s], T_NOW, thresholds);
    counts[st.status]++;
    const u = sumMetric('units', { pi: [p], si: [s], ai: sc.ai }, t0, t1);
    if (!best || u > best.v) best = { p, v: u };
    if (st.status === 'Restock now' && (!urgent || st.cover < urgent.c)) urgent = { p, c: st.cover };
  }
  return {
    store: STORES[s] as Store, units, revenue: sumMetric('revenue', sc, t0, t1), sellThrough: units + stock === 0 ? 0 : Math.round((units / (units + stock)) * 1000) / 10,
    cover: Math.round(coverOf(stock, avg4(sc.pi, sc.si, T_NOW, sc.ai)) * 10) / 10, counts, restockCount: counts['Restock now'], spark: weekSeries('revenue', sc, 0, HISTORY_WEEKS - 1),
    best: best ? (PRODUCTS[best.p] as Product) : null, urgent: urgent ? (PRODUCTS[urgent.p] as Product) : null,
  };
}
/** The stores the filters pick (store and region), the one with most "Restock now" lines first. */
export function storeSummaries(filters: Filters = DEFAULT_FILTERS, thresholds: Thresholds = DEFAULT_THRESHOLDS): StoreSummary[] {
  return scopeOf(filters).si.map((s) => storeSummary(STORES[s] as Store, filters, thresholds)).sort((a, b) => b.restockCount - a.restockCount || b.revenue - a.revenue);
}

// ---- series, mixes and matrices -----------------------------------------------------------------------------------------------------------------------------------------

/** One value per public week (0 to 15) of a metric over a scope, from public week `w0` to `w1`. */
function weekSeries(m: Metric, sc: Scope, w0 = 0, w1 = WEEK_COUNT - 1, th: Thresholds = DEFAULT_THRESHOLDS): number[] {
  const out: number[] = [];
  for (let w = w0; w <= w1; w++) {
    const t = PRE + w;
    switch (m) {
      case 'units': case 'revenue': case 'wishlist': case 'returns': out.push(sumMetric(m, sc, t, t)); break;
      case 'visits': out.push(sc.si.reduce((a, s) => a + (VIS[s] as number[])[t]!, 0)); break;
      case 'stock': out.push(Math.round(stockAt(sc, t))); break;
      case 'demand4': { let sum = 0; for (let k = Math.max(0, t - 3); k <= t; k++) sum += sumMetric('units', sc, k, k); out.push(Math.round((sum * 4) / Math.min(4, t + 1))); break; }
      case 'sellThrough': { const u = sumMetric('units', sc, t, t); const st = stockAt(sc, t); out.push(u + st === 0 ? 0 : Math.round((u / (u + st)) * 1000) / 10); break; }
      case 'cover': out.push(Math.round(coverOf(stockAt(sc, t), avg4(sc.pi, sc.si, t, sc.ai)) * 10) / 10); break;
      case 'restockItems': out.push(sc.pi.filter((p) => sc.si.some((s) => statusFor([p], [s], t, th).status === 'Restock now')).length); break;
    }
  }
  return out;
}
/** A metric by week for the 16 weeks (index 0 to 11 actual, 12 to 15 forecast) under the filters. `visits` follows the store and region filters only; `stock`, `cover` and `restockItems` do not use the period. */
export function trend(metric: Metric, filters: Filters = DEFAULT_FILTERS): number[] {
  return weekSeries(metric, scopeOf(filters));
}
/** The same metric split into one series per region, store, category, age group, gender or product. */
export function trendBy(metric: Metric, by: Dimension, filters: Filters = DEFAULT_FILTERS): Series[] {
  const base = scopeOf(filters);
  const mk = (label: string, sc: Scope): Series => ({ label, values: weekSeries(metric, sc) });
  switch (by) {
    case 'region': return REGIONS.filter((r) => base.si.some((s) => (STORES[s] as Store).region === r)).map((r) => mk(r, { ...base, si: base.si.filter((s) => (STORES[s] as Store).region === r) }));
    case 'store': return base.si.map((s) => mk((STORES[s] as Store).name, { ...base, si: [s] }));
    case 'category': return CATEGORIES.filter((c) => base.pi.some((p) => (PRODUCTS[p] as Product).category === c)).map((c) => mk(c, { ...base, pi: base.pi.filter((p) => (PRODUCTS[p] as Product).category === c) }));
    case 'age': return base.ai.map((a) => mk(AGE_GROUPS[a] as AgeGroup, { ...base, ai: [a] }));
    case 'product': return base.pi.map((p) => mk((PRODUCTS[p] as Product).name, { ...base, pi: [p] }));
    case 'gender': return GENDERS.map((g) => { const k = genderFactor(g); return { label: g, values: weekSeries(metric, base).map((v) => Math.round(v * k)) }; });
  }
}
/** The gender share of the units under the filters (the catalogue is menswear, the share of Women is small). */
function genderFactor(g: Gender, cats: readonly Category[] = CATEGORIES, weights?: number[]): number {
  const w = weights ?? cats.map(() => 1);
  const tot = w.reduce((a, b) => a + b, 0) || 1;
  const women = cats.reduce((a, c, i) => a + WOMEN_SHARE[c] * (w[i] as number), 0) / tot;
  return g === 'Women' ? women : g === 'Other or not said' ? OTHER_SHARE : 1 - women - OTHER_SHARE;
}
/** A metric's total over the filter's period, split by a dimension, for pies and bars (`units`, `revenue`, `wishlist`, `returns`). */
export function mix(by: Dimension, metric: 'units' | 'revenue' | 'wishlist' | 'returns', filters: Filters = DEFAULT_FILTERS): Slice[] {
  const base = scopeOf(filters);
  const [t0, t1] = range(filters);
  const val = (sc: Scope) => sumMetric(metric, sc, t0, t1);
  switch (by) {
    case 'region': return REGIONS.map((r) => ({ label: r, value: val({ ...base, si: base.si.filter((s) => (STORES[s] as Store).region === r) }) })).filter((x) => x.value > 0);
    case 'store': return base.si.map((s) => ({ label: (STORES[s] as Store).name, value: val({ ...base, si: [s] }) }));
    case 'category': return CATEGORIES.map((c) => ({ label: c, value: val({ ...base, pi: base.pi.filter((p) => (PRODUCTS[p] as Product).category === c) }) })).filter((x) => x.value > 0);
    case 'age': return base.ai.map((a) => ({ label: AGE_GROUPS[a] as AgeGroup, value: val({ ...base, ai: [a] }) }));
    case 'product': return base.pi.map((p) => ({ label: (PRODUCTS[p] as Product).name, value: val({ ...base, pi: [p] }) }));
    case 'gender': {
      const cats = CATEGORIES.filter((c) => base.pi.some((p) => (PRODUCTS[p] as Product).category === c));
      const w = cats.map((c) => val({ ...base, pi: base.pi.filter((p) => (PRODUCTS[p] as Product).category === c) }));
      const total = w.reduce((a, b) => a + b, 0);
      return GENDERS.map((g) => ({ label: g, value: Math.round(total * genderFactor(g, cats, w)) }));
    }
  }
}
/** The gender split of units under the filters as slices (Men, Women, Other or not said). */
export const genderMix = (filters: Filters = DEFAULT_FILTERS): Slice[] => mix('gender', 'units', filters);
/** Units by category (categories across, one series per age group) for the grouped bar chart. */
export function ageByCategory(filters: Filters = DEFAULT_FILTERS): { categories: string[]; series: Series[] } {
  const base = scopeOf(filters);
  const [t0, t1] = range(filters);
  const cats = CATEGORIES.filter((c) => base.pi.some((p) => (PRODUCTS[p] as Product).category === c));
  return { categories: [...cats], series: base.ai.map((a) => ({ label: AGE_GROUPS[a] as AgeGroup, values: cats.map((c) => sumMetric('units', { pi: base.pi.filter((p) => (PRODUCTS[p] as Product).category === c), si: base.si, ai: [a] }, t0, t1)) })) };
}
/** The top `n` products by units with their units in each of the 4 age groups (columns), and the index of the leading age group of each row. */
export function itemAgeMatrix(filters: Filters = DEFAULT_FILTERS, n = 12): { product: Product; values: number[]; leading: number }[] {
  const base = scopeOf({ ...filters, ageGroup: undefined });
  const [t0, t1] = range(filters);
  return base.pi.map((p) => { const values = ALL_A.map((a) => sumMetric('units', { pi: [p], si: base.si, ai: [a] }, t0, t1)); return { product: PRODUCTS[p] as Product, values, leading: values.indexOf(Math.max(...values)), total: values.reduce((x, y) => x + y, 0) }; })
    .sort((a, b) => b.total - a.total).slice(0, n).map(({ product, values, leading }) => ({ product, values, leading }));
}
/** One product: a row per store (the stores the filters pick), a column per age group, units over the period. */
export function storeAgeMatrix(product: ProductRef, filters: Filters = DEFAULT_FILTERS): { store: Store; values: number[] }[] {
  const p = pIndex(product);
  const base = scopeOf(filters);
  const [t0, t1] = range(filters);
  return base.si.map((s) => ({ store: STORES[s] as Store, values: ALL_A.map((a) => (p < 0 ? 0 : sumMetric('units', { pi: [p], si: [s], ai: [a] }, t0, t1))) }));
}
/** One product: stock, cover, status and sell-through per store (the stores the filters pick). */
export function stockByStore(product: ProductRef, filters: Filters = DEFAULT_FILTERS, thresholds: Thresholds = DEFAULT_THRESHOLDS): { store: Store; onHand: number; onOrder: number; cover: number; status: StockStatus; sellThrough: number }[] {
  const p = pIndex(product);
  return scopeOf(filters).si.map((s) => ({ store: STORES[s] as Store, onHand: p < 0 ? 0 : (HAND[p]![s] as number[])[T_NOW]!, onOrder: p < 0 ? 0 : (ORD[p]![s] as number[])[T_NOW]!, cover: p < 0 ? 0 : Math.round(statusFor([p], [s], T_NOW, thresholds).cover * 10) / 10, status: p < 0 ? 'Healthy' : statusFor([p], [s], T_NOW, thresholds).status, sellThrough: p < 0 ? 0 : sellThrough(PRODUCTS[p] as Product, STORES[s] as Store, filters.weeks) }));
}
/** Sell-through percent by store (the stores the filters pick), for the horizontal bar chart with its 65% target. */
export function sellThroughByStore(filters: Filters = DEFAULT_FILTERS): Slice[] {
  return storeSummaries(filters).sort((a, b) => b.sellThrough - a.sellThrough).map((s) => ({ label: s.store.name, value: s.sellThrough }));
}
/** The actual and forecast weekly units of a product (at one store, or all): 12 actual weeks, 4 forecast weeks, and the week the stock is expected to run out (null if not within the forecast). */
export function forecast(product: ProductRef, store?: StoreRef): { labels: string[]; actual: number[]; forecast: number[]; onHand: number[]; stockoutWeek: number | null } {
  const p = pIndex(product);
  const si = store === undefined ? STORES.map((_, i) => i) : [sIndex(store)];
  const sc: Scope = { pi: [Math.max(p, 0)], si: si.filter((s) => s >= 0), ai: ALL_A };
  const units = weekSeries('units', sc);
  const onHand = weekSeries('stock', sc);
  const out = onHand.findIndex((v, w) => w >= HISTORY_WEEKS && v <= 0);
  return { labels: [...WEEK_LABELS], actual: units.slice(0, HISTORY_WEEKS), forecast: units.slice(HISTORY_WEEKS), onHand, stockoutWeek: out < 0 ? null : out };
}
/** A store's weekly in-store visits and units for the 16 weeks (two series, for the visits-versus-units line chart). */
export function visitsVsUnits(store: StoreRef, filters: Filters = DEFAULT_FILTERS): Series[] {
  const s = sIndex(store);
  const sc: Scope = { ...scopeOf({ ...filters, store: undefined, region: undefined }), si: [Math.max(s, 0)] };
  return [{ label: (STORES[Math.max(s, 0)] as Store).online ? 'Sessions' : 'Visits', values: weekSeries('visits', sc) }, { label: 'Units', values: weekSeries('units', sc) }];
}
/** Total stock on hand against the trailing 4-week demand, 16 weeks (two series, for the inventory-versus-demand area chart). */
export function inventoryVsDemand(filters: Filters = DEFAULT_FILTERS): Series[] {
  return [{ label: 'Stock on hand', values: trend('stock', filters) }, { label: '4-week demand', values: trend('demand4', filters) }];
}

// ---- KPIs and formats ----------------------------------------------------------------------------------------------------------------------------------------------------

const IN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const formatNumber = (n: number): string => IN.format(Math.round(n));
/** ₹ with a lakh or crore suffix from 1,00,000 up: ₹12.4L, ₹1.2Cr, ₹4,999. */
export function formatInr(n: number): string {
  const a = Math.abs(n);
  const t = (v: number) => String(Math.round(v * 10) / 10);
  return `${n < 0 ? '-' : ''}₹${a >= 1e7 ? `${t(a / 1e7)}Cr` : a >= 1e5 ? `${t(a / 1e5)}L` : IN.format(Math.round(a))}`;
}
export const formatPercent = (n: number): string => `${Math.round(n * 10) / 10}%`;
export const formatWeeks = (n: number): string => `${Math.round(n * 10) / 10} wk`;
const change = (cur: number, prev: number): number | null => (prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10);

/** The 6 KPI tiles of the dashboard under the filters: Revenue, Units sold, Sell-through, Average weeks of cover, Items to restock now and Wishlist adds, each with its change versus the previous period of the same length and a 12-week sparkline. */
export function kpis(filters: Filters = DEFAULT_FILTERS, thresholds: Thresholds = DEFAULT_THRESHOLDS): Kpi[] {
  const sc = scopeOf(filters);
  const [t0, t1] = range(filters);
  const [q0, q1] = prevRange(filters);
  const sell = (a: number, b: number) => { const u = sumMetric('units', sc, a, b); const st = stockAt(sc, b); return u + st === 0 ? 0 : (u / (u + st)) * 100; };
  const cover = (t: number) => coverOf(stockAt(sc, t), avg4(sc.pi, sc.si, t, sc.ai));
  const items = (t: number) => sc.pi.filter((p) => sc.si.some((s) => statusFor([p], [s], t, thresholds).status === 'Restock now')).length;
  const spark = (m: Metric) => weekSeries(m, sc, 0, HISTORY_WEEKS - 1, thresholds);
  const rev = sumMetric('revenue', sc, t0, t1); const revP = sumMetric('revenue', sc, q0, q1);
  const un = sumMetric('units', sc, t0, t1); const unP = sumMetric('units', sc, q0, q1);
  const wl = sumMetric('wishlist', sc, t0, t1); const wlP = sumMetric('wishlist', sc, q0, q1);
  const st = sell(t0, t1); const stP = sell(q0, q1);
  const cv = cover(t1); const cvP = cover(q1);
  const it = items(t1); const itP = items(q1);
  return [
    { key: 'revenue', label: 'Revenue', value: rev, unit: 'inr', display: formatInr(rev), previous: revP, changePct: change(rev, revP), spark: spark('revenue') },
    { key: 'units', label: 'Units sold', value: un, unit: 'count', display: formatNumber(un), previous: unP, changePct: change(un, unP), spark: spark('units') },
    { key: 'sellThrough', label: 'Sell-through', value: st, unit: 'percent', display: formatPercent(st), previous: stP, changePct: change(st, stP), spark: spark('sellThrough') },
    { key: 'cover', label: 'Avg weeks of cover', value: cv, unit: 'weeks', display: formatWeeks(cv), previous: cvP, changePct: change(cv, cvP), spark: spark('cover') },
    { key: 'restock', label: 'Items to restock now', value: it, unit: 'count', display: String(it), previous: itP, changePct: change(it, itP), spark: spark('restockItems'), accent: true },
    { key: 'wishlist', label: 'Wishlist adds', value: wl, unit: 'count', display: formatNumber(wl), previous: wlP, changePct: change(wl, wlP), spark: spark('wishlist') },
  ];
}
/** A product's five KPI figures for its page: units, revenue, sell-through, cover, returns percent (period from the filters). */
export function productKpis(product: ProductRef, filters: Filters = DEFAULT_FILTERS): { units: number; revenue: number; sellThrough: number; cover: number; returnsPct: number } {
  const s = productSummary(product, filters);
  return { units: s.units, revenue: s.revenue, sellThrough: s.sellThrough, cover: s.cover, returnsPct: s.returnsPct };
}
