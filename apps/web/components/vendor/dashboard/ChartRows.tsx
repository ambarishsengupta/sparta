'use client';
import { AreaChart, BarChart, LineChart, PieChart } from '../../ui/charts';
import { FORECAST_FROM, SELL_THROUGH_TARGET, WEEK_LABELS, ageByCategory, formatInr, formatNumber, formatPercent, genderMix, inventoryVsDemand, mix, sellThroughByStore, trendBy, type Filters } from '../../../lib/demo-vendor-retail';

const empty = <p className="vd-empty">No data under these filters.</p>;

/** Block 6: weekly revenue per region with a dashed 4-week forecast, and the category mix as a donut. */
export function ChartsRow1({ filters }: { filters: Filters }) {
  const series = trendBy('revenue', 'region', filters);
  const cats = mix('category', 'units', filters);
  return (
    <section className="vd-block" aria-label="Revenue and category mix">
      <div className="vd-pair">
        <div className="vd-panel">{series.length ? <LineChart title="Weekly revenue by region (dashed: forecast)" labels={[...WEEK_LABELS]} series={series} forecastFrom={FORECAST_FROM} valueFormat={formatInr} /> : empty}</div>
        <div className="vd-panel">{cats.length ? <PieChart title="Category mix (units)" slices={cats} donut totalLabel="Units" valueFormat={formatNumber} /> : empty}</div>
      </div>
    </section>
  );
}

/** Block 7: units by category with one bar per age group, and the gender split. */
export function ChartsRow2({ filters }: { filters: Filters }) {
  const age = ageByCategory(filters);
  const gender = genderMix(filters);
  return (
    <section className="vd-block" aria-label="Age groups and gender">
      <div className="vd-pair">
        <div className="vd-panel">{age.categories.length ? <BarChart title="Units by category and age group" categories={age.categories} series={age.series} mode="grouped" valueFormat={formatNumber} /> : empty}</div>
        <div className="vd-panel">{gender.some((g) => g.value > 0) ? <PieChart title="Gender split (units)" slices={gender} donut totalLabel="Units" valueFormat={formatNumber} /> : empty}</div>
      </div>
    </section>
  );
}

/** Block 9: sell-through by store against the 65% target, and total stock against the 4-week demand. */
export function ChartsRow3({ filters }: { filters: Filters }) {
  const stores = sellThroughByStore(filters);
  const inv = inventoryVsDemand(filters);
  return (
    <section className="vd-block" aria-label="Sell-through by store and inventory against demand">
      <div className="vd-pair">
        <div className="vd-panel">{stores.length ? <BarChart title="Sell-through by store" orientation="horizontal" categories={stores.map((s) => s.label)} series={[{ label: 'Sell-through', values: stores.map((s) => s.value) }]} showValues target={{ value: SELL_THROUGH_TARGET, label: `Target ${formatPercent(SELL_THROUGH_TARGET)}` }} valueFormat={formatPercent} /> : empty}</div>
        <div className="vd-panel"><AreaChart title="Stock on hand against 4-week demand (units)" labels={[...WEEK_LABELS]} series={inv} forecastFrom={FORECAST_FROM} valueFormat={formatNumber} /></div>
      </div>
    </section>
  );
}
