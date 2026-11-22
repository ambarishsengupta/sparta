'use client';
import { AGE_GROUPS, CATEGORIES, REGIONS, STORES, type AgeGroup, type Category, type Filters, type Region } from '../../../lib/demo-vendor-retail';

/** The sticky global filter bar: period, region, store, age group and category. Every block of the dashboard follows it. Picking a store clears a region it is not in, and the other way round. */
export function FilterBar({ filters, onChange }: { filters: Filters; onChange: (next: Filters) => void }) {
  const stores = STORES.filter((s) => !filters.region || s.region === filters.region);
  const active = filters.region || filters.store || filters.ageGroup || filters.category || filters.weeks === 4;
  return (
    <form className="vd-filters" aria-label="Dashboard filters" onSubmit={(e) => e.preventDefault()}>
      <label>Period
        <select value={filters.weeks} onChange={(e) => onChange({ ...filters, weeks: e.target.value === '4' ? 4 : 12 })}>
          <option value={4}>Last 4 weeks</option>
          <option value={12}>Last 12 weeks</option>
        </select>
      </label>
      <label>Region
        <select value={filters.region ?? ''} onChange={(e) => {
          const region = (e.target.value || undefined) as Region | undefined;
          const keep = filters.store && STORES.find((s) => s.id === filters.store)?.region === region ? filters.store : undefined;
          onChange({ ...filters, region, store: region ? keep : filters.store });
        }}>
          <option value="">All regions</option>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <label>Store
        <select value={filters.store ?? ''} onChange={(e) => onChange({ ...filters, store: e.target.value || undefined })}>
          <option value="">All stores</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label>Age group
        <select value={filters.ageGroup ?? ''} onChange={(e) => onChange({ ...filters, ageGroup: (e.target.value || undefined) as AgeGroup | undefined })}>
          <option value="">All ages</option>
          {AGE_GROUPS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      <label>Category
        <select value={filters.category ?? ''} onChange={(e) => onChange({ ...filters, category: (e.target.value || undefined) as Category | undefined })}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <button type="button" disabled={!active} onClick={() => onChange({ weeks: 12 })}>Reset</button>
    </form>
  );
}
