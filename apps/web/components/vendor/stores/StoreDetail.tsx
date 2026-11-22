'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { BarChart, KpiTile, LineChart, PieChart } from '../../ui/charts';
import { ProductsTable } from '../products/ProductsTable';
import {
  AGE_GROUPS, FORECAST_FROM, WEEK_LABELS, formatInr, formatNumber, formatPercent, formatWeeks, getStore, mix, productSummaries, storeSummary, trend, visitsVsUnits,
  type Filters,
} from '../../../lib/demo-vendor-retail';

const NOTE = 'Simulated demo data: no real users or sales.';

/** `/vendor/stores/[id]` of the no-login demo (vendor plan, section 4). Figures are for the last 12 weeks. An unknown id shows "Not found". */
export function StoreDetail({ id }: { id: string }) {
  const store = getStore(id);
  if (!store) {
    return (
      <>
        <h1>Store</h1>
        <p className="muted">{NOTE}</p>
        <p role="status">Not found: there is no store with this id.</p>
        <p><Link href="/vendor/stores">Back to all stores</Link></p>
      </>
    );
  }
  return <Found id={store.id} />;
}

function Found({ id }: { id: string }) {
  const store = getStore(id)!;
  const f: Filters = useMemo(() => ({ weeks: 12, store: id }), [id]);
  const s = useMemo(() => storeSummary(store, { weeks: 12 }), [store]);
  const revenue = useMemo(() => trend('revenue', f), [f]);
  const cats = useMemo(() => mix('category', 'units', f), [f]);
  const ages = useMemo(() => mix('age', 'units', f), [f]);
  const rows = useMemo(() => productSummaries(f), [f]);
  const vu = useMemo(() => visitsVsUnits(store, { weeks: 12 }), [store]);
  return (
    <div className="wide vd">
      <div>
        <h1>{store.name}</h1>
        <p className="muted">{store.online ? 'Online store' : store.city}, {store.region}, size {store.size}, opened {store.opened}</p>
        <p className="muted">{NOTE}</p>
      </div>
      <section className="vd-block" aria-label="Key figures, last 12 weeks">
        <div className="vd-kpis">
          <div className="vd-kpi"><KpiTile label="Revenue" value={formatInr(s.revenue)} spark={s.spark} sparkLabel={`${store.name}, revenue per week, last 12 weeks`} /></div>
          <div className="vd-kpi"><KpiTile label="Units sold" value={formatNumber(s.units)} /></div>
          <div className="vd-kpi"><KpiTile label="Sell-through" value={formatPercent(s.sellThrough)} /></div>
          <div className="vd-kpi"><KpiTile label="Avg weeks of cover" value={formatWeeks(s.cover)} lowerIsBetter /></div>
          <div className="vd-kpi"><KpiTile label="Items to restock now" value={String(s.restockCount)} accent /></div>
        </div>
      </section>
      <section className="vd-block" aria-label="Revenue and category mix">
        <div className="vd-pair">
          <div className="vd-panel"><LineChart title="Weekly revenue (dashed: forecast)" labels={[...WEEK_LABELS]} series={[{ label: 'Revenue', values: revenue }]} forecastFrom={FORECAST_FROM} valueFormat={formatInr} /></div>
          <div className="vd-panel">{cats.length ? <PieChart title="Category mix (units)" slices={cats} donut totalLabel="Units" valueFormat={formatNumber} /> : <p className="vd-empty">No sales.</p>}</div>
        </div>
      </section>
      <section className="vd-block" aria-label="Age groups and visits">
        <div className="vp-pair">
          <div className="vd-panel"><BarChart title="Units by age group" categories={[...AGE_GROUPS]} series={[{ label: 'Units', values: AGE_GROUPS.map((g) => ages.find((a) => a.label === g)?.value ?? 0) }]} showValues valueFormat={formatNumber} /></div>
          <div className="vd-panel"><LineChart title={`${vu[0]?.label ?? 'Visits'} against units (dashed: forecast)`} labels={[...WEEK_LABELS]} series={vu} forecastFrom={FORECAST_FROM} valueFormat={formatNumber} /></div>
        </div>
      </section>
      <section className="vd-block" aria-labelledby="vs-products">
        <h2 id="vs-products">Products at this store</h2>
        <p className="muted">The most urgent first: Restock now, then the shortest cover. Cover and status are for this store.</p>
        <ProductsTable rows={rows} initialSort="status" initialDir="asc" caption={`Products at ${store.name}`} exportName={`northline-${store.id}-products.csv`} />
      </section>
    </div>
  );
}
