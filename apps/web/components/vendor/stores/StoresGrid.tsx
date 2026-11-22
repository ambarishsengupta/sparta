'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { Gauge, Sparkline, StatusBadge } from '../../ui/charts';
import { ProductPhoto } from '../../ui/ProductPhoto';
import { DEFAULT_FILTERS, SELL_THROUGH_TARGET, STOCK_STATUSES, formatInr, storeSummaries } from '../../../lib/demo-vendor-retail';

/** `/vendor/stores` of the no-login demo: one card per store (vendor plan, section 4), the store with most "Restock now" items first. Figures are for the last 12 weeks. */
export function StoresGrid() {
  const rows = useMemo(() => storeSummaries(DEFAULT_FILTERS), []);
  return (
    <div className="wide vd">
      <section className="vd-block" aria-labelledby="vs-all">
        <h2 id="vs-all">All stores, last 12 weeks</h2>
        <p className="muted">The store with the most items to restock now comes first. Select a store to open it.</p>
        <ul className="vs-grid">
          {rows.map((r) => (
            <li key={r.store.id} className="vd-card">
              <div className="vd-card-body">
                <h3><Link href={`/vendor/stores/${r.store.id}`}>{r.store.name}</Link></h3>
                <p className="muted">{r.store.online ? 'Online store' : r.store.city}, {r.store.region}, size {r.store.size}</p>
                <ul className="vd-counts">{STOCK_STATUSES.map((s) => <li key={s}><StatusBadge status={s} /><b>{r.counts[s]}</b></li>)}</ul>
                <dl className="vd-facts"><div><dt>Revenue</dt><dd>{formatInr(r.revenue)}</dd></div></dl>
                <Sparkline label={`${r.store.name}, revenue per week, last 12 weeks`} values={r.spark} />
                <Gauge title={`Sell-through, ${r.store.name}`} value={r.sellThrough} target={SELL_THROUGH_TARGET} />
                {r.best ? (
                  <p className="vd-item"><span className="thumb vd-mini"><ProductPhoto id={r.best.articleId} name={r.best.name} /></span><span><span className="muted">Top item</span><br /><Link href={`/vendor/products/${r.best.id}`}>{r.best.name}</Link></span></p>
                ) : <p className="muted">No sales.</p>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
