'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CATEGORIES } from '@sparta/taxonomy';
import { formatPrice } from '../../lib/money';
import { NO_PURCHASE_FILTER, lineTotal, periodRange } from '../../lib/purchases';
import type { Cursor, CurrencyTotal, Period, Purchase, PurchaseFilter } from '../../lib/purchases';
import { messageOf } from '../../lib/supabase/errors';
import { useRepository } from '../use-repository';
import { Price } from './Price';
import { usePrices } from './use-prices';

const PERIODS: [Period | 'custom', string][] = [['all', 'All time'], ['month', 'This month'], ['last30', 'Last 30 days'], ['year', 'This year'], ['custom', 'Custom range']];

/** The Purchases tab (FR-31): newest first, 40 at a time, spend per currency for the chosen period and filters (never summed across currencies). */
export function PurchasesView() {
  const repo = useRepository();
  const { currency, rates } = usePrices(repo);
  const [filter, setFilter] = useState<PurchaseFilter>(NO_PURCHASE_FILTER);
  const [period, setPeriod] = useState<Period | 'custom'>('all');
  const [rows, setRows] = useState<Purchase[] | null>(null);
  const [next, setNext] = useState<Cursor | null>(null);
  const [totals, setTotals] = useState<CurrencyTotal[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!repo) return;
    let live = true;
    setError('');
    void Promise.all([repo.purchases.page(filter), repo.purchases.totals(filter)]).then(
      ([page, sums]) => { if (live) { setRows(page.rows); setNext(page.next); setTotals(sums); } },
      (e) => { if (live) setError(messageOf(e, false)); }, // never an empty list for a failed load
    );
    return () => { live = false; };
  }, [repo, filter]);
  const set = (patch: Partial<PurchaseFilter>) => setFilter({ ...filter, ...patch });
  const more = async () => {
    try { const page = await repo!.purchases.page(filter, next); setRows([...(rows ?? []), ...page.rows]); setNext(page.next); } catch (e) { setError(messageOf(e, false)); }
  };
  const pick = (p: Period | 'custom') => { setPeriod(p); if (p !== 'custom') set(periodRange(p, new Date())); };

  return (
    <>
      <h1>Purchases</h1>
      <form className="filters six" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <label>Period
          <select value={period} onChange={(e) => pick(e.target.value as Period | 'custom')}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label>From<input type="date" value={filter.from} onChange={(e) => { setPeriod('custom'); set({ from: e.target.value }); }} /></label>
        <label>To<input type="date" value={filter.to} onChange={(e) => { setPeriod('custom'); set({ to: e.target.value }); }} /></label>
        <label>Store<input type="text" value={filter.store} onChange={(e) => set({ store: e.target.value })} /></label>
        <label>Brand<input type="text" value={filter.brand} onChange={(e) => set({ brand: e.target.value })} /></label>
        <label>Category
          <select value={filter.category} onChange={(e) => set({ category: e.target.value })}><option value="">All</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {totals && !error && (
        <section aria-labelledby="spend-title">
          <h2 id="spend-title">Total spend</h2>
          {totals.length === 0 ? <p className="muted">No spend for this period.</p> : (
            <dl className="totals">{totals.map((t) => <div key={t.currency}><dt>{t.currency}</dt><dd>{formatPrice(t.total, t.currency)}</dd></div>)}</dl>
          )}
        </section>
      )}
      <p aria-live="polite" className="muted">{rows === null ? (error ? '' : 'Loading…') : `${rows.length} purchase${rows.length === 1 ? '' : 's'} shown`}</p>
      {rows?.length === 0 && !error && <p>No purchases here yet. Open an item and choose Add a purchase, or mark a wishlist entry as bought.</p>}
      <ul className="list">
        {(rows ?? []).map((p) => (
          <li key={p.id} className="card line">
            <div className="grow">
              <Link href={`/items/${p.itemId}`} prefetch={false} className="title">{p.itemName}</Link>
              <p className="muted">{p.date}{p.store ? ` · ${p.store}` : ''}{p.quantity > 1 ? ` · ${p.quantity} × ${formatPrice(p.price, p.currency)}` : ''}</p>
            </div>
            <Price amount={lineTotal(p)} currency={p.currency} profile={currency} rates={rates} />
          </li>
        ))}
      </ul>
      {next && <div className="row"><button type="button" onClick={() => void more()}>Show 40 more</button></div>}
    </>
  );
}
