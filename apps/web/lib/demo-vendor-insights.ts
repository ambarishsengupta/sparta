import { demoArticle } from './demo-vendor';

/**
 * FIXED, SIMULATED DEMO DATA for the vendor location pages of the no-login demo (UI wave 3b): where the users are and location-based inventory advice. There are no real users behind any figure.
 * Nothing here is random or read from a network or a database; counts follow the dashboard's rounding (to the nearest 5) and the user counts add up to the dashboard's 410.
 * The photographs are H&M demo articles of NEXT_PUBLIC_HM_DEMO_ARTICLES picked by category and sub-type when the cards are built; with no list a card shows the neutral "No photo yet" tile.
 */
export const SIMULATED_LABEL = 'Simulated demo data: no real users.';

export const AGE_GROUPS = ['18–24', '25–34', '35–44', '45+'] as const;
export const BUDGETS = ['Under ₹1,500', '₹1,500–₹3,000', 'Over ₹3,000'] as const;
export const STYLES = ['Smart casual', 'Streetwear', 'Formal', 'Athleisure', 'Ethnic fusion', 'Minimal'] as const;
export const REGIONS = ['North', 'South', 'East', 'West'] as const;
export const ACTIONS = ['Stock up', 'Hold', 'Reduce', 'Introduce'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];
export type Budget = (typeof BUDGETS)[number];
export type Style = (typeof STYLES)[number];
export type Region = (typeof REGIONS)[number];
export type Action = (typeof ACTIONS)[number];
export type Climate = 'Hot and humid' | 'Hot and dry' | 'Mild or Cool';

export interface DemoCity {
  name: string; lat: number; lon: number; region: Region; users: number; tier: 1 | 2; growth: number;
  /** Shares in percent, in the order of AGE_GROUPS and BUDGETS; each adds to 100. */
  ages: [number, number, number, number]; budgets: [number, number, number]; styles: [Style, Style, Style]; climate: Climate;
}

