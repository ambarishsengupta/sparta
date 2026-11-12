import { FILTER_DIMS, type Filter, type FilterOption } from '../../lib/vendor/insights';
import type { FilterAction } from '../../lib/vendor/filter-state';

export const NAMES: Record<string, string> = { category: 'Category', colour_family: 'Colour family', fit: 'Fit', brand: 'Brand', size: 'Size', season: 'Season', price_band: 'Price band', region: 'Region' };

/** FR-77: the four filters as selects, one active at a time; the state itself is the reducer of lib/vendor/filter-state.ts (shared by the dashboard and the gaps page). */
export function FilterBar({ filter, options, onFilter }: { filter: Filter; options: FilterOption[]; onFilter: (a: FilterAction) => void }) {
  return (
    <div className="filters" role="group" aria-label="Filter, one at a time">
      {FILTER_DIMS.map((dim) => (
        <label key={dim}>{NAMES[dim]}
          <select value={filter?.dim === dim ? filter.value : ''} onChange={(e) => onFilter(e.target.value ? { type: 'set', dim, value: e.target.value } : { type: 'clear', dim })}>
            <option value="">Any</option>
            {options.filter((o) => o.filter_dim === dim).map((o) => <option key={o.filter_value} value={o.filter_value}>{o.filter_value}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}
