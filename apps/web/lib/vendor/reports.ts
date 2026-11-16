import { report, type GapRow, type Insight, type ReportDetail } from './insights';

/** Reading one reviewed report (FR-78, LLD 5.5). The id is checked as a uuid BEFORE any call; an unknown, malformed or unreviewed id is the same answer: no report. */
type Client = Parameters<typeof report>[0];
export const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export const NOT_FOUND = 'Report not found.';

export interface Rising { segment: string; users_rounded: number; previous_users_rounded: number; increase: number }
export interface Spectrum { category: string; bands: { band: string; share: number | null }[] }
export interface Payload {
  coverage: { users_rounded: number | null; last_run_at: string | null }; cube_first_period: string | null; cube_last_period: string | null;
  gaps: GapRow[]; rising_wishlist: Rising[]; condition_spectrum: Spectrum[];
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNumber = (x: unknown): x is number => typeof x === 'number';
const isNumberOrNull = (x: unknown): x is number | null => x === null || typeof x === 'number';
const isString = (x: unknown): x is string => typeof x === 'string';
const isStringOrNull = (x: unknown): x is string | null => x === null || typeof x === 'string';
// One row of each list, checked field by field, so that the types above are what the code really holds (the payload is jsonb).
const isGap = (x: unknown): x is GapRow => isObject(x) && isString(x.segment) && isNumberOrNull(x.owner_users_rounded) && isNumber(x.wishlist_users_rounded) && isNumberOrNull(x.gap_score) && isStringOrNull(x.label);
const isRising = (x: unknown): x is Rising => isObject(x) && isString(x.segment) && isNumber(x.users_rounded) && isNumber(x.previous_users_rounded) && isNumber(x.increase);
const isBand = (x: unknown): x is { band: string; share: number | null } => isObject(x) && isString(x.band) && isNumberOrNull(x.share);
const isSpectrum = (x: unknown): x is Spectrum => isObject(x) && isString(x.category) && Array.isArray(x.bands) && x.bands.every(isBand);
// jsonb_agg of nothing is null, which reads as an empty list; anything that is not a list of well-formed rows is refused (null).
const list = <T>(x: unknown, ok: (row: unknown) => row is T): T[] | null => (x === null || x === undefined ? [] : Array.isArray(x) && x.every(ok) ? [...x] : null);

// A period is a date string or null (a cube with no rows has no first or last period); a field that is missing reads as null, any other type is refused (undefined).
const periodOrNull = (x: unknown): string | null | undefined => (x === undefined || x === null ? null : typeof x === 'string' ? x : undefined);

/** The payload of CC6 (workflow/evidence/R7/WO-0102-NOTES.md); null when it does not have that shape, so a damaged snapshot is never half drawn.
 * `build_report` writes every key of `coverage` and the two periods, each a value or null. */
export function parsePayload(raw: unknown): Payload | null {
  if (!isObject(raw)) return null;
  const c = raw.coverage;
  const [g, r, s] = [list(raw.gaps, isGap), list(raw.rising_wishlist, isRising), list(raw.condition_spectrum, isSpectrum)];
  const [first, last] = [periodOrNull(raw.cube_first_period), periodOrNull(raw.cube_last_period)];
  if (!isObject(c) || !isNumberOrNull(c.users_rounded) || !isStringOrNull(c.last_run_at) || !g || !r || !s || first === undefined || last === undefined) return null;
  return { coverage: { users_rounded: c.users_rounded, last_run_at: c.last_run_at }, cube_first_period: first, cube_last_period: last, gaps: g, rising_wishlist: r, condition_spectrum: s };
}

/** `data` is null for a report that is not there (not reviewed, unknown, or not a uuid: then nothing was called). */
export async function openReport(c: Client, id: string): Promise<Insight<ReportDetail | null>> {
  return isUuid(id) ? report(c, id) : { ok: true, data: null };
}
