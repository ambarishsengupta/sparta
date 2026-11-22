'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { BarChart, Heatmap, KpiTile, LineChart, PieChart, StatusBadge } from '../../ui/charts';
import { ProductPhoto } from '../../ui/ProductPhoto';
import {
  AGE_GROUPS, DEFAULT_FILTERS, FORECAST_FROM, WEEK_LABELS, ageMix, forecast, formatInr, formatNumber, formatPercent, formatWeeks, getProduct, mix, productKpis, productSummary, stockByStore, stockoutDate, storeAgeMatrix,
  type Product,
} from '../../../lib/demo-vendor-retail';
import { shortDate } from '../dashboard/filters';

const NOTE = 'Simulated demo data: no real users or sales.';

/** `/vendor/products/[id]` of the no-login demo (vendor plan, section 4). Figures are for the last 12 weeks and all stores. An unknown id shows "Not found". */
export function ProductDetail({ id }: { id: string }) {
  const product = getProduct(id);
  if (!product) {
    return (
      <>
        <h1>Product</h1>
        <p className="muted">{NOTE}</p>
        <p role="status">Not found: there is no product with this id.</p>
        <p><Link href="/vendor/products">Back to all products</Link></p>
      </>
    );
  }
  return <Found product={product} />;
}

function Found({ product }: { product: Product }) {
  const f = DEFAULT_FILTERS;
  const s = useMemo(() => productSummary(product, f), [product, f]);
  const k = useMemo(() => productKpis(product, f), [product, f]);
  const fc = useMemo(() => forecast(product), [product]);
  const ages = useMemo(() => ageMix(product, f), [product, f]);
  const stores = useMemo(() => stockByStore(product, f), [product, f]);
  const heat = useMemo(() => storeAgeMatrix(product, f), [product, f]);
  // The gender split is the category's split (Men, Women, Other or not said) applied to this product's units.
  const gender = useMemo(() => {
    const share = mix('gender', 'units', { ...f, category: product.category });
    const total = share.reduce((a, g) => a + g.value, 0) || 1;
    return share.map((g) => ({ label: g.label, value: Math.round((g.value / total) * s.units) }));
  }, [product, f, s.units]);
  const out = stockoutDate(product);
  return (
    <div className="wide vd">
      <div>
        <h1>{product.name}</h1>
        <p className="muted">{NOTE}</p>
      </div>
      <section className="vp-head" aria-label="Product facts">
        <div className="vp-photo"><ProductPhoto id={product.articleId} name={product.name} /></div>
        <div className="vp-facts">
          <StatusBadge status={s.status} />
          <dl className="vd-facts">
            <div><dt>Category</dt><dd>{product.category}, {product.subType}</dd></div>
            <div><dt>Colour</dt><dd>{product.colour}</dd></div>
            <div><dt>Price</dt><dd>{formatInr(product.price)}</dd></div>
            <div><dt>Cost</dt><dd>{formatInr(product.cost)}</dd></div>
            <div><dt>On sale since</dt><dd>{shortDate(product.launchDate)}</dd></div>
            <div><dt>Top age group</dt><dd>{s.topAge}</dd></div>
            <div><dt>On hand</dt><dd>{formatNumber(s.onHand)}</dd></div>
            <div><dt>On order</dt><dd>{formatNumber(s.onOrder)}</dd></div>
            <div><dt>Expected stockout</dt><dd>{shortDate(out)}</dd></div>
            <div><dt>Wishlist adds</dt><dd>{formatNumber(s.wishlist)}</dd></div>
          </dl>
          <Link className="button" href={`/vendor/restock?product=${encodeURIComponent(product.id)}`} aria-label={`Restock ${product.name}`}>Restock</Link>
        </div>
      </section>
      <section className="vd-block" aria-label="Key figures, last 12 weeks">
        <div className="vd-kpis">
          <div className="vd-kpi"><KpiTile label="Units" value={formatNumber(k.units)} spark={s.spark} sparkLabel={`${product.name}, units per week, last 12 weeks`} /></div>
          <div className="vd-kpi"><KpiTile label="Revenue" value={formatInr(k.revenue)} /></div>
          <div className="vd-kpi"><KpiTile label="Sell-through" value={formatPercent(k.sellThrough)} /></div>
          <div className="vd-kpi"><KpiTile label="Weeks of cover" value={formatWeeks(k.cover)} lowerIsBetter /></div>
          <div className="vd-kpi"><KpiTile label="Returns" value={formatPercent(k.returnsPct)} lowerIsBetter /></div>
        </div>
      </section>
      <section className="vd-block" aria-label="Weekly units">
        <div className="vd-panel">
          <LineChart title="Weekly units (dashed: forecast)" labels={[...WEEK_LABELS]} series={[{ label: 'Units', values: [...fc.actual, ...fc.forecast] }]} forecastFrom={FORECAST_FROM} valueFormat={formatNumber} />
          <p className="muted">{fc.stockoutWeek === null ? 'Stock lasts through the 4-week forecast.' : `Stock is forecast to run out in the week of ${WEEK_LABELS[fc.stockoutWeek] ?? ''}.`}</p>
        </div>
      </section>
      <section className="vd-block" aria-label="Who buys it">
        <div className="vp-pair">
          <div className="vd-panel">{s.units > 0 ? <PieChart title="Units by age group" slices={ages.map((a) => ({ label: a.ageGroup, value: a.units }))} donut totalLabel="Units" valueFormat={formatNumber} /> : <p className="vd-empty">No sales yet.</p>}</div>
          <div className="vd-panel"><BarChart title="Units by gender" categories={gender.map((g) => g.label)} series={[{ label: 'Units', values: gender.map((g) => g.value) }]} showValues valueFormat={formatNumber} /></div>
        </div>
      </section>
      <section className="vd-block" aria-labelledby="vp-stock">
        <h2 id="vp-stock">Stock by store</h2>
        <p className="muted">Stock on hand and on order. Weeks of cover is in each store&apos;s label.</p>
        <div className="vd-panel">
          <BarChart
            title="Stock by store (units)" orientation="horizontal" mode="stacked"
            categories={stores.map((r) => `${r.store.name} (${formatWeeks(r.cover)})`)}
            series={[{ label: 'On hand', values: stores.map((r) => r.onHand) }, { label: 'On order', values: stores.map((r) => r.onOrder) }]}
            valueFormat={formatNumber}
          />
        </div>
      </section>
      <section className="vd-block" aria-labelledby="vp-heat">
        <h2 id="vp-heat">Stores by age group</h2>
        <p className="muted">Units sold in the last 12 weeks.</p>
        <Heatmap title="Units sold by store and age group" rowLabels={heat.map((r) => r.store.name)} columnLabels={[...AGE_GROUPS]} values={heat.map((r) => r.values)} valueFormat={formatNumber} />
      </section>
    </div>
  );
}
