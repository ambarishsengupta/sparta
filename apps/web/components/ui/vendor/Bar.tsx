import styles from './vendor-charts.module.css';

/** WO-0112: vendor chart primitives. Presentational: props in, markup out; no data fetching, no script, no external reference. A bar is a hairline track with an accent fill and
 * its value is always printed beside it (never colour or length alone); a null value is the suppressed text, never 0. */
export const SUPPRESSED = 'Not enough users to display';
/** Smallest width, in percent of the track, of a bar whose value is above zero, so a small segment stays visible. */
export const MIN_BAR = 3;

/** Width of a bar in percent: scaled to the largest value, at least MIN_BAR for a value above zero, 0 for null or zero. */
export function barWidth(value: number | null, max: number): number {
  if (value === null || !(value > 0) || !(max > 0)) return 0;
  return Math.min(100, Math.max(MIN_BAR, (value / max) * 100));
}

export function Suppressed() { return <span className={styles.suppressed}>{SUPPRESSED}</span>; }

/** The track and the printed value of one bar (two siblings, so a list row and a table cell can place them). */
export function Bar({ label, value, max, text }: { label: string; value: number | null; max: number; text?: string }) {
  if (value === null) return <Suppressed />;
  const shown = text ?? String(value);
  return (
    <>
      <span className={styles.track} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(max, value)} aria-valuenow={value} aria-valuetext={shown}>
        <span style={{ width: `${barWidth(value, max)}%` }} />
      </span>
      <span className={styles.value}>{shown}</span>
    </>
  );
}
