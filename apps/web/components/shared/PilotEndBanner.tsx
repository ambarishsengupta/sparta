import Link from 'next/link';
import { dataBackend } from '../../lib/supabase/config';
import { endDateText, type BannerState } from '../../lib/pilot-end';
import { createServerSupabase } from '../../lib/supabase/server';
import { loadBanner } from './load-banner';

/** What happens at the end, by outcome (FR-69). */
export const OUTCOME_COPY = {
  close: 'The pilot is closing. Your account and everything in it will be deleted.',
  continue: 'The pilot is continuing. To stay, you will need to accept a new pilot notice; if you do not, your account and everything in it will be deleted.',
} as const;

/** FR-69, LLD 9.4: the end-of-pilot banner. A labelled region (a landmark, not a live region), so it is found on a page but not read out again on every navigation. */
export function EndOfPilotBanner({ state }: { state: BannerState }) {
  if (!state.show) return null;
  const when = endDateText(state.endDate);
  return (
    <section aria-labelledby="pilot-end-title">
      <h2 id="pilot-end-title">{state.daysLeft < 0 ? `The pilot ended on ${when}` : `The pilot ends on ${when}`}</h2>
      <p>{OUTCOME_COPY[state.outcome]}</p>
      <p className="muted">You can save a copy of your data or leave now.</p>
      <div className="row">
        <Link href="/settings" className="button secondary" prefetch={false}>Export my data</Link>
        <Link href="/leave" className="button secondary" prefetch={false}>Leave the pilot</Link>
      </div>
      <hr />
    </section>
  );
}

/** The signed-in shell's banner: consumers only, never with the browser-only local backend. A failed read shows nothing. */
export async function PilotEndBanner() {
  if (dataBackend() !== 'supabase') return null;
  return <EndOfPilotBanner state={await loadBanner(await createServerSupabase())} />;
}
