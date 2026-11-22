'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkline, StatusBadge } from '../../ui/charts';
import { ProductPhoto } from '../../ui/ProductPhoto';
import { downloadCsv } from '../../../lib/demo-csv';
import { STOCK_STATUSES, formatInr, formatPercent, formatWeeks, storeSummaries, type Filters, type Product } from '../../../lib/demo-vendor-retail';

function Item({ p, none }: { p: Product | null; none: string }) {
  if (!p) return <span className="muted">{none}</span>;
  return <span className="vd-item"><span className="thumb vd-mini"><ProductPhoto id={p.articleId} name={p.name} /></span><span>{p.name}</span></span>;
}

/** Block 8: one row per store, the one with most "Restock now" lines first. A click on the row (or its name) opens the store page. */
export function StoreBoard({ filters }: { filters: Filters }) {
  const router = useRouter();
  const rows = storeSummaries(filters);
  return (
    <section className="vd-block" aria-labelledby="vd-stores">
      <h2 id="vd-stores">Store status board</h2>
      <p className="muted">Sorted by the number of items to restock now. Select a store to open it.</p>
      <p><button type="button" disabled={rows.length === 0} onClick={() => downloadCsv('northline-store-board.csv', [
        ['Store', 'Region', 'Size', ...STOCK_STATUSES.map((s) => `Items: ${s}`), 'Revenue (INR)', 'Sell-through (%)', 'Weeks of cover', 'Best item', 'Most urgent item'],
        ...rows.map((r) => [r.store.name, r.store.region, r.store.size, ...STOCK_STATUSES.map((s) => r.counts[s]), r.revenue, r.sellThrough, r.cover, r.best?.name ?? '', r.urgent?.name ?? '']),
      ])}>Export CSV</button></p>
      {rows.length === 0 ? <p className="vd-empty">No stores under these filters.</p> : (
        <div className="vd-scroll">
          <table className="vd-table">
            <caption className="ch-sr">Store status board</caption>
            <thead>
              <tr><th scope="col">Store</th><th scope="col">Items by status</th><th scope="col">Revenue</th><th scope="col">Trend</th><th scope="col">Sell-through</th><th scope="col">Cover</th><th scope="col">Best item</th><th scope="col">Most urgent</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.store.id} className="vd-row" onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) router.push(`/vendor/stores/${r.store.id}`); }}>
                  <th scope="row"><Link href={`/vendor/stores/${r.store.id}`}>{r.store.name}</Link><span className="muted">{r.store.online ? 'Online' : `${r.store.region}, size ${r.store.size}`}</span></th>
                  <td><ul className="vd-counts">{STOCK_STATUSES.map((s) => <li key={s}><StatusBadge status={s} /><b>{r.counts[s]}</b></li>)}</ul></td>
                  <td className="vd-num">{formatInr(r.revenue)}</td>
                  <td className="vd-spark"><Sparkline label={`${r.store.name}, revenue per week, last 12 weeks`} values={r.spark} /></td>
                  <td className="vd-num">{formatPercent(r.sellThrough)}</td>
                  <td className="vd-num">{formatWeeks(r.cover)}</td>
                  <td><Item p={r.best} none="None" /></td>
                  <td><Item p={r.urgent} none="None urgent" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
