'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { approveTransfer } from '../../../lib/demo-vendor-actions';
import { PRODUCTS, formatWeeks, getProduct } from '../../../lib/demo-vendor-retail';
import { useApprovedTransfers, useThresholdsVersion } from './hooks';
import { Thumb } from './Parts';
import { transferSuggestions } from './transfers';

/** `/vendor/transfers`: suggested moves of one product from an overstocked store to a short one, with the weeks of cover at each end before and after. "Approve" is kept in this browser only. */
export function TransfersView() {
  const fromUrl = useSearchParams().get('product') ?? '';
  const tv = useThresholdsVersion();
  const all = useMemo(transferSuggestions, [tv]);
  const approved = useApprovedTransfers();
  const [product, setProduct] = useState(getProduct(fromUrl) ? fromUrl : '');
  const rows = all.filter((t) => product === '' || t.product.id === product);
  const withMoves = PRODUCTS.filter((p) => all.some((t) => t.product.id === p.id));
  return (
    <div className="wide va">
      <div className="va-filters" role="group" aria-label="Filter the transfers">
        <label>Product<select value={product} onChange={(e) => setProduct(e.target.value)}><option value="">All products</option>{withMoves.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <p className="muted" role="status">{rows.length} suggested {rows.length === 1 ? 'move' : 'moves'}; {rows.filter((t) => approved.includes(t.id)).length} approved. The sender keeps 6 weeks of cover. Approving changes nothing but this list.</p>
      {rows.length === 0 ? <p className="vd-empty">No stock moves are suggested: no store is overstocked while another is short on the same product.</p> : (
        <div className="vd-scroll">
          <table className="vd-table">
            <caption className="ch-sr">Suggested stock transfers</caption>
            <thead><tr><th scope="col" colSpan={2}>Product</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Units</th><th scope="col">Cover at sender</th><th scope="col">Cover at receiver</th><th scope="col">Approval</th></tr></thead>
            <tbody>
              {rows.map((t) => {
                const done = approved.includes(t.id);
                return (
                  <tr key={t.id}>
                    <td className="vp-thumb"><Link href={`/vendor/products/${t.product.id}`} aria-label={`${t.product.name}: product page`}><Thumb product={t.product} /></Link></td>
                    <th scope="row"><Link href={`/vendor/products/${t.product.id}`}>{t.product.name}</Link></th>
                    <td>{t.from.name}</td>
                    <td>{t.to.name}</td>
                    <td className="vd-num">{t.units}</td>
                    <td className="vd-num">{formatWeeks(t.fromBefore)} to {formatWeeks(t.fromAfter)}</td>
                    <td className="vd-num">{formatWeeks(t.toBefore)} to {formatWeeks(t.toAfter)}</td>
                    <td>{done ? <span className="va-status" data-status="Received">Approved</span> : <button type="button" onClick={() => approveTransfer(t.id)} aria-label={`Approve moving ${t.units} ${t.product.name} from ${t.from.name} to ${t.to.name}`}>Approve</button>}</td>
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