/** The 14 cities: real latitude and longitude, users rounded to 5 (total 410), tier, 3-month growth in percent, and the demographics. */
export const DEMO_CITIES: readonly DemoCity[] = [
  { name: 'Bengaluru', lat: 12.97, lon: 77.59, region: 'South', users: 65, tier: 1, growth: 18, ages: [22, 42, 24, 12], budgets: [28, 46, 26], styles: ['Smart casual', 'Minimal', 'Streetwear'], climate: 'Hot and humid' },
  { name: 'Mumbai', lat: 19.08, lon: 72.88, region: 'West', users: 60, tier: 1, growth: 12, ages: [26, 38, 22, 14], budgets: [24, 40, 36], styles: ['Streetwear', 'Smart casual', 'Athleisure'], climate: 'Hot and humid' },
  { name: 'Delhi', lat: 28.61, lon: 77.21, region: 'North', users: 55, tier: 1, growth: 9, ages: [20, 36, 28, 16], budgets: [22, 40, 38], styles: ['Formal', 'Smart casual', 'Ethnic fusion'], climate: 'Mild or Cool' },
  { name: 'Hyderabad', lat: 17.39, lon: 78.49, region: 'South', users: 35, tier: 1, growth: 15, ages: [28, 40, 20, 12], budgets: [30, 44, 26], styles: ['Athleisure', 'Smart casual', 'Streetwear'], climate: 'Hot and dry' },
  { name: 'Pune', lat: 18.52, lon: 73.86, region: 'West', users: 30, tier: 1, growth: 21, ages: [30, 42, 18, 10], budgets: [32, 46, 22], styles: ['Smart casual', 'Streetwear', 'Minimal'], climate: 'Mild or Cool' },
  { name: 'Chennai', lat: 13.08, lon: 80.27, region: 'South', users: 30, tier: 1, growth: 7, ages: [18, 36, 28, 18], budgets: [34, 44, 22], styles: ['Smart casual', 'Formal', 'Minimal'], climate: 'Hot and humid' },
  { name: 'Kolkata', lat: 22.57, lon: 88.36, region: 'East', users: 30, tier: 1, growth: 5, ages: [16, 30, 30, 24], budgets: [38, 42, 20], styles: ['Ethnic fusion', 'Formal', 'Smart casual'], climate: 'Hot and humid' },
  { name: 'Ahmedabad', lat: 23.02, lon: 72.57, region: 'West', users: 20, tier: 1, growth: 11, ages: [20, 34, 28, 18], budgets: [40, 40, 20], styles: ['Ethnic fusion', 'Smart casual', 'Formal'], climate: 'Hot and dry' },
  { name: 'Jaipur', lat: 26.91, lon: 75.79, region: 'North', users: 15, tier: 2, growth: 24, ages: [32, 34, 20, 14], budgets: [36, 42, 22], styles: ['Ethnic fusion', 'Streetwear', 'Smart casual'], climate: 'Hot and dry' },
  { name: 'Lucknow', lat: 26.85, lon: 80.95, region: 'North', users: 15, tier: 2, growth: 14, ages: [22, 30, 26, 22], budgets: [42, 38, 20], styles: ['Formal', 'Ethnic fusion', 'Smart casual'], climate: 'Mild or Cool' },
  { name: 'Chandigarh', lat: 30.73, lon: 76.78, region: 'North', users: 15, tier: 2, growth: 19, ages: [30, 38, 20, 12], budgets: [26, 42, 32], styles: ['Streetwear', 'Athleisure', 'Smart casual'], climate: 'Mild or Cool' },
  { name: 'Kochi', lat: 9.93, lon: 76.27, region: 'South', users: 15, tier: 2, growth: 16, ages: [24, 36, 26, 14], budgets: [30, 46, 24], styles: ['Minimal', 'Smart casual', 'Formal'], climate: 'Hot and humid' },
  { name: 'Indore', lat: 22.72, lon: 75.86, region: 'West', users: 15, tier: 2, growth: 22, ages: [34, 36, 18, 12], budgets: [44, 38, 18], styles: ['Streetwear', 'Athleisure', 'Smart casual'], climate: 'Hot and dry' },
  { name: 'Guwahati', lat: 26.14, lon: 91.74, region: 'East', users: 10, tier: 2, growth: 26, ages: [32, 36, 20, 12], budgets: [40, 40, 20], styles: ['Streetwear', 'Minimal', 'Smart casual'], climate: 'Mild or Cool' },
];

/** The dashboard's figure (DEMO_COVERAGE.users_rounded). */
export const DEMO_TOTAL_USERS = 410;

const round5 = (n: number) => Math.round(n / 5) * 5;
export interface UserFilter { age: AgeGroup | ''; budget: Budget | ''; tier: '' | '1' | '2' }
export const NO_USER_FILTER: UserFilter = { age: '', budget: '', tier: '' };

/** The users of a city in the chosen segment: the city's users times the age share and the budget share (the two taken as independent), rounded to 5; 0 for a city outside the chosen tier. */
export function cityUsers(c: DemoCity, f: UserFilter): number {
  if (f.tier !== '' && String(c.tier) !== f.tier) return 0;
  const a = f.age === '' ? 1 : c.ages[AGE_GROUPS.indexOf(f.age)]! / 100;
  const b = f.budget === '' ? 1 : c.budgets[BUDGETS.indexOf(f.budget)]! / 100;
  return f.age === '' && f.budget === '' ? c.users : round5(c.users * a * b);
}
export const leadingAge = (c: DemoCity): AgeGroup => AGE_GROUPS[c.ages.indexOf(Math.max(...c.ages))]!;

// ---- planning advice ------------------------------------------------------------------------------------------------------------------------------------------------

