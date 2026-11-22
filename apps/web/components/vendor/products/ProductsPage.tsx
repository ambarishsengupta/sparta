'use client';
import { useMemo } from 'react';
import { productSummaries } from '../../../lib/demo-vendor-retail';
import { FilterBar } from '../dashboard/FilterBar';
import { ProductsTable } from './ProductsTable';
import { useUrlFilters } from './useUrlFilters';

/** `/vendor/products` of the no-login demo: the 24 products in a sortable table under the dashboard's filter bar (vendor plan, section 4). */
export function ProductsPage() {
  const [filters, onChange] = useUrlFilters();
  const rows = useMemo(() => productSummaries(filters), [filters]);
  return (
    <div className="wide vd">
      <FilterBar filters={filters} onChange={onChange} />
      <section className="vd-block" aria-labelledby="vp-all">
        <h2 id="vp-all">All products, {filters.weeks === 4 ? 'last 4 weeks' : 'last 12 weeks'}</h2>
        <p className="muted">Select a column heading to sort. Sell-through and units follow the filters; cover and status are for the stores picked.</p>
        <ProductsTable rows={rows} toolbar caption="Products" />
      </section>
    </div>
  );
}
