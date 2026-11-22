'use client';
import Link from 'next/link';
import { ORDER_STATUSES, advanceOrder, orderCost, orderUnits, type DemoOrder } from '../../../lib/demo-vendor-actions';
import { downloadCsv } from '../../../lib/demo-csv';
import { formatInr, formatNumber, getProduct, getStore } from '../../../lib/demo-vendor-retail';
import { formatDate } from './format';
import { useOrders } from './hooks';
import { Thumb } from './Parts';

const nextOf = (o: DemoOrder) => ORDER_STATUSES[ORDER_STATUSES.indexOf(o.status) + 1];

/** `/vendor/orders`: the demo orders kept in this browser, newest first, each moved Draft, Placed, In transit, Received with "Advance (demo)". Nothing is sent. */
export function OrdersView() {
  const orders = useOrders();
  const rows = [...orders].reverse();
  const exportCsv = () => downloadCsv('northline-orders.csv', [
    ['Order', 'Date', 'Status', 'Lines', 'Units', 'Cost (INR)'],
    ...rows.map((o) => [o.number, o.date, o.status, o.lines.length, orderUnits(o), orderCost(o)]),
  ]);
  return (
    <div className="wide va">
      <div className="va-filters">
        <Link className="button secondary" href="/vendor/restock">New order from the restock list</Link>
        <button type="button" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
      </div>
      {rows.length === 0 ? <p className="vd-empty">No orders yet. Create one on the <Link href="/vendor/restock">restock page</Link>; it is kept in this browser only.</p> : (
        <div className="vd-scroll">
          <table className="vd-table">
            <caption className="ch-sr">Demo orders</caption>
            <thead><tr><th scope="col">Order</th><th scope="col">Date</th><th scope="col">Lines</th><th scope="col">Units</th><th scope="col">Cost</th><th scope="col">Status</th><th scope="col">Next step</th></tr></thead>
            <tbody>
              {rows.map((o) => {
                const next = nextOf(o);
                return (
                    <tr key={o.number}>
                      <th scope="row">{o.number}</th>
                      <td>{formatDate(o.date)}</td>
                      <td>
                        <details className="va-lines">
                          <summary>{o.lines.length} {o.lines.length === 1 ? 'line' : 'lines'}</summary>
                          <ul>
                            {o.lines.map((l) => {
                              const p = getProduct(l.productId); const s = getStore(l.storeId);
                              return <li key={`${l.productId}:${l.storeId}`}>{p ? <Thumb product={p} /> : null}<span>{p?.name ?? l.productId} at {s?.name ?? l.storeId}: {l.units} units, {formatInr(l.units * l.unitCost)}</span></li>;
                            })}
                          </ul>
                        </details>
                      </td>
                      <td className="vd-num">{formatNumber(orderUnits(o))}</td>
                      <td className="vd-num">{formatInr(orderCost(o))}</td>
                      <td><span className="va-status" data-status={o.status}>{o.status}</span></td>
                      <td>{next ? <button type="button" onClick={() => advanceOrder(o.number)} aria-label={`Advance order ${o.number} from ${o.status} to ${next} (demo)`}>Advance (demo)</button> : <span className="muted">Done</span>}</td>
                    </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
