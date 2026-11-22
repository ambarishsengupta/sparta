'use client';
import { useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Frame, HatchDefs, clamp, compact, fillFor, foldSeries, formatValue, niceScale, pointerX, r2, useChartId } from './shared';
import type { Series, TipData, ValueFormat } from './shared';

export interface AreaChartProps {
  title: string;
  labels: string[];
  /** Stacked from the bottom in the order given; at most 6 are drawn, the rest are summed into "Other". */
  series: Series[];
  /** The index of the first forecast point: shaded band. */
  forecastFrom?: number;
  valueFormat?: ValueFormat;
  aspect?: number;
}

const W = 600;
const M = { l: 46, r: 14, t: 12, b: 26 };

/** Stacked areas on the same axes as the line chart, with a hover crosshair that shows each layer and the total. */
export function AreaChart({ title, labels, series, forecastFrom, valueFormat = formatValue, aspect = 2.2 }: AreaChartProps) {
  const id = useChartId();
  const [at, setAt] = useState<number | null>(null);
  const { items, slots } = foldSeries(series);
  const H = Math.round(W / aspect);
  const n = labels.length;
  const totals = labels.map((_, i) => items.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const { max: top, ticks } = niceScale(Math.max(0, ...totals));
  const x = (i: number) => r2(M.l + (n <= 1 ? 0.5 : i / (n - 1)) * (W - M.l - M.r));
  const y = (v: number) => r2(M.t + (1 - v / top) * (H - M.t - M.b));
  const cut = forecastFrom !== undefined && forecastFrom > 0 && forecastFrom < n ? forecastFrom : null;
  const step = Math.max(1, Math.ceil(n / 8));
  // base[k][i]: the height under layer k at point i
  const base: number[][] = [];
  items.forEach((_, k) => { base.push(labels.map((__, i) => (k === 0 ? 0 : (base[k - 1]?.[i] ?? 0) + (items[k - 1]?.values[i] ?? 0)))); });
  const area = (k: number) => {
    const lo = base[k] ?? [];
    const s = items[k];
    if (!s || n === 0) return '';
    const upper = labels.map((_, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y((lo[i] ?? 0) + (s.values[i] ?? 0))}`);
    const lower = labels.map((_, i) => `L${x(n - 1 - i)} ${y(lo[n - 1 - i] ?? 0)}`);
    return `${upper.join(' ')} ${lower.join(' ')} Z`;
  };
  const pick = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (n === 0) return;
    setAt(clamp(Math.round(((pointerX(e, W) - M.l) / (W - M.l - M.r)) * (n - 1)), 0, n - 1));
  };
  const tip: TipData | null = at === null ? null : {
    x: (x(at) / W) * 100,
    y: (y(totals[at] ?? 0) / H) * 100,
    title: `${labels[at] ?? ''}${cut !== null && at >= cut ? ' (forecast)' : ''}`,
    rows: [...items.map((s, k) => ({ slot: slots[k] ?? 1, label: s.label, value: valueFormat(s.values[at] ?? 0) })), ...(items.length > 1 ? [{ label: 'Total', value: valueFormat(totals[at] ?? 0) }] : [])],
  };

  return (
    <Frame title={title} legend={items.map((s, k) => ({ label: s.label, slot: slots[k] ?? 1 }))} tip={tip} table={{ head: ['Week', ...items.map((s) => s.label), 'Total'], rows: labels.map((l, i) => [l, ...items.map((s) => valueFormat(s.values[i] ?? 0)), valueFormat(totals[i] ?? 0)]) }}>
      <svg className="ch-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onPointerMove={pick} onPointerDown={pick} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setAt(null); }}>
        <HatchDefs id={id} />
        {ticks.map((t) => <g key={t}><line className="ch-grid" x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} /><text className="ch-axis" x={M.l - 6} y={r2(y(t) + 4)} textAnchor="end">{compact(t)}</text></g>)}
        {labels.map((l, i) => (i % step === 0 ? <text key={i} className="ch-axis" x={x(i)} y={H - 8} textAnchor="middle">{l}</text> : null))}
        {items.map((_, k) => <path key={k} className="ch-area" style={{ fill: fillFor(slots[k] ?? 1, id) }} d={area(k)} />)}
        {cut !== null ? <g><rect className="ch-band" x={x(cut - 1)} y={M.t} width={r2(x(n - 1) - x(cut - 1))} height={r2(H - M.t - M.b)} /><text className="ch-axis" x={x(n - 1)} y={M.t + 10} textAnchor="end">FORECAST</text></g> : null}
        {at !== null ? <line className="ch-cross" x1={x(at)} x2={x(at)} y1={M.t} y2={H - M.b} /> : null}
      </svg>
    </Frame>
  );
}
