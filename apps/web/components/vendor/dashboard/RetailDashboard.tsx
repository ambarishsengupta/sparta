'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { KpiTile } from '../../ui/charts';
import { kpis, type Filters } from '../../../lib/demo-vendor-retail';
import { ChartsRow1, ChartsRow2, ChartsRow3 } from './ChartRows';
import { FilterBar } from './FilterBar';
import { ItemAgeHeatmap } from './Heat';
import { StoreBoard } from './StoreBoard';
import { BestPerformersStrip, NeedsStockStrip } from './Strips';
import { filtersFromQuery, queryFromFilters } from './filters';

/** The holistic vendor dashboard of the no-login demo (vendor plan, section 3): what is selling, what needs stock, for whom and where. The one filter state lives here, in the URL query, and is passed down to every block. */
export function RetailDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters: Filters = useMemo(() => filtersFromQuery(params), [params]);
  const onChange = (next: Filters) => { const q = queryFromFilters(next); router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }); };
  const tiles = useMemo(() => kpis(filters), [filters]);
  const period = filters.weeks === 4 ? 'last 4 weeks' : 'last 12 weeks';
  return (
    <div className="wide vd">
      <FilterBar filters={filters} onChange={onChange} />
      <section className="vd-block" aria-label={`Key figures, ${period}`}>
        <div className="vd-kpis">
          {tiles.map((k) => (
            <div key={k.key} className="vd-kpi">
              <KpiTile label={k.label} value={k.display} change={k.changePct} accent={k.accent === true} lowerIsBetter={k.key === 'cover'} spark={k.spark} sparkLabel={`${k.label}, per week, last 12 weeks`} />
              {k.changePct === null ? <span className="vd-new">New</span> : null}
            </div>
          ))}
        </div>
      </section>
      <NeedsStockStrip filters={filters} />
      <BestPerformersStrip filters={filters} />
      <ItemAgeHeatmap filters={filters} />
      <ChartsRow1 filters={filters} />
      <ChartsRow2 filters={filters} />
      <StoreBoard filters={filters} />
      <ChartsRow3 filters={filters} />
    </div>
  );
}
