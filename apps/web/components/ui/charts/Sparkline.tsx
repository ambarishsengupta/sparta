import { formatValue } from './shared';
import type { ValueFormat } from './shared';

export interface SparklineProps {
  /** What the line shows, for screen readers, for example "Revenue, last 12 weeks". */
  label: string;
  values: number[];
  /** The index where the forecast begins: that part is drawn dashed. */
  forecastFrom?: number;
  valueFormat?: ValueFormat;
  /** The ratio of width to height (default 4.5). */
  aspect?: number;
}

/** A tiny line, no axes. It fills its container's width. The values are listed for screen readers. */
export function Sparkline({ label, values, forecastFrom, valueFormat = formatValue, aspect = 4.5 }: SparklineProps) {
  const W = 100;
  const H = W / aspect;
  const n = values.length;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => 2 + (1 - (v - lo) / span) * (H - 4);
  const path = (from: number, to: number) => values.slice(from, to + 1).map((v, k) => `${k === 0 ? 'M' : 'L'}${x(from + k).toFixed(2)} ${y(v).toFixed(2)}`).join(' ');
  const cut = forecastFrom !== undefined && forecastFrom > 0 && forecastFrom < n ? forecastFrom : null;
  return (
    <span className="ch-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {n > 0 ? <path className="ch-spark-line" d={path(0, cut === null ? n - 1 : cut - 1)} /> : null}
        {cut !== null ? <path className="ch-spark-line ch-dashed" d={path(cut - 1, n - 1)} /> : null}
      </svg>
      <span className="ch-sr">{label}: {values.map((v) => valueFormat(v)).join(', ')}</span>
    </span>
  );
}
