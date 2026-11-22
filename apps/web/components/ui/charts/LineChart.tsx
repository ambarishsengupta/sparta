'use client';
import { useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Frame, HatchDefs, clamp, compact, foldSeries, formatValue, niceScale, pointerX, slotVar, useChartId } from './shared';
import type { Series, TipData, ValueFormat } from './shared';

export interface LineChartProps {
  title: string;
  /** The x axis, one label per point (weeks). */
  labels: string[];
  /** One entry per line; at most 6 are drawn, the rest are summed into "Other". */
  series: Series[];
  /** The index of the first forecast point: the lines turn dashed from the point before it, on a shaded band. */
  forecastFrom?: number;
  valueFormat?: ValueFormat;
  /** Width to height (default 2.2). */
  aspect?: number;
}

const W = 600;
const M = { l: 46, r: 14, t: 12, b: 26 };
/** Slots 5 and 6 cannot be hatched on a line, so they are dotted and dash-dotted. */
const DASH: Record<number, string | undefined> = { 5: '1 4', 6: '8 3 2 3' };

/** A multi-series line chart: weeks across, 4 to 5 gridlines, an optional dashed forecast and a hover crosshair that shows the exact values. */
export function LineChart({ title, labels, series, forecastFrom, valueFormat = formatValue, aspect = 2.2 }: LineChartProps) {
  const id = useChartId();
  const [at, setAt] = useState<number | null>(null);
  const { items, slots } = foldSeries(series);
  const H = Math.round(W / aspect);
  const n = labels.length;
  const { max: top, ticks } = niceScale(Math.max(0, ...items.flatMap((s) => s.values)));
  const x = (i: number) => M.l + (n <= 1 ? 0.5 : i / (n - 1)) * (W - M.l - M.r);
  const y = (v: number) => M.t + (1 - v / top) * (H - M.t - M.b);
  const cut = forecastFrom !== undefined && forecastFrom > 0 && forecastFrom < n ? forecastFrom : null;
  const path = (vals: number[], from: number, to: number) => vals.slice(from, to + 1).map((v, k) => `${k === 0 ? 'M' : 'L'}${x(from + k).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const step = Math.max(1, Math.ceil(n / 8));

  const pick = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (n === 0) return;
    setAt(clamp(Math.round(((pointerX(e, W) - M.l) / (W - M.l - M.r)) * (n - 1)), 0, n - 1));
  };
  const tip: TipData | null = at === null ? null : {
    x: (x(at) / W) * 100,
    y: (y(Math.max(...items.map((s) => s.values[at] ?? 0))) / H) * 100,
    title: `${labels[at] ?? ''}${cut !== null && at >= cut ? ' (forecast)' : ''}`,
    rows: items.map((s, k) => ({ slot: slots[k] ?? 1, label: s.label, value: valueFormat(s.values[at] ?? 0) })),
  };

  return (
    <Frame title={title} legend={items.map((s, k) => ({ label: s.label, slot: slots[k] ?? 1 }))} tip={tip} table={{ head: ['Week', ...items.map((s) => s.label)], rows: labels.map((l, i) => [l, ...items.map((s) => valueFormat(s.values[i] ?? 0))]) }}>
      <svg className="ch-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onPointerMove={pick} onPointerDown={pick} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setAt(null); }}>
        <HatchDefs id={id} />
        {cut !== null ? <g><rect className="ch-band" x={x(cut - 1)} y={M.t} width={x(n - 1) - x(cut - 1)} height={H - M.t - M.b} /><text className="ch-axis" x={x(n - 1)} y={M.t + 10} textAnchor="end">FORECAST</text></g> : null}
        {ticks.map((t) => <g key={t}><line className="ch-grid" x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} /><text className="ch-axis" x={M.l - 6} y={y(t) + 4} textAnchor="end">{compact(t)}</text></g>)}
        {labels.map((l, i) => (i % step === 0 ? <text key={i} className="ch-axis" x={x(i)} y={H - 8} textAnchor="middle">{l}</text> : null))}
        {items.map((s, k) => {
          const slot = slots[k] ?? 1;
          const dash = DASH[slot];
          const style = { stroke: slotVar(slot), strokeDasharray: dash, strokeLinecap: dash ? ('round' as const) : ('butt' as const) };
          return (
            <g key={k}>
              <path className="ch-line" style={style} d={path(s.values, 0, cut === null ? n - 1 : cut - 1)} />
              {cut !== null ? <path className="ch-line ch-dashed" style={{ stroke: slotVar(slot) }} d={path(s.values, cut - 1, n - 1)} /> : null}
            </g>
          );
        })}
        {at !== null ? (
          <g>
            <line className="ch-cross" x1={x(at)} x2={x(at)} y1={M.t} y2={H - M.b} />
            {items.map((s, k) => <circle key={k} className="ch-dot" cx={x(at)} cy={y(s.values[at] ?? 0)} r="4" style={{ stroke: slotVar(slots[k] ?? 1) }} />)}
          </g>
        ) : null}
      </svg>
    </Frame>
  );
}
