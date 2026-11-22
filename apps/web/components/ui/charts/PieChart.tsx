'use client';
import { useState } from 'react';
import { Frame, HatchDefs, fillFor, foldSlices, formatValue, textOn, r2, useChartId } from './shared';
import type { Slice, TipData, ValueFormat } from './shared';

export interface PieChartProps {
  title: string;
  /** At most 6 are drawn, the rest are summed into "Other". Zero and negative values are left out. */
  slices: Slice[];
  /** A donut with the total in the centre. */
  donut?: boolean;
  /** The small word under the centre total (default "Total"). */
  totalLabel?: string;
  valueFormat?: ValueFormat;
}

const C = 110;
const R = 100;

const pt = (a: number, r: number): [number, number] => [r2(C + r * Math.cos(a)), r2(C + r * Math.sin(a))];
function arc(a0: number, a1: number, r0: number, r1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(a0, r1);
  const [x1, y1] = pt(a1, r1);
  if (r0 <= 0) return `M${C} ${C} L${x0} ${y0} A${r1} ${r1} 0 ${large} 1 ${x1} ${y1} Z`;
  const [x2, y2] = pt(a1, r0);
  const [x3, y3] = pt(a0, r0);
  return `M${x0} ${y0} A${r1} ${r1} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 ${large} 0 ${x3} ${y3} Z`;
}

/** A pie or donut: each slice labelled with its percent, the legend repeats label and percent, and a donut shows the total in the centre. */
export function PieChart({ title, slices, donut = false, totalLabel = 'Total', valueFormat = formatValue }: PieChartProps) {
  const id = useChartId();
  const [at, setAt] = useState<number | null>(null);
  const { items, slots } = foldSlices(slices.filter((s) => s.value > 0));
  const total = items.reduce((a, s) => a + s.value, 0);
  const r0 = donut ? 58 : 0;
  let a = -Math.PI / 2;
  const parts = items.map((s, k) => {
    const frac = total > 0 ? s.value / total : 0;
    const a0 = a;
    a += frac * Math.PI * 2;
    return { s, k, frac, a0, a1: a, mid: (a0 + a) / 2 };
  });
  const pct = (f: number) => `${Math.round(f * 1000) / 10}%`;
  const tipOf = (i: number): TipData | null => {
    const p = parts[i];
    if (!p) return null;
    const [x, y] = pt(p.mid, (R + r0) / 2);
    return { x: (x / (2 * C)) * 100, y: (y / (2 * C)) * 100, title: p.s.label, rows: [{ slot: slots[p.k] ?? 1, label: pct(p.frac), value: valueFormat(p.s.value) }] };
  };

  return (
    <Frame title={title} legend={parts.map((p) => ({ label: `${p.s.label} ${pct(p.frac)}`, slot: slots[p.k] ?? 1 }))} tip={at === null ? null : tipOf(at)} className="ch-pie" maxWidth="20rem" table={{ head: ['Slice', 'Value', 'Share'], rows: parts.map((p) => [p.s.label, valueFormat(p.s.value), pct(p.frac)]) }}>
      <svg className="ch-svg" viewBox={`0 0 ${2 * C} ${2 * C}`} role="img" aria-label={title} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setAt(null); }}>
        <HatchDefs id={id} />
        {parts.length === 0 ? <circle cx={C} cy={C} r={(R + r0) / 2} className="ch-empty" style={{ strokeWidth: R - r0 }} /> : null}
        {parts.map((p) => {
          const slot = slots[p.k] ?? 1;
          const common = { className: 'ch-slice', 'data-active': at === p.k ? 'true' : 'false', onPointerEnter: () => setAt(p.k), onPointerMove: () => setAt(p.k), onPointerDown: () => setAt(p.k) } as const;
          if (p.frac >= 0.9999) return <circle key={p.k} {...common} cx={C} cy={C} r={(R + r0) / 2} style={{ fill: 'none', stroke: fillFor(slot, id), strokeWidth: R - r0 }} />;
          return <path key={p.k} {...common} d={arc(p.a0, p.a1, r0, R)} style={{ fill: fillFor(slot, id) }} />;
        })}
        {parts.filter((p) => p.frac >= 0.07).map((p) => {
          const [x, y] = pt(p.mid, donut ? (R + r0) / 2 : R * 0.64);
          const slot = slots[p.k] ?? 1;
          return <text key={p.k} className={`ch-slice-label${slot >= 5 ? ' ch-halo' : ''}`} x={x} y={y + 4} textAnchor="middle" style={{ fill: slot >= 5 ? 'var(--text)' : textOn(slot) }}>{pct(p.frac)}</text>;
        })}
        {donut ? <g><text className="ch-centre" x={C} y={C + 2} textAnchor="middle">{valueFormat(total)}</text><text className="ch-axis" x={C} y={C + 18} textAnchor="middle">{totalLabel.toUpperCase()}</text></g> : null}
      </svg>
    </Frame>
  );
}
