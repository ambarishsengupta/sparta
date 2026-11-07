/** One row of `app.latest_fx_rates()`: units of `currency` per 1 USD on `rateDate`. */
export type FxRates = Record<string, { rateDate: string; perUsd: number }>;

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** An amount in its own currency with Intl.NumberFormat (FR-33). A code Intl does not know is shown as plain digits and the code. */
export function formatPrice(amount: number, currency: string, locale?: string): string {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount); } catch { return `${round2(amount).toFixed(2)} ${currency}`; }
}

/** amount / per_usd[from] * per_usd[to], rounded to 2 places; null unless BOTH currencies have a rate row (LLD 9.4). The date is the older of the two rows, shown as is. */
export function convert(amount: number, from: string, to: string, rates: FxRates): { amount: number; rateDate: string } | null {
  const a = rates[from];
  const b = rates[to];
  if (!a || !b || !(a.perUsd > 0) || !(b.perUsd > 0)) return null;
  return { amount: round2((amount / a.perUsd) * b.perUsd), rateDate: a.rateDate < b.rateDate ? a.rateDate : b.rateDate };
}

/** The line under a price: the profile-currency amount with its rate date, or null (same currency, or a rate is missing: nothing extra). */
export function secondaryPrice(amount: number, currency: string, profile: string, rates: FxRates, locale?: string): string | null {
  if (currency === profile) return null;
  const c = convert(amount, currency, profile, rates);
  return c ? `about ${formatPrice(c.amount, profile, locale)} at the rate of ${c.rateDate}` : null;
}
