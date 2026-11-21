/** FR-69, BR-45, LLD 9.4: the banner shows from this many days before the end date (day 14 shown, day 15 hidden) and stays up after it until the account is deleted. */
export const BANNER_DAYS = 14;
export type PilotOutcome = 'close' | 'continue';
export type BannerState = { show: false } | { show: true; endDate: string; outcome: PilotOutcome; daysLeft: number };
const HIDDEN: BannerState = { show: false };
const DAY_MS = 86_400_000;

/** A real calendar day written `YYYY-MM-DD`, as the milliseconds of its midnight in UTC; anything else is NaN. */
function dayStart(s: unknown): number {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.NaN;
  const t = Date.parse(`${s}T00:00:00Z`);
  return new Date(t).toISOString().slice(0, 10) === s ? t : Number.NaN;
}

/**
 * Whether the end-of-pilot banner shows. `endDate` and `today` are `YYYY-MM-DD` (UTC days); `outcome` is the stored setting.
 * Hidden when the date is unset or not a real date, when the outcome is not `close` or `continue` (the banner could not say what will happen),
 * and when the end is more than 14 days away. Shown on day 14, on the end date itself and for any date in the past.
 */
export function bannerState(endDate: string | null | undefined, outcome: string | null | undefined, today: string): BannerState {
  const end = dayStart(endDate);
  const now = dayStart(today);
  if (Number.isNaN(end) || Number.isNaN(now) || typeof endDate !== 'string') return HIDDEN;
  if (outcome !== 'close' && outcome !== 'continue') return HIDDEN;
  const daysLeft = Math.round((end - now) / DAY_MS);
  return daysLeft > BANNER_DAYS ? HIDDEN : { show: true, endDate, outcome, daysLeft };
}

/** The banner's date as people write it, for example `28 November 2026`. */
export const endDateText = (iso: string): string => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
