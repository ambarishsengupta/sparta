'use client';
import { useState } from 'react';
import { Frame, HatchDefs, compact, fillFor, foldSeries, formatValue, niceScale, truncate, r2, useChartId } from './shared';
import type { Series, TipData, ValueFormat } from './shared';

export interface BarChartProps {
  title: string;
  /** One label per bar group (a category, a store). */
  categories: string[];
  /** One series gives single bars; more give grouped or stacked bars (at most 6, the rest are summed into "Other"). */
  series: Series[];
  orientation?: 'vertical' | 'horizontal';
  mode?: 'grouped' | 'stacked';
  /** Print the value on each bar (the total on a stacked bar). */
  showValues?: boolean;
  /** A reference line, for example the 65% sell-through target. */
  target?: { value: number; label: string };
  valueFormat?: ValueFormat;
  /** Vertical charts: width to height (default 2). Horizontal charts grow with the number of rows. */
  aspect?: number;
}

const W = 600;

/** Bars, vertical or horizontal; single, grouped or stacked; with optional value labels and a target line. Hover or tap a group for the exact values. */
export function BarChart({ title, categories, series, orientation = 'vertical', mode = 'grouped', showValues = false, target, valueFormat = formatValue, aspect = 2 }: BarChartProps) {
  const id = useChartId();
  const [at, setAt] = useState<number | null>(null);
  const { items, slots } = foldSeries(series);
  const n = categories.length;
  const stacked = mode === 'stacked' && items.length > 1;
  const horizontal = orientation === 'horizontal';
  const totals = categories.map((_, i) => items.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const maxVal = stacked ? Math.max(0, ...totals) : Math.max(0, ...items.flatMap((s) => s.values));
  const { max: top, ticks } = niceScale(Math.max(maxVal, target?.value ?? 0));
  const lanes = stacked ? 1 : items.length;

  // geometry
  const M = horizontal ? { l: 124, r: showValues ? 52 : 16, t: 10, b: 24 } : { l: 46, r: 14, t: showValues ? 20 : 12, b: 38 };
  const band = r2(horizontal ? Math.max(26, lanes * 14 + 12) : (W - M.l - M.r) / Math.max(n, 1));
  const H = r2(horizontal ? M.t + M.b + n * band : Math.round(W / aspect));
  const plotW = r2(W - M.l - M.r);
  const plotH = r2(H - M.t - M.b);
  const val = (v: number) => r2(horizontal ? (v / top) * plotW : (v / top) * plotH);
  const laneSize = r2(horizontal ? Math.min(18, (band - 10) / lanes) : Math.min(40, (band * 0.76) / lanes));

  const tip = (i: number): TipData => ({
    x: horizontal ? ((M.l + val(Math.max(...items.map((s) => s.values[i] ?? 0), 0))) / W) * 100 : ((M.l + band * (i + 0.5)) / W) * 100,
    y: horizontal ? ((M.t + band * (i + 0.5)) / H) * 100 : ((M.t + plotH - val(stacked ? totals[i] ?? 0 : Math.max(...items.map((s) => s.values[i] ?? 0), 0))) / H) * 100,
    title: categories[i] ?? '',
    rows: [...items.map((s, k) => ({ slot: slots[k] ?? 1, label: s.label, value: valueFormat(s.values[i] ?? 0) })), ...(stacked ? [{ label: 'Total', value: valueFormat(totals[i] ?? 0) }] : [])],
  });
  const maxChars = horizontal ? 18 : Math.max(3, Math.floor(band / 6.6));

  return (
    <Frame title={title} legend={items.map((s, k) => ({ label: s.label, slot: slots[k] ?? 1 }))} tip={at === null ? null : tip(at)} table={{ head: ['Group', ...items.map((s) => s.label)], rows: categories.map((c, i) => [c, ...items.map((s) => valueFormat(s.values[i] ?? 0))]) }}>
      <svg className="ch-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setAt(null); }}>
        <HatchDefs id={id} />
        {ticks.map((t) => horizontal
          ? <g key={t}><line className="ch-grid" x1={r2(M.l + val(t))} x2={r2(M.l + val(t))} y1={M.t} y2={r2(H - M.b)} /><text className="ch-axis" x={r2(M.l + val(t))} y={H - 8} textAnchor="middle">{compact(t)}</text></g>
          : <g key={t}><line className="ch-grid" x1={M.l} x2={W - M.r} y1={r2(M.t + plotH - val(t))} y2={r2(M.t + plotH - val(t))} /><text className="ch-axis" x={M.l - 6} y={r2(M.t + plotH - val(t) + 4)} textAnchor="end">{compact(t)}</text></g>)}
        {categories.map((c, i) => {
          const gx = r2(horizontal ? M.l : M.l + band * i);
          const gy = r2(horizontal ? M.t + band * i : M.t);
          const inner = r2(lanes * laneSize);
          let acc = 0;
          return (
            <g key={i} data-active={at === i ? 'true' : 'false'}>
              {at === i ? <rect className="ch-hover" x={horizontal ? 0 : gx} y={horizontal ? gy : M.t} width={horizontal ? W : band} height={horizontal ? band : plotH} /> : null}
              {horizontal
                ? <text className="ch-axis" x={M.l - 8} y={r2(gy + band / 2 + 4)} textAnchor="end">{truncate(c, maxChars)}<title>{c}</title></text>
                : <text className="ch-axis" x={r2(gx + band / 2)} y={r2(H - M.b + 16)} textAnchor="middle">{truncate(c, maxChars)}<title>{c}</title></text>}
              {items.map((s, k) => {
                const v = s.values[i] ?? 0;
                const slot = slots[k] ?? 1;
                const len = val(v);
                const off = r2(stacked ? 0 : k * laneSize);
                const start = stacked ? acc : 0;
                if (stacked) acc = r2(acc + len);
                const style = { fill: fillFor(slot, id) };
                const label = showValues && !stacked ? valueFormat(v) : null;
                if (horizontal) {
                  const by = r2(gy + (band - inner) / 2 + off);
                  return <g key={k}><rect className="ch-bar" style={style} x={r2(M.l + start)} y={by} width={r2(Math.max(len, v > 0 ? 1 : 0))} height={r2(laneSize - 2)} />{label ? <text className="ch-val" x={r2(M.l + start + len + 4)} y={r2(by + laneSize / 2 + 3)}>{label}</text> : null}</g>;
                }
                const bw = r2(stacked ? laneSize : laneSize - 2);
                const bx = r2(gx + (band - inner) / 2 + off + (stacked ? 0 : 1));
                const by = r2(M.t + plotH - start - len);
                return <g key={k}><rect className="ch-bar" style={style} x={bx} y={by} width={bw} height={r2(Math.max(len, v > 0 ? 1 : 0))} />{label ? <text className="ch-val" x={r2(bx + bw / 2)} y={r2(by - 4)} textAnchor="middle">{label}</text> : null}</g>;
              })}
              {showValues && stacked ? (horizontal
                ? <text className="ch-val" x={r2(M.l + val(totals[i] ?? 0) + 4)} y={r2(gy + band / 2 + 4)}>{valueFormat(totals[i] ?? 0)}</text>
                : <text className="ch-val" x={r2(gx + band / 2)} y={r2(M.t + plotH - val(totals[i] ?? 0) - 4)} textAnchor="middle">{valueFormat(totals[i] ?? 0)}</text>) : null}
              <rect className="ch-hit" x={horizontal ? 0 : gx} y={horizontal ? gy : M.t} width={horizontal ? W : band} height={horizontal ? band : plotH} onPointerEnter={() => setAt(i)} onPointerMove={() => setAt(i)} onPointerDown={() => setAt(i)} />
            </g>
          );
        })}
        {target ? (horizontal
          ? <g><line className="ch-target" x1={r2(M.l + val(target.value))} x2={r2(M.l + val(target.value))} y1={M.t} y2={r2(H - M.b)} /><text className="ch-axis" x={r2(M.l + val(target.value) + 4)} y={M.t + 9}>{target.label}</text></g>
          : <g><line className="ch-target" x1={M.l} x2={W - M.r} y1={r2(M.t + plotH - val(target.value))} y2={r2(M.t + plotH - val(target.value))} /><text className="ch-axis" x={W - M.r} y={r2(M.t + plotH - val(target.value) - 4)} textAnchor="end">{target.label}</text></g>) : null}
      </svg>
    </Frame>
  );
}
