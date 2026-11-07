import { isDay } from './purchases';
import type { PurchaseDraft } from './purchases';

/** The currencies the form offers (the profile currency is added when it is not here). */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'NZD', 'SGD'] as const;
/** What the purchase form holds, as typed. */
export interface PurchaseFormValues { date: string; store: string; price: string; currency: string; quantity: string; notes: string }
export type PurchaseErrors = Partial<Record<keyof PurchaseFormValues, string>>;
export type PurchaseResult = { ok: true; draft: PurchaseDraft } | { ok: false; errors: PurchaseErrors };

export const emptyPurchase = (today: string, currency: string): PurchaseFormValues => ({ date: today, store: '', price: '', currency, quantity: '1', notes: '' });
export const formFromPurchase = (p: PurchaseDraft): PurchaseFormValues => ({ date: p.date, store: p.store ?? '', price: p.price.toFixed(2), currency: p.currency, quantity: String(p.quantity), notes: p.notes ?? '' });

/** `today` is a `yyyy-mm-dd` day (the person's own, passed in so the check is testable). The price is the price of ONE piece; spend is price x quantity. */
export function validatePurchase(v: PurchaseFormValues, today: string): PurchaseResult {
  const errors: PurchaseErrors = {};
  if (!isDay(v.date)) errors.date = 'Enter the date of the purchase.';
  else if (v.date > today) errors.date = 'The date cannot be in the future.';
  const price = v.price.trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(price)) errors.price = 'Enter the price of one piece, for example 49.90.';
  if (!/^[A-Z]{3}$/.test(v.currency)) errors.currency = 'Choose a currency.';
  const quantity = Number(v.quantity);
  if (!/^\d{1,3}$/.test(v.quantity.trim()) || quantity < 1) errors.quantity = 'Quantity is a whole number from 1 to 999.';
  if (v.store.trim().length > 200) errors.store = 'Keep the store to 200 characters.';
  if (v.notes.trim().length > 1000) errors.notes = 'Keep the notes to 1000 characters.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, draft: { date: v.date, store: v.store.trim() || null, price: Number(price), currency: v.currency, quantity, notes: v.notes.trim() || null } };
}