export type Confidence = 'High' | 'Medium' | 'Low';
interface CardSeed {
  place: string; region: Region; age: AgeGroup; segment: { kind: 'budget'; value: Budget } | { kind: 'style'; value: Style };
  action: Action; line: string; change: string; confidence: Confidence; reason: string; opportunity: number;
  category: string; subType: string; family?: string;
}
const SEEDS: readonly CardSeed[] = [
  { place: 'Bengaluru', region: 'South', age: '25–34', segment: { kind: 'style', value: 'Smart casual' }, action: 'Stock up', line: 'Linen-blend shirts, light colours', change: '+30% for the next 8 weeks', confidence: 'High', reason: 'Wishlist adds up 42% among 25–34 in Bengaluru; few owners; hot season', opportunity: 92, category: 'Tops', subType: 'Shirt', family: 'White' },
  { place: 'Mumbai', region: 'West', age: '18–24', segment: { kind: 'style', value: 'Streetwear' }, action: 'Stock up', line: 'Oversized cotton T-shirts', change: '+25% for the next 6 weeks', confidence: 'High', reason: 'Streetwear leads among 18–24 in Mumbai; wishlist adds up 35%; humid weather', opportunity: 88, category: 'Tops', subType: 'T-shirt' },
  { place: 'Delhi', region: 'North', age: '25–34', segment: { kind: 'budget', value: 'Over ₹3,000' }, action: 'Stock up', line: 'Lightweight jackets, dark colours', change: '+35% for the next 10 weeks', confidence: 'High', reason: 'Outerwear wishlists up 75% in six months; the city is cooling; few owners', opportunity: 85, category: 'Outerwear', subType: 'Jacket', family: 'Black' },
  { place: 'Jaipur', region: 'North', age: '18–24', segment: { kind: 'style', value: 'Ethnic fusion' }, action: 'Stock up', line: 'Short kurtas for festive wear', change: '+40% for the next 6 weeks', confidence: 'High', reason: 'Fastest-growing tier 2 city (+24%); ethnic fusion is the top style; festive season', opportunity: 80, category: 'Ethnic wear', subType: 'Kurta' },
  { place: 'Chandigarh', region: 'North', age: '25–34', segment: { kind: 'style', value: 'Streetwear' }, action: 'Stock up', line: 'Heavyweight hoodies', change: '+30% for the next 8 weeks', confidence: 'High', reason: 'Streetwear and athleisure lead; mild or cool now; hoodie wishlists outrun owners 3 to 1', opportunity: 78, category: 'Tops', subType: 'Hoodie' },
  { place: 'Delhi', region: 'North', age: '35–44', segment: { kind: 'style', value: 'Formal' }, action: 'Introduce', line: 'Wool-blend blazers', change: 'Start at 10% of the tops volume for 6 weeks', confidence: 'Medium', reason: 'Formal is the top style for 35–44; no blazer owners visible yet; cooler weeks ahead', opportunity: 74, category: 'Outerwear', subType: 'Blazer' },
  { place: 'Hyderabad', region: 'South', age: '18–24', segment: { kind: 'style', value: 'Athleisure' }, action: 'Stock up', line: 'Track pants, neutral colours', change: '+20% for the next 8 weeks', confidence: 'Medium', reason: 'Athleisure leads among 18–24 in Hyderabad; activewear is under-owned; city growth +15%', opportunity: 70, category: 'Activewear', subType: 'Track pants' },
  { place: 'Pune', region: 'West', age: '25–34', segment: { kind: 'budget', value: '₹1,500–₹3,000' }, action: 'Stock up', line: 'Slim chinos, earth tones', change: '+15% for the next 6 weeks', confidence: 'Medium', reason: 'Fastest-growing tier 1 city (+21%); most users are 25–34 in the middle budget band', opportunity: 66, category: 'Bottoms', subType: 'Chinos', family: 'Beige' },
  { place: 'Guwahati', region: 'East', age: '25–34', segment: { kind: 'style', value: 'Minimal' }, action: 'Stock up', line: 'Light rain jackets', change: '+20% for the next 8 weeks', confidence: 'Low', reason: 'Small base (10 users) but growing +26%; showers expected; outerwear wishlists lead', opportunity: 60, category: 'Outerwear', subType: 'Jacket' },
  { place: 'Indore', region: 'West', age: '18–24', segment: { kind: 'budget', value: 'Under ₹1,500' }, action: 'Introduce', line: 'White sneakers, entry price', change: 'Start with 40 pairs for 6 weeks', confidence: 'Low', reason: 'Most 18–24 users are in the lowest budget band; sneakers are a top wishlist item; small base', opportunity: 55, category: 'Footwear', subType: 'Sneakers', family: 'White' },
  { place: 'Kolkata', region: 'East', age: '45+', segment: { kind: 'style', value: 'Ethnic fusion' }, action: 'Introduce', line: 'Nehru jackets, muted colours', change: 'Start at 5% of the outerwear volume for 8 weeks', confidence: 'Low', reason: 'Highest share of 45+ users (24%); ethnic fusion is the top style; few matching items owned', opportunity: 50, category: 'Ethnic wear', subType: 'Nehru jacket' },
  { place: 'Chennai', region: 'South', age: '25–34', segment: { kind: 'budget', value: 'Under ₹1,500' }, action: 'Hold', line: 'Cotton T-shirts, basics', change: 'Keep the current level for 8 weeks', confidence: 'Medium', reason: 'Purchases and wishlists are level; ownership is already high; city growth is slow (+7%)', opportunity: 40, category: 'Tops', subType: 'T-shirt', family: 'Navy' },
  { place: 'South region', region: 'South', age: '45+', segment: { kind: 'budget', value: '₹1,500–₹3,000' }, action: 'Hold', line: 'Cotton shirts, classic colours', change: 'Keep the current level for 6 weeks', confidence: 'High', reason: 'Steady purchases among 45+ across the four southern cities; no sign of a gap', opportunity: 38, category: 'Tops', subType: 'Shirt', family: 'Blue' },
  { place: 'Lucknow', region: 'North', age: '45+', segment: { kind: 'style', value: 'Formal' }, action: 'Hold', line: 'Leather formal shoes', change: 'Keep the current level for 8 weeks', confidence: 'Low', reason: 'Formal is the top style for 45+; wishlists and ownership are about equal; small base', opportunity: 35, category: 'Footwear', subType: 'Formal shoes', family: 'Brown' },
  { place: 'Kochi', region: 'South', age: '35–44', segment: { kind: 'style', value: 'Minimal' }, action: 'Reduce', line: 'Heavy leather boots', change: '−25% for the next 8 weeks', confidence: 'High', reason: 'Hot and humid now; boot wishlists are falling; owners already outnumber wishers', opportunity: 20, category: 'Footwear', subType: 'Boots', family: 'Black' },
  { place: 'Ahmedabad', region: 'West', age: '35–44', segment: { kind: 'budget', value: 'Under ₹1,500' }, action: 'Reduce', line: 'Wool-blend sweaters', change: '−30% for the next 10 weeks', confidence: 'Medium', reason: 'Hot and dry now; sweater wishlists are the lowest of any city; many owners', opportunity: 22, category: 'Tops', subType: 'Sweater' },
];

export interface PlanCard extends CardSeed { id: string; photoId: string | null; headline: string }

/** The 16 recommendation cards. The photograph is the H&M demo article of the card's category and sub-type (null with no article list), the same every time. */
export const planCards = (): PlanCard[] => SEEDS.map((s, i) => ({
  ...s, id: `plan-${i + 1}`, photoId: demoArticle(s.category, 0, { subType: s.subType, ...(s.family ? { family: s.family } : {}) })?.sku ?? null,
  headline: `${s.action}: ${s.line} in ${s.place}`,
}));

export const segmentText = (c: { age: AgeGroup; segment: CardSeed['segment'] }) => `${c.age} · ${c.segment.value}`;

/** Demand index (0 to 100) by age group (rows) and region (columns). */
export const DEMAND_INDEX: Record<AgeGroup, Record<Region, number>> = {
  '18–24': { North: 72, South: 64, East: 48, West: 82 },
  '25–34': { North: 84, South: 94, East: 56, West: 88 },
  '35–44': { North: 68, South: 60, East: 52, West: 58 },
  '45+': { North: 42, South: 46, East: 50, West: 34 },
};
