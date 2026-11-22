'use client';
import { useState } from 'react';
import { Frame, clamp, formatValue, r2 } from './shared';
import type { TipData, ValueFormat } from './shared';

export interface GaugeProps {
  title: string;
  /** 0 to 100. */
  value: number;
  /** A target mark on the arc, 0 to 100. */
  target?: number;
  /** The unit written after the value (default "%"). */
  unit?: string;
  valueFormat?: ValueFormat;
  /** The widest the gauge may be (default 16rem). */
  maxWidth?: string;
}

const CX = 100;
const CY = 100;
const R = 78;
const pt = (v: number, r: number): [number, number] => {
  const th = Math.PI * (1 - clamp(v, 0, 100) / 100);
  return [r2(CX + r * Math.cos(th)), r2(CY - r * Math.sin(th))];
};

/** A half-circle gauge from 0 to 100 with a needle and an optional target mark, for sell-through and stock health. */
export function Gauge({ title, value, target, unit = '%', valueFormat = formatValue, maxWidth = '16rem' }: GaugeProps) {
  const [open, setOpen] = useState(false);
  const v = clamp(Number.isFinite(value) ? value : 0, 0, 100);
  const [sx, sy] = pt(0, R);
  const [ex, ey] = pt(100, R);
  const [vx, vy] = pt(v, R);
  const [nx, ny] = pt(v, R - 8);
  const tip: TipData | null = open ? { x: 50, y: 30, title, rows: [{ label: 'Value', value: `${valueFormat(v)}${unit}` }, ...(target !== undefined ? [{ label: 'Target', value: `${valueFormat(target)}${unit}` }] : [])] } : null;
  return (
    <Frame title={title} tip={tip} className="ch-gauge" maxWidth={maxWidth} table={{ head: ['Measure', 'Value'], rows: [['Value', `${valueFormat(v)}${unit}`], ...(target !== undefined ? [['Target', `${valueFormat(target)}${unit}`]] : [])] }}>
      <svg className="ch-svg" viewBox="0 0 200 122" role="img" aria-label={`${title}: ${valueFormat(v)}${unit}${target !== undefined ? `, target ${valueFormat(target)}${unit}` : ''}`}
        onPointerEnter={() => setOpen(true)} onPointerDown={() => setOpen((o) => !o)} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(false); }}>
        <path className="ch-gauge-track" d={`M${sx} ${sy} A${R} ${R} 0 0 1 ${ex} ${ey}`} />
        {v > 0 ? <path className="ch-gauge-fill" d={`M${sx} ${sy} A${R} ${R} 0 0 1 ${vx} ${vy}`} /> : null}
        {target !== undefined ? <line className="ch-gauge-target" x1={pt(target, R - 14)[0]} y1={pt(target, R - 14)[1]} x2={pt(target, R + 12)[0]} y2={pt(target, R + 12)[1]} /> : null}
        <line className="ch-gauge-needle" x1={CX} y1={CY} x2={nx} y2={ny} />
        <circle className="ch-gauge-hub" cx={CX} cy={CY} r="5" />
        <text className="ch-centre" x={CX} y={CY + 20} textAnchor="middle">{valueFormat(v)}{unit}</text>
        <text className="ch-axis" x={CX - R} y={CY + 14} textAnchor="middle">0</text>
        <text className="ch-axis" x={CX + R} y={CY + 14} textAnchor="middle">100</text>
      </svg>
    </Frame>
  );
}
