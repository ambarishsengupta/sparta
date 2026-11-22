'use client';
import { useId } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

/**
 * Shared parts of the vendor chart kit: types, the palette slots, the hatch patterns, the axis scale, the tooltip, the legend swatch and the frame every chart sits in.
 * Hand-built SVG, no outside library. Colours come only from the CSS variables --chart-1 to --chart-6 (app/globals.css); slots 5 and 6 are drawn as hatched patterns.
 */
export interface Series { label: string; values: number[] }
export interface Slice { label: string; value: number }
export type ValueFormat = (n: number) => string;

const NF = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
/** The default tooltip and table format: Indian digit grouping, at most one decimal. */
export const formatValue: ValueFormat = (n) => NF.format(n);
/** A short axis label: 1.2k, 3.4L (lakh), 1.1Cr (crore). */
export function compact(n: number): string {
  const a = Math.abs(n);
  const t = (v: number) => String(Math.round(v * 10) / 10);
  if (a >= 1e7) return `${t(n / 1e7)}Cr`;
  if (a >= 1e5) return `${t(n / 1e5)}L`;
  if (a >= 1e3) return `${t(n / 1e3)}k`;
  return t(n);
}

// ---- palette slots ------------------------------------------------------------------------------------------------------------------------------------------------------

/** At most this many series in one chart; the rest fold into "Other" (slot 4). */
export const MAX_SERIES = 6;
export const OTHER_LABEL = 'Other';
const FULL_SLOTS = [1, 2, 3, 4, 5, 6];
const FOLDED_SLOTS = [1, 2, 3, 5, 6, 4];   // with a fold, "Other" takes slot 4 and the five kept series take the rest

export interface Prepared<T> { items: T[]; slots: number[] }
function foldBy<T extends { label: string }>(items: T[], total: (t: T) => number, merge: (rest: T[]) => T): Prepared<T> {
  if (items.length <= MAX_SERIES) return { items, slots: FULL_SLOTS.slice(0, items.length) };
  const keep = new Set([...items.keys()].sort((a, b) => total(items[b] as T) - total(items[a] as T)).slice(0, MAX_SERIES - 1));
  const kept = items.filter((_, i) => keep.has(i));
  const rest = items.filter((_, i) => !keep.has(i));
  return { items: [...kept, merge(rest)], slots: FOLDED_SLOTS };
}
/** Keeps the five largest series (in their own order) and sums the rest into "Other" when there are more than six. */
export function foldSeries(series: Series[]): Prepared<Series> {
  return foldBy(series, (s) => s.values.reduce((a, b) => a + b, 0), (rest) => ({ label: OTHER_LABEL, values: (rest[0]?.values ?? []).map((_, i) => rest.reduce((a, s) => a + (s.values[i] ?? 0), 0)) }));
}
export function foldSlices(slices: Slice[]): Prepared<Slice> {
  return foldBy(slices, (s) => s.value, (rest) => ({ label: OTHER_LABEL, value: rest.reduce((a, s) => a + s.value, 0) }));
}

export const slotVar = (slot: number): string => `var(--chart-${slot})`;
/** The fill of a slot: the CSS variable, or the hatch pattern of this chart for slots 5 and 6. */
export const fillFor = (slot: number, id: string): string => (slot === 5 || slot === 6 ? `url(#${id}-h${slot})` : slotVar(slot));
/** The text colour that reads on a slot's fill. */
export const textOn = (slot: number): string => (slot === 1 ? 'var(--on-accent)' : slot === 2 ? 'var(--on-ink)' : slot === 3 ? 'var(--bg)' : 'var(--text)');

export function useChartId(): string { return `ch${useId().replace(/[^a-zA-Z0-9]/g, '')}`; }

