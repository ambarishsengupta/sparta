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

/** The payload of CC6 (workflow/evidence/R7/WO-0102-NOTES.md); null when it does not have that shape, so a damaged snapshot is never half drawn. */
export function parsePayload(raw: unknown): Payload | null {
  const p = raw as Partial<Payload> | null;
  const list = (x: unknown) => (x === null || x === undefined ? [] : Array.isArray(x) ? x : null);   // jsonb_agg of nothing is null
  const [g, r, s] = [list(p?.gaps), list(p?.rising_wishlist), list(p?.condition_spectrum)];
  if (!p || typeof p !== 'object' || !p.coverage || !g || !r || !s) return null;
  return { coverage: p.coverage, cube_first_period: p.cube_first_period ?? null, cube_last_period: p.cube_last_period ?? null, gaps: g, rising_wishlist: r, condition_spectrum: s };
}

/** `data` is null for a report that is not there (not reviewed, unknown, or not a uuid: then nothing was called). */
export async function openReport(c: Client, id: string): Promise<Insight<ReportDetail | null>> {
  return isUuid(id) ? report(c, id) : { ok: true, data: null };
}
