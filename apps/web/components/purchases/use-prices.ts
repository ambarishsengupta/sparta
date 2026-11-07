'use client';
import { useEffect, useState } from 'react';
import type { FxRates } from '../../lib/money';
import type { WardrobeRepository } from '../../lib/repository';

/** The profile currency and the newest rates. If either cannot be read the defaults stay (USD, no rates), which shows no converted amounts: nothing extra, never a wrong one. */
export function usePrices(repo: WardrobeRepository | null): { currency: string; rates: FxRates } {
  const [prices, setPrices] = useState<{ currency: string; rates: FxRates }>({ currency: 'USD', rates: {} });
  useEffect(() => {
    if (!repo) return;
    let live = true;
    void Promise.all([repo.prices.currency(), repo.prices.rates()]).then(([currency, rates]) => { if (live) setPrices({ currency, rates }); }, () => undefined);
    return () => { live = false; };
  }, [repo]);
  return prices;
}
