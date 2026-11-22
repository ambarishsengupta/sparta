'use client';
import { useEffect, useReducer, useRef, useState } from 'react';
import { isNoLoginDemo } from '../../lib/demo-mode';
import { DEMO_GAPS, demoGapRows } from '../../lib/demo-vendor';
import { createBrowserSupabase } from '../../lib/supabase/browser';
import { NO_BRAND_LABELS, loadBrandLabels, type BrandLabels } from '../../lib/vendor/brands';
import type { Base } from '../../lib/vendor/dashboard';
import { NO_OWNERSHIP, loadGaps, type GapsData } from '../../lib/vendor/gaps';
import { filterReducer, type FilterAction } from '../../lib/vendor/filter-state';
import { filterOptions, loadFailed, type Dimension, type Filter, type FilterOption, type GapRow, type Insight } from '../../lib/vendor/insights';
import { ProductPhoto } from '../ui/ProductPhoto';
import { Suppressed } from '../ui/vendor';
import styles from '../ui/vendor/vendor-charts.module.css';
import { segmentLabel } from './brand-label';
import { FilterBar } from './FilterBar';

const DIM_NAMES: Record<Dimension, string> = { category: 'Category', colour_family: 'Colour family', fit: 'Fit', brand: 'Brand', category_colour_family: 'Category and colour family', category_fit: 'Category and fit', category_brand: 'Category and brand' };
type Slot<T> = Insight<T> | null; // null: still loading

/** Gap rows as a table (gaps page and report): owner and wishlist user counts, the score, and "no visible ownership" where the owner count is hidden. Segments a filter hides are rows of the suppressed text. */
export function GapsTable({ caption, rows, hidden = [] }: { caption: string; rows: (GapRow & { code?: string; photo?: string | null })[]; hidden?: string[] }) {
  const photos = rows.some((r) => r.photo !== undefined);   // the no-login demo shows a photo in each row; the account-backed table has none
  return (
    <table className={styles.trend}>
      <caption>{caption}</caption>
      <thead><tr>{photos && <th scope="col" className="photo-col"><span className="sr-only">Photo</span></th>}<th scope="col">Segment</th><th scope="col">Owning users</th><th scope="col">Users with it on the wishlist</th><th scope="col">Gap score</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.code ?? r.segment}>
            {photos && <td><div className="thumb"><ProductPhoto id={r.photo} name={r.segment} /></div></td>}
            <th scope="row">{r.segment}</th>
            <td>{r.owner_users_rounded === null ? <Suppressed /> : r.owner_users_rounded}</td>
            <td>{r.wishlist_users_rounded}</td>
            <td>{r.gap_score === null ? (r.label ?? NO_OWNERSHIP) : r.gap_score.toFixed(1)}</td>
          </tr>
        ))}
        {hidden.map((s, i) => <tr key={`${i}-${s}`}>{photos && <td />}<th scope="row">{s}</th><td colSpan={3}><Suppressed /></td></tr>)}
      </tbody>
    </table>
  );
}

/** FR-75, FR-77, FR-81: gaps ranked by gap score for one dimension and at most one filter. One call per change of either, with the vendor's own session. */
export function Gaps() {
  return isNoLoginDemo() ? <DemoGaps /> : <LiveGaps />;
}

/** The no-login demo: eight demo segments, each row with the photograph of a representative article. */
function DemoGaps() {
  return <div className="wide"><GapsTable caption="Gaps by category and colour family, highest gap score first" rows={demoGapRows(DEMO_GAPS)} /></div>;
}

function LiveGaps() {
  const client = useRef<ReturnType<typeof createBrowserSupabase> | null>(null);
  const base = useRef<Base>({});
  const [filter, dispatch] = useReducer(filterReducer, null);
  const [dim, setDim] = useState<Dimension>('category_colour_family');
  const [options, setOptions] = useState<Slot<FilterOption[]>>(null);
  const [data, setData] = useState<Slot<GapsData>>(null);
  const [brands, setBrands] = useState<BrandLabels>(NO_BRAND_LABELS);
  const c = () => (client.current ??= createBrowserSupabase());
  useEffect(() => { let live = true; loadBrandLabels(c()).then((m) => live && setBrands(m), () => live && setBrands(NO_BRAND_LABELS)); return () => { live = false; }; }, []);   // once per page; a failed read keeps the guessed labels, silently
  useEffect(() => { let live = true; filterOptions(c()).then((r) => live && setOptions(r), () => live && setOptions(loadFailed())); return () => { live = false; }; }, []);
  useEffect(() => { let live = true; setData(null); loadGaps(c(), dim, filter, base.current).then((r) => live && setData(r), () => live && setData(loadFailed())); return () => { live = false; }; }, [dim, filter]);
  return <GapsView dim={dim} filter={filter} options={options} data={data} brands={brands} onDim={setDim} onFilter={dispatch} />;
}

export interface GapsViewProps { dim: Dimension; filter: Filter; options: Slot<FilterOption[]>; data: Slot<GapsData>; brands?: BrandLabels; onDim: (d: Dimension) => void; onFilter: (a: FilterAction) => void }
/** The markup of the gaps page for the data it was given (no loading, no state). */
export function GapsView({ dim, filter, options, data, brands, onDim, onFilter }: GapsViewProps) {
  const failure = [options, data].find((r) => r && !r.ok);
  return (
    <div className="wide">
      {failure && !failure.ok && <p className="error" role="alert">{failure.message}</p>}
      <FilterBar filter={filter} options={options?.ok ? options.data : []} onFilter={onFilter} />
      <label className={styles.control}>Segment
        <select value={dim} onChange={(e) => onDim(e.target.value as Dimension)}>{Object.entries(DIM_NAMES).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
      </label>
      {data === null ? <p role="status">Loading.</p> : data.ok && (data.data.rows.length || data.data.hidden.length
        ? <GapsTable caption={`Gaps by ${DIM_NAMES[dim].toLowerCase()}, highest gap score first`} rows={data.data.rows.map((r) => ({ ...r, code: r.segment, segment: segmentLabel(dim, r.segment, brands) }))} hidden={data.data.hidden.map((h) => segmentLabel(dim, h, brands))} />
        : <p className="muted">No gaps to show. A segment is listed only when at least 10 users contribute to it.</p>)}
    </div>
  );
}
