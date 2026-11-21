import type { SupabaseClient } from '@supabase/supabase-js';
import { bannerState, type BannerState } from '../../lib/pilot-end';
import type { Database } from '../../lib/supabase/database.types';

const HIDDEN: BannerState = { show: false };
/** A page never waits longer than this for the banner: a slow read shows nothing (the page matters more). */
export const BANNER_READ_TIMEOUT_MS = 1000;

/**
 * What the banner needs for the signed-in caller: a state only for a consumer. Vendors, admins and anyone without a profile get none, and any read
 * failure gives none (nothing is shown and nothing is logged, so no personal data can reach a log).
 */
export async function loadBanner(client: Pick<SupabaseClient<Database>, 'schema'>, now: Date = new Date(), timeoutMs: number = BANNER_READ_TIMEOUT_MS): Promise<BannerState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<BannerState>((resolve) => { timer = setTimeout(() => resolve(HIDDEN), timeoutMs); });
  try {
    return await Promise.race([read(client, now), late]);
  } catch {
    return HIDDEN;
  } finally {
    clearTimeout(timer);
  }
}

async function read(client: Pick<SupabaseClient<Database>, 'schema'>, now: Date): Promise<BannerState> {
  const app = client.schema('app');
  const [profile, date, outcome] = await Promise.all([
    app.from('profiles').select('role').maybeSingle(),
    app.rpc('public_setting', { p_key: 'pilot_end_date' }),
    app.rpc('public_setting', { p_key: 'pilot_outcome' }),
  ]);
  if (profile.error || profile.data?.role !== 'consumer' || date.error || outcome.error) return HIDDEN;
  return bannerState(date.data, outcome.data, now.toISOString().slice(0, 10));
}
