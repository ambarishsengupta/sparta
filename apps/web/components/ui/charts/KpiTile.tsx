import { Sparkline } from './Sparkline';

export interface KpiTileProps {
  label: string;
  /** The big value, already formatted ("₹12.4L", "62%"). */
  value: string;
  /** The change versus the previous period, in percent (positive is up). Left out: no change line. */
  change?: number | null | undefined;
  /** What the change is measured against (default "vs previous period"). */
  changeLabel?: string;
  /** True when a fall is the good direction (returns, weeks of cover too high); it only changes the wording for screen readers, the arrow always points the way the number moved. */
  lowerIsBetter?: boolean;
  /** True when there is no earlier period to compare with: a small outlined "New" tag stands in the change line. */
  isNew?: boolean;
  /** The value in the accent colour (for the "needs attention" tile). */
  accent?: boolean;
  /** A line of values for the sparkline; left out: no sparkline. */
  spark?: number[] | undefined;
  sparkLabel?: string;
}

/** A KPI tile: label, big value, the change versus the previous period (an up or down arrow and the percent) and an optional sparkline. */
export function KpiTile({ label, value, change, changeLabel = 'vs previous period', lowerIsBetter = false, isNew = false, accent = false, spark, sparkLabel }: KpiTileProps) {
  const has = typeof change === 'number' && Number.isFinite(change);
  const up = has && change > 0;
  const down = has && change < 0;
  const pct = has ? `${Math.abs(Math.round(change * 10) / 10)}%` : '';
  return (
    <div className="ch-kpi" data-accent={accent ? 'true' : 'false'}>
      <div className="ch-kpi-label">{label}</div>
      <div className="ch-kpi-value">{value}</div>
      {has ? (
        <div className="ch-kpi-change" data-dir={up ? 'up' : down ? 'down' : 'flat'}>
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
            {up ? <path d="M5 1 L9 9 L1 9 Z" /> : down ? <path d="M5 9 L9 1 L1 1 Z" /> : <path d="M1 4 H9 V6 H1 Z" />}
          </svg>
          <span>{pct}</span>
          <span className="ch-kpi-vs">{changeLabel}</span>
          <span className="ch-sr">{up ? 'Up' : down ? 'Down' : 'No change'} {pct} {changeLabel}{lowerIsBetter ? (down ? ' (better)' : up ? ' (worse)' : '') : ''}</span>
        </div>
      ) : isNew ? (
        <div className="ch-kpi-change"><span className="ch-kpi-new">New</span><span className="ch-kpi-vs">no earlier period</span></div>
      ) : null}
      {spark && spark.length > 1 ? <Sparkline label={sparkLabel ?? `${label}, trend`} values={spark} /> : null}
    </div>
  );
}
