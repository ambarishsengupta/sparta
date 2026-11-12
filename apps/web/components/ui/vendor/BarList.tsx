import { Bar } from './Bar';
import styles from './vendor-charts.module.css';

export interface BarRow { label: string; value: number | null; text?: string }

/** A horizontal bar list: one row per segment, bars scaled to the largest value (or to `max`), value text next to every bar. */
export function BarList({ name, rows, max }: { name: string; rows: BarRow[]; max?: number }) {
  const top = max ?? Math.max(0, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className={styles.bars} aria-label={name}>
      {rows.map((r) => <li key={r.label}><span>{r.label}</span><Bar label={`${r.label}, ${name}`} value={r.value} max={top} text={r.text} /></li>)}
    </ul>
  );
}
