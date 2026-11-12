import { FILTER_DIMS, type Filter, type FilterOption } from '../../lib/vendor/insights';
import type { FilterAction } from '../../lib/vendor/filter-state';

export const NAMES: Record<string, string> = { category: 'Category', colour_family: 'Colour family', fit: 'Fit', brand: 'Brand', size: 'Size', season: 'Season', price_band: 'Price band', region: 'Region' };

/** The order of the price-band lookup (packages/taxonomy priceBands = catalog.lk_price_band sort; a test compares them); filter_options returns the values as text, where '100-200' sorts before '25-50'. */
export const PRICE_BANDS = ['<25', '25-50', '50-100', '100-200', '200+', 'Unknown'];
export function ordered(dim: string, options: FilterOption[]): FilterOption[] {
  const at = (v: string) => { const i = PRICE_BANDS.indexOf(v); return i < 0 ? PRICE_BANDS.length : i; };
  return dim === 'price_band' ? [...options].sort((a, b) => at(a.filter_value) - at(b.filter_value)) : options;
}

/** FR-77: the four filters as selects, one active at a time; the state itself is the reducer of lib/vendor/filter-state.ts (shared by the dashboard and the gaps page). */
export function FilterBar({ filter, options, onFilter }: { filter: Filter; options: FilterOption[]; onFilter: (a: FilterAction) => void }) {
  return (
    <div className="filters" role="group" aria-label="Filter, one at a time">
      {FILTER_DIMS.map((dim) => (
        <label key={dim}>{NAMES[dim]}
          <select value={filter?.dim === dim ? filter.value : ''} onChange={(e) => onFilter(e.target.value ? { type: 'set', dim, value: e.target.value } : { type: 'clear', dim })}>
            <option value="">Any</option>
            {ordered(dim, options.filter((o) => o.filter_dim === dim)).map((o) => <option key={o.filter_value} value={o.filter_value}>{o.filter_value}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}
