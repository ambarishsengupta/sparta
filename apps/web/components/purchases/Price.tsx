import { formatPrice, secondaryPrice } from '../../lib/money';
import type { FxRates } from '../../lib/money';

/** A price in its stored currency and, when both currencies have a rate, the profile-currency amount with the rate date under it (FR-33); otherwise nothing extra. */
export function Price({ amount, currency, profile, rates }: { amount: number; currency: string; profile: string; rates: FxRates }) {
  const other = secondaryPrice(amount, currency, profile, rates);
  return <span className="amount">{formatPrice(amount, currency)}{other && <span className="muted">{other}</span>}</span>;
}
