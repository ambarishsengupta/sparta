'use client';
import Link from 'next/link';
import { Gauge, Sparkline, StatusBadge } from '../../ui/charts';
import { ProductPhoto } from '../../ui/ProductPhoto';
import { SELL_THROUGH_TARGET, formatInr, formatNumber, formatPercent, formatWeeks, type Filters, type ProductSummary, type RestockItem, type Store } from '../../../lib/demo-vendor-retail';
import { needsRestockItems, topSellers } from '../../../lib/demo-vendor-retail';
import { shortDate } from './filters';

const storeList = (stores: Store[]): string => (stores.length <= 2 ? stores.map((s) => s.name).join(', ') : `${stores.slice(0, 2).map((s) => s.name).join(', ')} +${stores.length - 2} more`);

function RestockCard({ item }: { item: RestockItem }) {
  const p = item.product;
  return (
    <li className="vd-card">
      <Link className="vd-card-photo" href={`/vendor/products/${p.id}`} aria-label={`${p.name}: product page`}><ProductPhoto id={p.articleId} name={p.name} size="card" /></Link>
      <div className="vd-card-body">
        <StatusBadge status="Restock now" />
        <h3 className="vd-name" title={p.name}>{p.name}</h3>
        <p className="muted vd-short">Short at {storeList(item.stores)}</p>
        <dl className="vd-facts">
          <div><dt>Cover</dt><dd>{formatWeeks(item.cover)}</dd></div>
          <div><dt>Stockout</dt><dd>{shortDate(item.stockoutDate)}</dd></div>
          <div><dt>Buying most</dt><dd>{item.topAge}</dd></div>
        </dl>
        <Link className="button" href={`/vendor/restock?product=${encodeURIComponent(p.id)}`} aria-label={`Restock ${p.name}`}>Restock</Link>
      </div>
    </li>
  );
}

/** Block 3: the 6 most urgent restock items as photo cards. */
export function NeedsStockStrip({ filters }: { filters: Filters }) {
  const items = needsRestockItems(filters).slice(0, 6);
  return (
    <section className="vd-block" aria-labelledby="vd-needs">
      <h2 id="vd-needs">Needs stock now</h2>
      <p className="muted">The most urgent items first (earliest stockout), with the stores that are short.</p>
      {items.length === 0 ? <p className="vd-empty">Nothing needs stock now under these filters.</p> : <ul className="vd-strip">{items.map((i) => <RestockCard key={i.product.id} item={i} />)}</ul>}
    </section>
  );
}

function BestCard({ s, rank }: { s: ProductSummary; rank: number }) {
  const p = s.product;
  return (
    <li className="vd-card">
      <Link className="vd-card-photo" href={`/vendor/products/${p.id}`} aria-label={`${p.name}: product page`}><ProductPhoto id={p.articleId} name={p.name} size="card" /></Link>
      <div className="vd-card-body">
        <p className="vd-rank">No. {rank}</p>
        <h3 className="vd-name" title={p.name}>{p.name}</h3>
        <dl className="vd-facts">
          <div><dt>Units</dt><dd>{formatNumber(s.units)}</dd></div>
          <div><dt>Revenue</dt><dd>{formatInr(s.revenue)}</dd></div>
          <div><dt>Top age</dt><dd>{s.topAge}</dd></div>
        </dl>
        <Gauge title="Sell-through" value={s.sellThrough} target={SELL_THROUGH_TARGET} maxWidth="9rem" />
        <Sparkline label={`${p.name}, units per week, last 12 weeks`} values={s.spark} />
      </div>
    </li>
  );
}

/** Block 4: the top 6 items by sell-through as photo cards. */
export function BestPerformersStrip({ filters }: { filters: Filters }) {
  const items = topSellers(6, filters, 'sellThrough');
  return (
    <section className="vd-block" aria-labelledby="vd-best">
      <h2 id="vd-best">Best performers</h2>
      <p className="muted">Top 6 items by sell-through ({formatPercent(SELL_THROUGH_TARGET)} is the target).</p>
      {items.length === 0 ? <p className="vd-empty">No items under these filters.</p> : <ul className="vd-strip">{items.map((s, i) => <BestCard key={s.product.id} s={s} rank={i + 1} />)}</ul>}
    </section>
  );
}
