import type { ReactNode } from 'react';
import { formatPrice } from '../../lib/money';
import type { WishlistEntry } from '../../lib/repository';
import { groupByMonth, monthLabel } from '../../lib/wishlist-plan';

/**
 * The wishlist by plan (FR-36): one group per planned month, earliest first, with the budget total per currency (never summed across currencies),
 * then the entries with no plan in a group of their own. `renderEntry` draws one entry as a list item.
 */
export function PlanGroups({ entries, renderEntry }: { entries: readonly WishlistEntry[]; renderEntry: (e: WishlistEntry) => ReactNode }) {
  const { months, unplanned } = groupByMonth(entries);
  return (
    <>
      <section aria-labelledby="plan-title">
        <h2 id="plan-title">Plan</h2>
        {months.length === 0 && <p className="muted">Nothing is planned yet. Choose Plan on an entry to set a month and a budget.</p>}
        {months.map((g) => (
          <section key={g.month} aria-labelledby={`plan-${g.month}`}>
            <h3 id={`plan-${g.month}`}>{monthLabel(g.month)}</h3>
            {g.totals.length === 0 ? <p className="muted">No budget set for this month.</p> : (
              <dl className="totals" aria-label={`Budget for ${monthLabel(g.month)}`}>{g.totals.map((t) => <div key={t.currency}><dt>{t.currency}</dt><dd>{formatPrice(t.total, t.currency)}</dd></div>)}</dl>
            )}
            <ul className="list">{g.entries.map(renderEntry)}</ul>
          </section>
        ))}
      </section>
      {unplanned.length > 0 && (
        <section aria-labelledby="unplanned-title">
          <h2 id="unplanned-title">Not planned</h2>
          <ul className="list">{unplanned.map(renderEntry)}</ul>
        </section>
      )}
    </>
  );
}
