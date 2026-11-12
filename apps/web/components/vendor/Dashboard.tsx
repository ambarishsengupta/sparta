'use client';
import { CATEGORIES } from '@sparta/taxonomy';
import { useEffect, useReducer, useRef, useState } from 'react';
import { EventLog } from '../../lib/events';
import { createBrowserSupabase } from '../../lib/supabase/browser';
import { INITIAL, MIX_DIMS, TREND_DIMS, loadHeader, loadMix, loadSpectrum, loadTrends, share, viewKey, type Base, type DashState, type Seg, type TrendView } from '../../lib/vendor/dashboard';
import { filterReducer, type FilterAction } from '../../lib/vendor/filter-state';
import type { BandShare, Coverage, FilterOption, Insight } from '../../lib/vendor/insights';
import { BandShareBar, BarList, TrendTable } from '../ui/vendor';
import styles from '../ui/vendor/vendor-charts.module.css';
import { FilterBar, NAMES } from './FilterBar';

type Slot<T> = Insight<T> | null; // null: still loading
const when = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** FR-72 to FR-77, FR-80: the vendor's dashboard. Each view loads once per change of its own selector or of the filter, with the vendor's own session; no polling, no prefetch. The only
 * arithmetic on a returned value is the share division (lib/vendor/dashboard.ts). A segment the filter hides is shown as "Not enough users to display". */
export function Dashboard() {
  const client = useRef<ReturnType<typeof createBrowserSupabase> | null>(null);
  const base = useRef<Base>({});
  const seen = useRef('');
  const [filter, dispatch] = useReducer(filterReducer, null);
  const [pick, setPick] = useState({ mixDim: INITIAL.mixDim, trendDim: INITIAL.trendDim, category: INITIAL.category });
  const s: DashState = { ...pick, filter };
  const [header, setHeader] = useState<{ coverage: Slot<Coverage | null>; options: Slot<FilterOption[]> }>({ coverage: null, options: null });
  const [mix, setMix] = useState<Slot<Seg[]>>(null);
  const [trends, setTrends] = useState<{ purchase: Slot<TrendView>; wishlist: Slot<TrendView> }>({ purchase: null, wishlist: null });
  const [spectrum, setSpectrum] = useState<Slot<BandShare[]>>(null);
  const key = viewKey(s);
  const c = () => (client.current ??= createBrowserSupabase());

  useEffect(() => { let live = true; loadHeader(c()).then((h) => live && setHeader(h)); return () => { live = false; }; }, []);
  useEffect(() => { let live = true; setMix(null); loadMix(c(), s, base.current).then((r) => live && setMix(r)); return () => { live = false; }; }, [pick.mixDim, filter]);
  useEffect(() => { let live = true; setTrends({ purchase: null, wishlist: null }); loadTrends(c(), s, base.current).then((r) => live && setTrends(r)); return () => { live = false; }; }, [pick.trendDim, filter]);
  useEffect(() => { let live = true; setSpectrum(null); loadSpectrum(c(), s).then((r) => live && setSpectrum(r)); return () => { live = false; }; }, [pick.category]);
  // one `vendor_dashboard_viewed` per distinct view (the visit, then each change of selector or filter), never per render
  useEffect(() => { if (seen.current !== key) { seen.current = key; new EventLog().record('vendor_dashboard_viewed'); } }, [key]);

  return <DashboardView s={s} header={header} mix={mix} trends={trends} spectrum={spectrum} onPick={(p) => setPick({ ...pick, ...p })} onFilter={dispatch} />;
}

export interface ViewProps {
  s: DashState; header: { coverage: Slot<Coverage | null>; options: Slot<FilterOption[]> }; mix: Slot<Seg[]>; trends: { purchase: Slot<TrendView>; wishlist: Slot<TrendView> }; spectrum: Slot<BandShare[]>;
  onPick: (p: Partial<Omit<DashState, 'filter'>>) => void; onFilter: (a: FilterAction) => void;
}
/** The markup of the dashboard for the data it was given (no loading, no state), so the states can be rendered and tested without a browser. */
export function DashboardView({ s, header, mix, trends, spectrum, onPick, onFilter }: ViewProps) {
  const cov = header.coverage?.ok ? header.coverage.data : undefined;
  const failure = [header.coverage, header.options, mix, trends.purchase, trends.wishlist, spectrum].find((r) => r && !r.ok);
  const options = header.options?.ok ? header.options.data : [];
  const select = (label: string, value: string, values: readonly string[], onChange: (v: string) => void) => (
    <label className={styles.control}>{label}<select value={value} onChange={(e) => onChange(e.target.value)}>{values.map((v) => <option key={v} value={v}>{NAMES[v] ?? v}</option>)}</select></label>
  );
  const view = (title: string, data: Slot<TrendView>) => data?.ok && (data.data.segments.length ? <TrendTable caption={title} data={data.data} /> : <p className="muted">Nothing to show for this view.</p>);

  return (
    <div className="wide">
      {failure && !failure.ok && <p className="error" role="alert">{failure.message}</p>}
      {!header.coverage ? <p role="status">Loading the figures.</p>
        : cov === null ? <p role="status">No aggregation run yet.</p>
        : cov && <p>Based on {cov.users_rounded === null ? 'a cohort too small to display' : `about ${cov.users_rounded} users`}, counts rounded to the nearest 5. Last aggregation run: {cov.last_run_at ? when(cov.last_run_at) : 'unknown'}.</p>}
      {cov && <>
        <FilterBar filter={s.filter} options={options} onFilter={onFilter} />
        <h2>Ownership mix</h2>
        {select('Segment', s.mixDim, MIX_DIMS, (v) => onPick({ mixDim: v as DashState['mixDim'] }))}
        {mix === null ? <p role="status">Loading.</p> : mix.ok && <BarList name={`Ownership mix by ${NAMES[s.mixDim]!.toLowerCase()}`} max={cov.users_rounded || undefined} rows={mix.data.map((r) => {
          const pct = r.value === null ? null : share(r.value, cov.users_rounded);
          return { label: r.segment, value: r.value, text: r.value === null ? undefined : `${r.value} users${pct === null ? '' : ` / ${pct}%`}` };
        })} />}
        <h2>Trends by month</h2>
        {select('By', s.trendDim, TREND_DIMS, (v) => onPick({ trendDim: v as DashState['trendDim'] }))}
        {view(`Purchases per month by ${s.trendDim.replace('_', ' ')}`, trends.purchase)}
        {view(`Users adding wishlist items per month by ${s.trendDim.replace('_', ' ')}`, trends.wishlist)}
        <h2>Condition spectrum</h2>
        {select('Category', s.category, CATEGORIES, (v) => onPick({ category: v }))}
        {spectrum === null ? <p role="status">Loading.</p> : spectrum.ok && <BandShareBar category={s.category} bands={spectrum.data.map((b) => ({ band: b.band, share: b.share }))} />}
      </>}
    </div>
  );
}