/** The two hatch patterns (slot 5: the accent, slot 6: the ink) of one chart. */
export function HatchDefs({ id }: { id: string }) {
  return (
    <defs>
      {[5, 6].map((slot) => (
        <pattern key={slot} id={`${id}-h${slot}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" style={{ fill: 'var(--bg)' }} />
          <rect width="2.5" height="6" style={{ fill: slotVar(slot) }} />
        </pattern>
      ))}
    </defs>
  );
}

// ---- axis ---------------------------------------------------------------------------------------------------------------------------------------------------------------

/** A rounded-up top value and `count + 1` evenly spaced ticks from 0 (so 4 to 5 gridlines). */
export function niceScale(max: number, count = 4): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: count, ticks: Array.from({ length: count + 1 }, (_, i) => i) };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { max: step * count, ticks: Array.from({ length: count + 1 }, (_, i) => step * i) };
}
export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
export const truncate = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1))}…`);
/** The pointer's x position in the svg's own coordinates (the viewBox is `w` wide). */
export function pointerX(e: ReactPointerEvent<Element>, w: number): number {
  const r = e.currentTarget.getBoundingClientRect();
  return r.width === 0 ? 0 : ((e.clientX - r.left) / r.width) * w;
}
export function pointerY(e: ReactPointerEvent<Element>, h: number): number {
  const r = e.currentTarget.getBoundingClientRect();
  return r.height === 0 ? 0 : ((e.clientY - r.top) / r.height) * h;
}

// ---- tooltip, legend, frame ---------------------------------------------------------------------------------------------------------------------------------------------

/** A tooltip: x and y are percentages of the plot box. */
export interface TipData { x: number; y: number; title?: string; rows: { slot?: number; label: string; value: string }[] }
export function Tip({ tip }: { tip: TipData | null }) {
  if (!tip) return null;
  const side = tip.x > 62 ? 'left' : tip.x < 38 ? 'right' : 'centre';
  return (
    <div className="ch-tip" data-side={side} role="status" style={{ left: `${clamp(tip.x, 0, 100)}%`, top: `${clamp(tip.y, 0, 100)}%` }}>
      {tip.title ? <div className="ch-tip-title">{tip.title}</div> : null}
      {tip.rows.map((r, i) => (
        <div key={i} className="ch-tip-row">{r.slot ? <Swatch slot={r.slot} /> : null}<span>{r.label}</span><b>{r.value}</b></div>
      ))}
    </div>
  );
}

/** A small square swatch of a palette slot (the hatched slots carry their own pattern). */
export function Swatch({ slot }: { slot: number }) {
  const id = useChartId();
  return (
    <svg className="ch-swatch" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <HatchDefs id={id} />
      <rect width="12" height="12" style={{ fill: fillFor(slot, id), stroke: 'var(--rule)', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }} />
    </svg>
  );
}

export interface TableData { head: string[]; rows: (string | number)[][] }
/** The visually hidden table of the values, for screen readers. */
export function ValueTable({ title, table }: { title: string; table: TableData }) {
  return (
    <table className="ch-sr">
      <caption>{title}</caption>
      <thead><tr>{table.head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
      <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
    </table>
  );
}

export interface FrameProps { title: string; legend?: { label: string; slot: number }[] | undefined; tip?: TipData | null | undefined; table: TableData; children: ReactNode; className?: string | undefined; maxWidth?: string | undefined }
/** Title, plot (the svg and its tooltip), legend (only with more than one series) and the hidden table. */
export function Frame({ title, legend, tip, table, children, className, maxWidth }: FrameProps) {
  return (
    <figure className={`ch${className ? ` ${className}` : ''}`} style={maxWidth ? { maxWidth } : undefined}>
      <figcaption className="ch-title">{title}</figcaption>
      <div className="ch-plot">{children}<Tip tip={tip ?? null} /></div>
      {legend && legend.length > 1 ? <LegendList items={legend} /> : null}
      <ValueTable title={title} table={table} />
    </figure>
  );
}

export interface LegendItem { label: string; slot: number }
export function LegendList({ items }: { items: LegendItem[] }) {
  return (
    <ul className="ch-legend">
      {items.map((it, i) => <li key={i}><Swatch slot={it.slot} /><span>{it.label}</span></li>)}
    </ul>
  );
}
