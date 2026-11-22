'use client';
import { useChartId } from './shared';

export type BadgeStatus = 'Healthy' | 'Watch' | 'Restock now' | 'Overstock';
const STATUSES: readonly BadgeStatus[] = ['Healthy', 'Watch', 'Restock now', 'Overstock'];

/** A stock status as a badge: Healthy is accent filled, Watch is outlined, Restock now is ink filled, Overstock is hatched. The word is always printed (never colour alone). */
export function StatusBadge({ status }: { status: BadgeStatus }) {
  const id = useChartId();
  const known = STATUSES.includes(status) ? status : 'Watch';
  return (
    <span className="ch-badge" data-status={known}>
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
      <span className="ch-badge-text">{known}</span>
    </span>
  );
}
