import { totalsByCurrency } from './purchases';
import type { CurrencyTotal } from './purchases';
import type { WishlistEntry } from './repository';

/** The plan of one wishlist entry (FR-36): the month it is planned for (`YYYY-MM`) and a budget in a currency. All three are null for "no plan". */
export interface PlanDraft { plannedMonth: string | null; budget: number | null; currency: string | null }
/** What the plan form holds, as typed. `month` is empty for no plan. */
export interface PlanFormValues { month: string; budget: string; currency: string }
export type PlanErrors = Partial<Record<keyof PlanFormValues, string>>;
export type PlanResult = { ok: true; draft: PlanDraft } | { ok: false; errors: PlanErrors };

export const NO_PLAN: PlanDraft = { plannedMonth: null, budget: null, currency: null };
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const isMonth = (s: string): boolean => MONTH.test(s);
/** The `YYYY-MM` of a date, from the person's local calendar. */
export const monthOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export const emptyPlan = (currency: string): PlanFormValues => ({ month: '', budget: '', currency });
export const formFromEntry = (e: Pick<WishlistEntry, 'plannedMonth' | 'budget' | 'currency'>, currency: string): PlanFormValues =>
  ({ month: e.plannedMonth ?? '', budget: e.budget === null || e.budget === undefined ? '' : e.budget.toFixed(2), currency: e.currency ?? currency });

/**
 * Checks the plan form. `now` is this month (`YYYY-MM`, the person's own, passed in so the check is testable). A month in the past is refused for
 * a new plan; the month an entry is already planned for stays valid so its budget can still be edited. The budget has the same shape as a price
 * (no sign, no exponent, so NaN, Infinity and negatives never leave the form) and needs a currency; a budget needs a month.
 */
export function validatePlan(v: PlanFormValues, now: string, current: string | null = null): PlanResult {
  const errors: PlanErrors = {};
  const month = v.month.trim();
  const budget = v.budget.trim();
  if (month === '' && budget === '') return { ok: true, draft: NO_PLAN };
  if (month === '') errors.month = 'Choose the month you plan to buy this.';
  else if (!isMonth(month) || Number(month.slice(0, 4)) > Number(now.slice(0, 4)) + 10) errors.month = 'Enter the month as year and month, for example 2026-12.';
  else if (month < now && month !== current) errors.month = 'Choose this month or a later one.';
  if (budget !== '' && !/^\d{1,10}(\.\d{1,2})?$/.test(budget)) errors.budget = 'Enter the budget as an amount, for example 120 or 49.90.';
  if (budget !== '' && !/^[A-Z]{3}$/.test(v.currency)) errors.currency = 'Choose a currency.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, draft: { plannedMonth: month, budget: budget === '' ? null : Number(budget), currency: budget === '' ? null : v.currency } };
}

export interface MonthGroup { month: string; entries: WishlistEntry[]; totals: CurrencyTotal[] }
export interface PlanGroups { months: MonthGroup[]; unplanned: WishlistEntry[] }

/**
 * Planned entries by month, earliest first, each with the budget total per currency (never summed across currencies; whole minor units are added);
 * entries with no planned month are kept apart. The order inside a group is the order given.
 */
export function groupByMonth(entries: readonly WishlistEntry[]): PlanGroups {
  const byMonth = new Map<string, WishlistEntry[]>();
  const unplanned: WishlistEntry[] = [];
  for (const e of entries) {
    if (!e.plannedMonth) { unplanned.push(e); continue; }
    byMonth.set(e.plannedMonth, [...(byMonth.get(e.plannedMonth) ?? []), e]);
  }
  const months = [...byMonth].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, list]): MonthGroup => ({
    month, entries: list, totals: totalsByCurrency(list.map((e) => ({ price: e.budget ?? null, quantity: 1, currency: e.currency ?? null }))),
  }));
  return { months, unplanned };
}

/** "November 2026" for `2026-11`; the text itself if it is not a month. */
export function monthLabel(month: string, locale = 'en'): string {
  const m = MONTH.exec(month);
  if (!m) return month;
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
}
