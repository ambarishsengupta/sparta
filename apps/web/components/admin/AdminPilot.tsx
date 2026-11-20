'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { Send } from './admin-actions';
import {
  CONFIRM_WORD, MAX_CALLS, MAX_RETRIES, OUTCOMES, PREVIEW_PATH, SETTINGS_PATH, endCall, pilotRead, readPreview, readSettings,
  type EndAnswer, type Outcome, type PilotPreview, type PilotSettings,
} from './pilot-actions';

/** The admin end-of-pilot page (WO-0173, FR-69, BR-45): the end date and outcome, the read-only preview of what the end deletes, and the one action that runs it.
 * The end button stays off until the preview is on the page; the typed word is checked here and again by the server. The run calls the route until it is done, shows the counts after
 * each call (never an id or an address), stops at `stuck` and at a refusal after the start (`interrupted`), and calls again on `more` and on an answer that was not JSON (a platform timeout). */
export type Phase = 'loading' | 'ready' | 'running' | 'done' | 'stuck' | 'interrupted' | 'failed';
export interface Totals { calls: number; deleted: number; unmarked: number; alreadyHandled: number; purgeFailed: number; deleteFailed: number; invitations: number; remaining: number; vendorItems: number; vendorUsers: number; vendorsRan: boolean }
export const NO_TOTALS: Totals = { calls: 0, deleted: 0, unmarked: 0, alreadyHandled: 0, purgeFailed: 0, deleteFailed: 0, invitations: 0, remaining: 0, vendorItems: 0, vendorUsers: 0, vendorsRan: false };
const FINISHED: Phase[] = ['done', 'stuck', 'interrupted', 'failed'];
const OUTCOME_LABEL: Record<Outcome, string> = { close: 'Close', continue: 'Continue' };
const OUTCOME_HINT = 'Close deletes the participants, then withdraws vendor items and deletes vendor accounts. Continue deletes the participants only; vendors stay.';
/** The earliest date the date field offers: today, or the stored date when that has already passed (the route lets a passed stored date stay while the outcome changes). */
export const minDate = (stored: string | null, today: string): string => (stored !== null && stored < today ? stored : today);

/** Today as the database reads it (UTC), `YYYY-MM-DD`. */
export const todayUtc = (): string => new Date().toISOString().slice(0, 10);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The reasons the End button is off; an empty list means it may be pressed. The preview comes first: nothing else matters until the admin has seen what the end deletes (Spec QC finding 2). */
export function blockers(f: { settings: PilotSettings | null; preview: PilotPreview | null; typed: string; today: string }): string[] {
  const out: string[] = [];
  if (f.preview === null) out.push('The preview of what will be deleted is not on the page yet.');
  if (f.settings === null || f.settings.date === null) out.push('No end date is saved.');
  else if (f.today < f.settings.date) out.push(`The end date (${f.settings.date}) has not been reached.`);
  if (f.settings === null || f.settings.outcome === null || f.preview?.outcomeUnset === true) out.push('No outcome is saved.');
  if (f.typed !== CONFIRM_WORD) out.push(`Type ${CONFIRM_WORD} to confirm.`);
  return out;
}

/** The counts of the run so far: the per-call counts of the route add up, `remaining` is the latest. */
export function addAnswer(t: Totals, a: EndAnswer): Totals {
  return {
    calls: t.calls, deleted: t.deleted + a.deleted, unmarked: t.unmarked + a.unmarked, alreadyHandled: t.alreadyHandled + a.alreadyHandled,
    purgeFailed: t.purgeFailed + a.purgeFailed, deleteFailed: t.deleteFailed + a.deleteFailed, invitations: t.invitations + a.invitations, remaining: a.remaining,
    vendorItems: t.vendorItems + (a.vendors?.items ?? 0), vendorUsers: t.vendorUsers + (a.vendors?.users ?? 0), vendorsRan: t.vendorsRan || a.vendors !== null,
  };
}

function when(date: string, today: string): string {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days < 0 ? 'already reached' : days === 0 ? 'today' : `in ${plural(days, 'day', 'days')}`;
}

function Counts({ t }: { t: Totals }) {
  return (
    <ul className="list">
      <li className="card"><p className="title">{plural(t.deleted, 'participant', 'participants')} deleted</p></li>
      <li className="card"><p className="title">{plural(t.remaining, 'participant', 'participants')} still to do</p></li>
      {t.unmarked + t.alreadyHandled > 0 && <li className="card"><p className="title">{plural(t.unmarked + t.alreadyHandled, 'participant', 'participants')} kept or already handled</p></li>}
      <li className="card"><p className="title">{plural(t.invitations, 'unused invitation', 'unused invitations')} deleted</p></li>
      {t.vendorsRan && <li className="card"><p className="title">{plural(t.vendorItems, 'vendor item', 'vendor items')} withdrawn, {plural(t.vendorUsers, 'vendor account', 'vendor accounts')} deleted</p></li>}
      {t.purgeFailed + t.deleteFailed > 0 && <li className="card"><p className="title error">{plural(t.purgeFailed, 'participant', 'participants')} whose files could not be removed, {plural(t.deleteFailed, 'account', 'accounts')} that could not be deleted</p></li>}
    </ul>
  );
}

