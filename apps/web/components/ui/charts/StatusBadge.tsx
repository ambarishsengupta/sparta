'use client';
import { useChartId } from './shared';

export type BadgeStatus = 'Healthy' | 'Watch' | 'Restock now' | 'Overstock';
const STATUSES: readonly BadgeStatus[] = ['Healthy', 'Watch', 'Restock now', 'Overstock'];

const SHORT: Record<BadgeStatus, string> = { Healthy: 'OK', Watch: 'Watch', 'Restock now': 'Restock', Overstock: 'Over' };

/** A stock status as a badge: Healthy is accent filled, Watch is outlined, Restock now is ink filled, Overstock is hatched. The word is always printed (never colour alone). */
export function StatusBadge({ status, count }: { status: BadgeStatus; /** With a count the badge is a compact chip: a number and a short word ("4 RESTOCK"). */ count?: number }) {
  const id = useChartId();
  const known = STATUSES.includes(status) ? status : 'Watch';
  return (
    <span className="ch-badge" data-status={known} data-chip={count === undefined ? undefined : 'true'} title={count === undefined ? undefined : `${count} ${known}`}>
      {known === 'Overstock' ? (
        <svg className="ch-badge-hatch" aria-hidden="true" focusable="false" width="100%" height="100%">
          <defs>
            <pattern id={`${id}-b`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="2.5" height="6" style={{ fill: 'var(--chart-6)' }} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" style={{ fill: `url(#${id}-b)` }} />
        </svg>
      ) : null}
      <span className="ch-badge-text" aria-hidden={count === undefined ? undefined : 'true'}>{count === undefined ? known : `${count} ${SHORT[known]}`}</span>
      {count === undefined ? null : <span className="ch-sr">{count} {known}</span>}
    </span>
  );
}
