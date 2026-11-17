import { Bar } from './Bar';
import styles from './vendor-charts.module.css';

/** Segments down, months across; `cells` is keyed by cellKey(segment, period). A missing or null cell is a suppressed cell. */
export interface TrendData { periods: string[]; segments: string[]; cells: Record<string, number | null> }
export const cellKey = (segment: string, period: string) => `${segment}\u0000${period}`;

/** A month-by-segment table with an inline bar in every cell, all scaled to the largest value of the table. */
export function TrendTable({ caption, data }: { caption: string; data: TrendData }) {
  const max = Math.max(0, ...Object.values(data.cells).map((v) => v ?? 0));
  return (
    <table className={styles.trend}>
      <caption>{caption}</caption>
      <thead><tr><th scope="col">Segment</th>{data.periods.map((p) => <th scope="col" key={p}>{p}</th>)}</tr></thead>
      <tbody>
        {data.segments.map((s) => (
          <tr key={s}>
            <th scope="row">{s}</th>
            {data.periods.map((p) => <td key={p}><Bar label={`${s}, ${p}`} value={data.cells[cellKey(s, p)] ?? null} max={max} /></td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