export function AdminPilot({ send, today }: { send?: Send; today?: string }) {
  const now = today ?? todayUtc();
  const [settings, setSettings] = useState<PilotSettings | null>(null);
  const [preview, setPreview] = useState<PilotPreview | null>(null);
  const [loadProblem, setLoadProblem] = useState('');
  const [previewProblem, setPreviewProblem] = useState('');
  const [date, setDate] = useState('');
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  const [typed, setTyped] = useState('');
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [totals, setTotals] = useState<Totals>(NO_TOTALS);
  const live = useRef(true);        // false once the page was left: an answer that arrives after that is dropped
  const running = useRef(false);    // set at once on the first press, so a second press in the same moment does nothing
  const result = useRef<HTMLDivElement>(null);
  const reasons = useId();
  const hint = useId();

  const fetchPreview = async () => {
    const r = await pilotRead(PREVIEW_PATH, 'GET', readPreview, undefined, send);
    if (!live.current) return;
    if (r.ok) setPreview(r.data); else setPreviewProblem(r.message);
  };
  const loadPreview = () => { setPreview(null); setPreviewProblem(''); void fetchPreview(); };   // asked for by the person (after a save, or the retry button): the old preview goes first, so the button cannot act on it
  const loadAgain = () => { setLoadProblem(''); setRound(round + 1); };
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let on = true;   // false once the page was left or a newer load started: an answer that arrives after that is dropped
    void pilotRead(SETTINGS_PATH, 'GET', readSettings, undefined, send).then((s) => {
      if (!on) return;
      if (s.ok) { setSettings(s.data); setDate(s.data.date ?? ''); setOutcome(s.data.outcome ?? ''); setPhase('ready'); } else setLoadProblem(s.message);
    });
    void pilotRead(PREVIEW_PATH, 'GET', readPreview, undefined, send).then((p) => {   // each answer is shown as it arrives; the End button waits for the preview, not for the settings
      if (!on) return;
      if (p.ok) { setPreview(p.data); setPreviewProblem(''); } else setPreviewProblem(p.message);
    });
    return () => { on = false; };
  }, [send, round]);
  useEffect(() => { if (FINISHED.includes(phase)) result.current?.focus(); }, [phase]);

  const save = async () => {
    if (date === '' || outcome === '') return;
    setSaving(true); setProblem(''); setMessage('');
    const r = await pilotRead(SETTINGS_PATH, 'PATCH', readSettings, { pilot_end_date: date, pilot_outcome: outcome }, send);
    if (!live.current) return;
    setSaving(false);
    if (r.ok) { setSettings(r.data); setMessage(`Saved. The pilot ends on ${r.data.date ?? date}.`); loadPreview(); } else setProblem(r.message);
  };

  const off = blockers({ settings, preview, typed, today: now });
  const busy = phase === 'running';
  const run = async () => {
    if (running.current || blockers({ settings, preview, typed, today: now }).length > 0) return;
    running.current = true;
    setPhase('running'); setProblem(''); setMessage('');
    setPreview(null); setPreviewProblem('');   // the counts before the run are out of date from the first call on; a run that stops asks for fresh ones
    let reload = true;
    let t = NO_TOTALS; let retries = 0; let touched = false;
    setTotals(t);
    const stop = (to: Phase, reason: string) => { setProblem(reason); setPhase(to); };
    try {
      for (;;) {
        if (t.calls >= MAX_CALLS) { stop('failed', `Stopped after ${MAX_CALLS} calls. The counts so far are shown. Run it again to continue.`); break; }
        t = { ...t, calls: t.calls + 1 };
        const step = await endCall(send);
        if (!live.current) break;
        if (step.kind === 'retry') {
          retries += 1;
          if (retries > MAX_RETRIES) { stop(touched ? 'failed' : 'ready', 'The server did not answer as expected several times in a row. Run it again to continue.'); break; }
          setTotals(t);
          continue;
        }
        retries = 0;
        if (step.kind === 'error') { stop(touched ? 'failed' : 'ready', step.message); break; }
        touched = true;
        t = addAnswer(t, step.data); setTotals(t);
        if (step.data.stuck) { setPhase('stuck'); break; }
        if (step.data.interrupted) { setPhase('interrupted'); break; }
        if (step.data.done && !step.data.more) { reload = false; setPhase('done'); break; }
        if (!step.data.more && !step.data.done && step.data.processed === 0) { stop('failed', 'The run made no progress, so it stopped. Run it again to continue.'); break; }
      }
    } finally { running.current = false; if (reload && live.current) void fetchPreview(); }
  };

  return (
    <>
      <h1>End of the pilot</h1>
      {loadProblem && (
        <div className="form">
          <p role="alert" className="error">{loadProblem}</p>
          <div className="row"><button type="button" onClick={loadAgain}>Load again</button></div>
        </div>
      )}
      <p className="muted" role="status">{phase === 'loading' && !loadProblem ? 'Loading…' : ''}</p>

      {settings !== null && (
        <>
          <h2>When the pilot ends</h2>
          <p>{settings.date === null ? 'No end date is saved yet.' : <>Planned end date: <strong>{settings.date}</strong> ({when(settings.date, now)}). Outcome: <strong>{settings.outcome === null ? 'not chosen' : settings.outcome === 'close' ? 'Close' : 'Continue'}</strong>.</>}</p>
          <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <label>End date<input type="date" value={date} min={minDate(settings.date, now)} onChange={(e) => setDate(e.target.value)} /></label>
            <label>Outcome
              <select value={outcome} aria-describedby={hint} onChange={(e) => setOutcome(OUTCOMES.find((o) => o === e.target.value) ?? '')}>
                <option value="">Choose</option>
                {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
              </select>
            </label>
            <p id={hint} className="muted">{OUTCOME_HINT}</p>
            <div className="row"><button type="submit" className="primary" disabled={date === '' || outcome === '' || saving || busy} aria-busy={saving || undefined}>Save end date and outcome</button></div>
            <p role="status" className="muted">{message}</p>
          </form>
          {problem && phase === 'ready' && <p role="alert" className="error">{problem}</p>}

          {phase !== 'running' && phase !== 'done' && (
            <>
              <h2>What the end will delete</h2>
              {preview === null && !previewProblem && <p className="muted" role="status">Loading the preview…</p>}
              {previewProblem && (
                <div className="form">
                  <p role="alert" className="error">{previewProblem}</p>
                  <div className="row"><button type="button" onClick={loadPreview}>Load the preview again</button></div>
                </div>
              )}
              {preview !== null && (
                <div>
                  <p className="muted">Counts only. Nothing has been deleted yet.</p>
                  <ul className="list" aria-label="What the end will delete">
                    <li className="card"><p className="title">{plural(preview.consumers, 'participant', 'participants')} will be deleted, with their items, photos, receipts and exports</p></li>
                    <li className="card"><p className="title">{plural(preview.invitations, 'unused invitation', 'unused invitations')} will be deleted</p></li>
                    <li className="card"><p className="title">{plural(preview.vendors, 'vendor account', 'vendor accounts')}, deleted only when the outcome is Close</p></li>
                  </ul>
                </div>
              )}
            </>
          )}

          {phase !== 'done' && (
            <>
              <h2>End the pilot</h2>
              <p>{preview === null ? 'This deletes the participants for good.' : `This deletes ${plural(preview.consumers, 'participant', 'participants')} and everything they saved for good.`} It cannot be taken back. Type {CONFIRM_WORD}, then press the button.</p>
              <div className="form">
                <label>Type {CONFIRM_WORD} to confirm<input type="text" value={typed} autoComplete="off" readOnly={busy} onChange={(e) => setTyped(e.target.value)} /></label>
                <div className="row">
                  <button type="button" className="danger" aria-disabled={busy || off.length > 0 || undefined} aria-busy={busy || undefined} aria-describedby={reasons}
                    onClick={busy || off.length > 0 ? undefined : () => void run()}>End the pilot</button>
                </div>
                <div id={reasons}>
                  {busy ? <p className="muted">Running. Keep this page open.</p> : off.length > 0 ? <ul>{off.map((r) => <li key={r} className="muted">{r}</li>)}</ul> : <p className="muted">Ready.</p>}
                </div>
              </div>
            </>
          )}

          <p role="status" className="muted">{busy ? `Ending the pilot. Call ${totals.calls}: ${plural(totals.deleted, 'participant', 'participants')} deleted so far, ${totals.remaining} still to do.` : ''}</p>
          {(busy || FINISHED.includes(phase)) && (
            <div ref={result} tabIndex={-1} aria-label="Result of the end of the pilot" role="group">
              <h2>{phase === 'done' ? 'The pilot has ended' : phase === 'running' ? 'Progress' : 'The run stopped'}</h2>
              {phase === 'done' && <p>Every participant was handled and the end is recorded.</p>}
              {phase === 'stuck' && <p role="alert" className="error">Stopped: {plural(totals.purgeFailed, 'participant', 'participants')} could not be removed ({plural(totals.deleteFailed, 'account', 'accounts')} could not be deleted). Nothing more was tried. Fix the cause, then run it again.</p>}
              {phase === 'interrupted' && <p role="alert" className="error">The server refused a later step after the run had started, so it stopped. The counts so far are shown. Run it again to continue.</p>}
              {problem && phase === 'failed' && <p role="alert" className="error">{problem}</p>}
              <Counts t={totals} />
            </div>
          )}
        </>
      )}
    </>
  );
}
