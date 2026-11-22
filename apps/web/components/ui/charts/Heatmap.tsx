import type { ReactNode } from 'react';
import { formatValue } from './shared';
import type { ValueFormat } from './shared';

export interface HeatmapProps {
  title: string;
  /** Row headers: text, or a node (a thumbnail and a name). */
  rowLabels: ReactNode[];
  columnLabels: string[];
  /** values[row][column]; null shows a dash and no shade. */
  values: (number | null)[][];
  /** Outline the cell with the highest value in each row (the leading age group), or choose cells yourself. */
  outline?: 'rowMax' | ((row: number, col: number) => boolean);
  /** Shade against the whole matrix (default) or each row on its own. */
  scale?: 'matrix' | 'row';
  /** Makes each row header a button (open the product page). */
  onRowClick?: (row: number) => void;
  /** A label for each row, for screen readers when the header is a node. */
  rowNames?: string[];
  valueFormat?: ValueFormat;
}

const STEPS = [0, 25, 50, 75, 100];
const stepOf = (v: number, lo: number, hi: number): number => (hi <= lo ? 0 : Math.min(4, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * 5))));

/** Rows by columns, cells shaded on a five-step ramp from --chart-4 to --chart-1 with the value written in each cell. It is a real table, so screen readers get the numbers. */
export function Heatmap({ title, rowLabels, columnLabels, values, outline, scale = 'matrix', onRowClick, rowNames, valueFormat = formatValue }: HeatmapProps) {
  const flat = values.flat().filter((v): v is number => typeof v === 'number');
  const gLo = Math.min(...flat);
  const gHi = Math.max(...flat);
  return (
    <figure className="ch ch-heat-wrap">
      <figcaption className="ch-title">{title}</figcaption>
      <div className="ch-heat-scroll">
        <table className="ch-heat">
          <thead><tr><td />{columnLabels.map((c, j) => <th key={j} scope="col">{c}</th>)}</tr></thead>
          <tbody>
            {rowLabels.map((label, i) => {
              const row = values[i] ?? [];
              const nums = row.filter((v): v is number => typeof v === 'number');
              const lo = scale === 'row' ? Math.min(...nums) : gLo;
              const hi = scale === 'row' ? Math.max(...nums) : gHi;
              const rowMax = Math.max(...nums);
              return (
                <tr key={i}>
                  <th scope="row">{onRowClick ? <button type="button" className="ch-heat-row" onClick={() => onRowClick(i)} aria-label={rowNames?.[i]}>{label}</button> : <span className="ch-heat-row">{label}</span>}</th>
                  {columnLabels.map((_, j) => {
                    const v = row[j] ?? null;
                    const boxed = v !== null && (outline === 'rowMax' ? v === rowMax && rowMax > 0 : typeof outline === 'function' ? outline(i, j) : false);
                    const step = v === null ? -1 : stepOf(v, lo, hi);
                    return (
                      <td key={j} className="ch-heat-cell" data-step={step} data-outline={boxed ? 'true' : 'false'} title={v === null ? undefined : `${columnLabels[j]}: ${valueFormat(v)}`}
                        style={step < 0 ? undefined : { background: `color-mix(in srgb, var(--chart-1) ${STEPS[step]}%, var(--chart-4))`, color: step >= 3 ? 'var(--on-accent)' : 'var(--text)' }}>
                        {v === null ? '–' : valueFormat(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="ch-ramp" aria-hidden="true"><span>Low</span>{STEPS.map((s) => <i key={s} style={{ background: `color-mix(in srgb, var(--chart-1) ${s}%, var(--chart-4))` }} />)}<span>High</span></div>
    </figure>
  );
}
