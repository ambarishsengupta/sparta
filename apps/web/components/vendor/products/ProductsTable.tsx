'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Sparkline, StatusBadge } from '../../ui/charts';
import { ProductPhoto } from '../../ui/ProductPhoto';
import { downloadCsv } from '../../../lib/demo-csv';
import { formatInr, formatNumber, formatPercent, formatWeeks, type ProductSummary, type StockStatus } from '../../../lib/demo-vendor-retail';

type SortKey = 'name' | 'category' | 'price' | 'units' | 'sellThrough' | 'cover' | 'status' | 'topAge';
const RANK: Record<StockStatus, number> = { 'Restock now': 0, Watch: 1, Overstock: 2, Healthy: 3 };
const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Product' }, { key: 'category', label: 'Category' }, { key: 'price', label: 'Price', numeric: true }, { key: 'units', label: 'Units', numeric: true },
  { key: 'sellThrough', label: 'Sell-through', numeric: true }, { key: 'cover', label: 'Cover', numeric: true }, { key: 'status', label: 'Status' }, { key: 'topAge', label: 'Top age' },
];
/** The value a column sorts by. Status sorts by urgency: Restock now first, then the shorter cover first. */
function sortValue(s: ProductSummary, key: SortKey): string | number {
  switch (key) {
    case 'name': return s.product.name;
    case 'category': return s.product.category;
    case 'price': return s.product.price;
    case 'units': return s.units;
    case 'sellThrough': return s.sellThrough;
    case 'cover': return s.cover;
    case 'status': return RANK[s.status] * 1000 + s.cover;
    case 'topAge': return s.topAge;
  }
}
const matches = (s: ProductSummary, q: string): boolean => {
  const p = s.product;
  return [p.name, p.category, p.subType, p.colour, s.status, s.topAge].some((v) => v.toLowerCase().includes(q));
};

/** A sortable table of products (thumbnail, name, category, price, units, sell-through, cover, status, top age group and a 12-week sparkline). With `toolbar` it has a search box and an "Export CSV" button for the rows shown. */
export function ProductsTable({ rows, initialSort = 'units', initialDir = 'desc', toolbar = false, exportName = 'northline-products.csv', caption }: {
  rows: ProductSummary[]; initialSort?: SortKey; initialDir?: 'asc' | 'desc'; toolbar?: boolean; exportName?: string; caption: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: initialSort, dir: initialDir });
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? rows.filter((r) => matches(r, q)) : [...rows];
    const sign = sort.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const x = sortValue(a, sort.key); const y = sortValue(b, sort.key);
      const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : (x as number) - (y as number);
      return c * sign || a.product.name.localeCompare(b.product.name);
    });
  }, [rows, query, sort]);
  const click = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'category' || key === 'topAge' || key === 'cover' || key === 'status' ? 'asc' : 'desc' }));
  const exportCsv = () => downloadCsv(exportName, [
    ['Product', 'Category', 'Sub-type', 'Colour', 'Price (INR)', 'Units', 'Sell-through (%)', 'Weeks of cover', 'Status', 'Top age group'],
    ...shown.map((s) => [s.product.name, s.product.category, s.product.subType, s.product.colour, s.product.price, s.units, s.sellThrough, s.cover, s.status, s.topAge]),
  ]);
  return (
    <div className="vp-table">
      {toolbar ? (
        <div className="vp-tools">
          <label>Search products
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, category, colour or status" autoComplete="off" />
          </label>
          <button type="button" onClick={exportCsv} disabled={shown.length === 0}>Export CSV</button>
        </div>
      ) : null}
      <p className="muted" role="status">{shown.length} of {rows.length} products{query.trim() ? ` match "${query.trim()}"` : ''}.</p>
      {shown.length === 0 ? <p className="vd-empty">No products match.</p> : (
        <div className="vd-scroll">
          <table className="vd-table vd-rows">
            <caption className="ch-sr">{caption}</caption>
            <thead>
              <tr>
                {COLUMNS.map((c, i) => (
                  <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} colSpan={i === 0 ? 2 : 1} className={c.numeric ? 'vd-num' : undefined}>
                    <button type="button" className="vp-sort" onClick={() => click(c.key)}>{c.label}<span aria-hidden="true">{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span></button>
                  </th>
                ))}
                <th scope="col">12 weeks</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.product.id}>
                  <td className="vp-thumb"><Link href={`/vendor/products/${s.product.id}`} aria-label={`${s.product.name}: product page`}><ProductPhoto id={s.product.articleId} name={s.product.name} size="thumb" /></Link></td>
                  <th scope="row"><Link className="vp-name" href={`/vendor/products/${s.product.id}`} title={s.product.name}>{s.product.name}</Link><span className="muted">{s.product.colour}</span></th>
                  <td>{s.product.category}</td>
                  <td className="vd-num">{formatInr(s.product.price)}</td>
                  <td className="vd-num">{formatNumber(s.units)}</td>
                  <td className="vd-num">{formatPercent(s.sellThrough)}</td>
                  <td className="vd-num">{formatWeeks(s.cover)}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td>{s.topAge}</td>
                  <td className="vd-spark"><Sparkline label={`${s.product.name}, units per week, last 12 weeks`} values={s.spark} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
