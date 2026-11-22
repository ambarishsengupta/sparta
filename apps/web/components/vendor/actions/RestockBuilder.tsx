'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { StatusBadge } from '../../ui/charts';
import { PACK_SIZE, PRODUCTS, STORES, DEMO_TODAY, formatInr, formatNumber, formatWeeks, getProduct, restockSuggestion, stockByStore, type Product, type StockStatus, type Store } from '../../../lib/demo-vendor-retail';
import { createOrder, type DemoOrder } from '../../../lib/demo-vendor-actions';
import { downloadCsv } from '../../../lib/demo-csv';
import { useThresholdsVersion } from './hooks';
import { Thumb } from './Parts';

interface Line { key: string; product: Product; store: Store; status: StockStatus; cover: number; onHand: number; onOrder: number; suggested: number }

const STATUS_RANK: Record<StockStatus, number> = { 'Restock now': 0, Watch: 1, Healthy: 2, Overstock: 3 };
const MAX_UNITS = 600;

/** Every product and store that has a suggested quantity (the quantity that reaches 6 weeks of cover, in packs of 6), the most urgent first. */
function suggestedLines(): Line[] {
  const out: Line[] = [];
  for (const product of PRODUCTS) {
    for (const r of stockByStore(product)) {
      const { units } = restockSuggestion(product, r.store);
      if (units > 0) out.push({ key: `${product.id}:${r.store.id}`, product, store: r.store, status: r.status, cover: r.cover, onHand: r.onHand, onOrder: r.onOrder, suggested: units });
    }
  }
  return out.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.cover - b.cover || a.product.name.localeCompare(b.product.name));
}

/** `/vendor/restock`: the suggested lines, quantities in steps of 6, a running total and "Create order". `?product=<id>` pre-selects that product's lines. */
export function RestockBuilder() {
  const pre = useSearchParams().get('product');
  return <Builder key={pre ?? ''} pre={pre && getProduct(pre) ? pre : ''} />;
}

function Builder({ pre }: { pre: string }) {
  const tv = useThresholdsVersion();
  const lines = useMemo(suggestedLines, [tv]);
  const [product, setProduct] = useState(pre);
  const [store, setStore] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(lines.filter((l) => (pre ? l.product.id === pre : l.status === 'Restock now')).map((l) => l.key)));
  const [created, setCreated] = useState<DemoOrder | null>(null);

  const unitsOf = (l: Line) => qty[l.key] ?? l.suggested;
  const shown = lines.filter((l) => (product === '' || l.product.id === product) && (store === '' || l.store.id === store));
  const picked = lines.filter((l) => ticked.has(l.key));
  const totalUnits = picked.reduce((n, l) => n + unitsOf(l), 0);
  const totalCost = picked.reduce((n, l) => n + unitsOf(l) * l.product.cost, 0);

  const toggle = (key: string) => setTicked((t) => { const n = new Set(t); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const step = (l: Line, by: number) => setQty((q) => ({ ...q, [l.key]: Math.min(MAX_UNITS, Math.max(PACK_SIZE, (q[l.key] ?? l.suggested) + by)) }));
  const create = () => {
    if (picked.length === 0) return;
    setCreated(createOrder(picked.map((l) => ({ productId: l.product.id, storeId: l.store.id, units: unitsOf(l), unitCost: l.product.cost })), DEMO_TODAY));
    setTicked(new Set());
  };
  const exportCsv = () => downloadCsv('northline-restock-list.csv', [
    ['Product', 'Store', 'Status', 'Weeks of cover', 'On hand', 'On order', 'Suggested units', 'Selected', 'Units to order', 'Unit cost (INR)', 'Line cost (INR)'],
    ...shown.map((l) => [l.product.name, l.store.name, l.status, l.cover, l.onHand, l.onOrder, l.suggested, ticked.has(l.key) ? 'Yes' : 'No', unitsOf(l), l.product.cost, unitsOf(l) * l.product.cost]),
  ]);

  return (
    <div className="wide va">
      <div className="va-filters" role="group" aria-label="Filter the suggested lines">
        <label>Product<select value={product} onChange={(e) => setProduct(e.target.value)}><option value="">All products</option>{PRODUCTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Store<select value={store} onChange={(e) => setStore(e.target.value)}><option value="">All stores</option>{STORES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <button type="button" onClick={exportCsv} disabled={shown.length === 0}>Export CSV</button>
      </div>
      {pre ? <p className="muted">Opened for {getProduct(pre)?.name}: its lines are ticked. Choose "All products" to see the rest.</p> : null}

      <section className="va-total" aria-label="Order total">
        <p role="status"><b>{picked.length}</b> {picked.length === 1 ? 'line' : 'lines'} ticked · <b>{formatNumber(totalUnits)}</b> units · <b>{formatInr(totalCost)}</b> at cost</p>
        <button type="button" className="primary" onClick={create} disabled={picked.length === 0}>Create order</button>
      </section>
      {created ? <p className="va-done" role="status">Order {created.number} created (demo only: nothing was sent). <Link href="/vendor/orders">Open the orders</Link></p> : null}

      {shown.length === 0 ? <p className="vd-empty">No suggested lines for these filters: the stock on hand and on order already covers 6 weeks.</p> : (
        <div className="vd-scroll">
          <table className="vd-table">
            <caption className="ch-sr">Suggested restock lines</caption>
            <thead><tr><th scope="col">Tick</th><th scope="col" colSpan={2}>Product</th><th scope="col">Store</th><th scope="col">Status</th><th scope="col">Cover</th><th scope="col">On hand / on order</th><th scope="col">Suggested</th><th scope="col">Units to order</th><th scope="col">Cost</th></tr></thead>
            <tbody>
              {shown.map((l) => {
                const on = ticked.has(l.key);
                const units = unitsOf(l);
                return (
                  <tr key={l.key} data-ticked={on ? 'true' : undefined}>
                    <td><label className="va-check"><input type="checkbox" checked={on} onChange={() => toggle(l.key)} /><span className="ch-sr">Include {l.product.name} at {l.store.name}</span></label></td>
                    <td className="vp-thumb"><Link href={`/vendor/products/${l.product.id}`} aria-label={`${l.product.name}: product page`}><Thumb product={l.product} /></Link></td>
                    <th scope="row"><Link href={`/vendor/products/${l.product.id}`}>{l.product.name}</Link><span className="muted">{l.product.colour}</span></th>
                    <td>{l.store.name}</td>
                    <td><StatusBadge status={l.status} /></td>
                    <td className="vd-num">{formatWeeks(l.cover)}</td>
                    <td className="vd-num">{l.onHand} / {l.onOrder}</td>
                    <td className="vd-num">{l.suggested}</td>
                    <td>
                      <span className="va-step">
                        <button type="button" onClick={() => step(l, -PACK_SIZE)} disabled={units <= PACK_SIZE} aria-label={`Fewer units of ${l.product.name} for ${l.store.name}, ${PACK_SIZE} less`}>−</button>
                        <output aria-label={`Units of ${l.product.name} for ${l.store.name}`}>{units}</output>
                        <button type="button" onClick={() => step(l, PACK_SIZE)} disabled={units >= MAX_UNITS} aria-label={`More units of ${l.product.name} for ${l.store.name}, ${PACK_SIZE} more`}>+</button>
                      </span>
                    </td>
                    <td className="vd-num">{formatInr(units * l.product.cost)}</td>
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
