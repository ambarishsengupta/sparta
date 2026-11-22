import { colourFamily } from '@sparta/taxonomy';
import type { Category } from '@sparta/taxonomy';
import { hostableDemoFlag } from './supabase/config';
import { HM_ARTICLES, hmWardrobes } from './demo-hm';
import type { HmArticle } from './demo-hm';
import { loadDemoWardrobe } from './demo';
import { ymd } from './purchases';
import { LocalRepository } from './local-repository';
import type { StorageLike } from './local-repository';

/**
 * THE NO-LOGIN DEMO OPENS FULL (UI wave 1, local only). On the first visit of `NEXT_PUBLIC_SPARTA_DEMO_NO_LOGIN=1` with H&M articles present, the H&M men's
 * wardrobe is loaded, and the wishlist and purchases get a few believable entries made from the same articles, so no screen is empty. It runs once per browser
 * (a marker in the same storage) and only over an empty wardrobe; the demo-wardrobe menu on the screens stays. Nothing here runs with sign-in.
 */
export const SEED_KEY = 'sparta.demo.seeded.v1';
const MEN = "H&M men's wardrobe (60 items)";
const WISH_CATEGORIES: readonly Category[] = ['Outerwear', 'Footwear', 'Tops', 'Accessories', 'Bottoms', 'Tops'];
const PRICE: Partial<Record<Category, number>> = { Tops: 799, Bottoms: 1499, Footwear: 2999, Outerwear: 3999, Accessories: 899 };
/** A believable rupee price from a base: a step of 100 either side. */
const rupees = (base: number, k: number): number => Math.max(299, base + ((k * 37) % 5 - 2) * 100);
const daysAgo = (n: number): string => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

export const demoSeedWanted = (): boolean => hostableDemoFlag() === '1' && HM_ARTICLES.length > 0 && Object.keys(hmWardrobes(HM_ARTICLES)).includes(MEN);

export async function seedDemo(repo: LocalRepository, storage: StorageLike | null, articles: readonly HmArticle[] = HM_ARTICLES): Promise<void> {
  if (!demoSeedWanted() || storage === null) return;
  try { if (storage.getItem(SEED_KEY)) return; } catch { return; }
  if ((await repo.items.list()).length > 0) return;
  await loadDemoWardrobe(repo, MEN);
  const items = (await repo.items.list()).filter((i) => i.photoId).reverse(); // oldest first, so the picks are the same every time
  const owned = new Set(items.map((i) => i.photoId));
  const spread = Array.from({ length: Math.min(8, items.length) }, (_, k) => items[Math.floor((k * items.length) / 8)]!);
  const days = [4, 11, 19, 33, 47, 62, 78, 96];
  for (const [k, item] of spread.entries()) {
    await repo.purchases.create({ itemId: item.id, date: daysAgo(days[k]!), store: k % 3 === 2 ? 'H&M online' : 'H&M', price: rupees(PRICE[item.category] ?? 899, k), currency: 'INR', quantity: 1, notes: null });
  }
  const used = new Set<string>();
  for (const [k, category] of WISH_CATEGORIES.entries()) {
    const pick = articles.filter((a) => a.category === category && !owned.has(a.sku) && !used.has(a.sku) && a.rgb !== null).sort((a, b) => (a.sku < b.sku ? -1 : 1))[(k * 3) % 9];
    if (!pick || !pick.rgb) continue;
    used.add(pick.sku);
    await repo.wishlist.create({ name: pick.name, subType: pick.subType, colourFamily: colourFamily(...pick.rgb), origin: 'user', note: null, photoId: pick.sku });
  }
  try { storage.setItem(SEED_KEY, '1'); } catch { /* the marker is a courtesy: without it the next visit finds items and does nothing */ }
}
