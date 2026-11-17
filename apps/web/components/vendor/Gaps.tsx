'use client';
import { useEffect, useReducer, useRef, useState } from 'react';
import { createBrowserSupabase } from '../../lib/supabase/browser';
import type { Base } from '../../lib/vendor/dashboard';
import { NO_OWNERSHIP, loadGaps, type GapsData } from '../../lib/vendor/gaps';
import { filterReducer, type FilterAction } from '../../lib/vendor/filter-state';
import { filterOptions, loadFailed, type Dimension, type Filter, type FilterOption, type GapRow, type Insight } from '../../lib/vendor/insights';
import { Suppressed } from '../ui/vendor';
import styles from '../ui/vendor/vendor-charts.module.css';
import { segmentLabel } from './brand-label';
import { FilterBar } from './FilterBar';

const DIM_NAMES: Record<Dimension, string> = { category: 'Category', colour_family: 'Colour family', fit: 'Fit', brand: 'Brand', category_colour_family: 'Category and colour family', category_fit: 'Category and fit', category_brand: 'Category and brand' };
type Slot<T> = Insight<T> | null; // null: still loading

/** Gap rows as a table (gaps page and report): owner and wishlist user counts, the score, and "no visible ownership" where the owner count is hidden. Segments a filter hides are rows of the suppressed text. */
export function GapsTable({ caption, rows, hidden = [] }: { caption: string; rows: GapRow[]; hidden?: string[] }) {
  return (
    <table className={styles.trend}>
      <caption>{caption}</caption>
      <thead><tr><th scope="col">Segment</th><th scope="col">Owning users</th><th scope="col">Users with it on the wishlist</th><th scope="col">Gap score</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.segment}>
            <th scope="row">{r.segment}</th>
            <td>{r.owner_users_rounded === null ? <Suppressed /> : r.owner_users_rounded}</td>
            <td>{r.wishlist_users_rounded}</td>
            <td>{r.gap_score === null ? (r.label ?? NO_OWNERSHIP) : r.gap_score.toFixed(1)}</td>
          </tr>
        ))}
        {hidden.map((s) => <tr key={s}><th scope="row">{s}</th><td colSpan={3}><Suppressed /></td></tr>)}
      </tbody>
    </table>
  );
}

/** FR-75, FR-77, FR-81: gaps ranked by gap score for one dimension and at most one filter. One call per change of either, with the vendor's own session. */
export function Gaps() {
  const client = useRef<ReturnType<typeof createBrowserSupabase> | null>(null);
  const base = useRef<Base>({});
  const [filter, dispatch] = useReducer(filterReducer, null);
  const [dim, setDim] = useState<Dimension>('category_colour_family');
  const [options, setOptions] = useState<Slot<FilterOption[]>>(null);
  const [data, setData] = useState<Slot<GapsData>>(null);
  const c = () => (client.current ??= createBrowserSupabase());
  useEffect(() => { let live = true; filterOptions(c()).then((r) => live && setOptions(r), () => live && setOptions(loadFailed())); return () => { live = false; }; }, []);
  useEffect(() => { let live = true; setData(null); loadGaps(c(), dim, filter, base.current).then((r) => live && setData(r), () => live && setData(loadFailed())); return () => { live = false; }; }, [dim, filter]);
  return <GapsView dim={dim} filter={filter} options={options} data={data} onDim={setDim} onFilter={dispatch} />;
}

export interface GapsViewProps { dim: Dimension; filter: Filter; options: Slot<FilterOption[]>; data: Slot<GapsData>; onDim: (d: Dimension) => void; onFilter: (a: FilterAction) => void }
/** The markup of the gaps page for the data it was given (no loading, no state). */
export function GapsView({ dim, filter, options, data, onDim, onFilter }: GapsViewProps) {
  const failure = [options, data].find((r) => r && !r.ok);
  return (
    <div className="wide">
      {failure && !failure.ok && <p className="error" role="alert">{failure.message}</p>}
      <FilterBar filter={filter} options={options?.ok ? options.data : []} onFilter={onFilter} />
      <label className={styles.control}>Segment
        <select value={dim} onChange={(e) => onDim(e.target.value as Dimension)}>{Object.entries(DIM_NAMES).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
      </label>
      {data === null ? <p role="status">Loading.</p> : data.ok && (data.data.rows.length || data.data.hidden.length
        ? <GapsTable caption={`Gaps by ${DIM_NAMES[dim].toLowerCase()}, highest gap score first`} rows={data.data.rows.map((r) => ({ ...r, segment: segmentLabel(dim, r.segment) }))} hidden={data.data.hidden.map((h) => segmentLabel(dim, h))} />
        : <p className="muted">No gaps to show. A segment is listed only when at least 10 users contribute to it.</p>)}
    </div>
  );
}
