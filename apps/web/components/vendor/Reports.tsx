'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EventLog } from '../../lib/events';
import { createBrowserSupabase } from '../../lib/supabase/browser';
import { INSIGHT_SENTENCES, loadFailed, reports, type Insight, type ReportDetail, type ReportRow } from '../../lib/vendor/insights';
import { NOT_FOUND, openReport, parsePayload, type Payload } from '../../lib/vendor/reports';
import { BandShareBar, BarList } from '../ui/vendor';
import styles from '../ui/vendor/vendor-charts.module.css';
import { GapsTable } from './Gaps';

type Slot<T> = Insight<T> | null; // null: still loading
const month = (d: string) => d.slice(0, 7);
const day = (iso: string) => iso.slice(0, 10);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '2026-11-01' to 'November 2026' (no locale, no time zone). */
export const monthName = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1] ?? d.slice(5, 7)} ${d.slice(0, 4)}`;

/** FR-78: the reviewed reports of the vendor's portal, newest first. */
export function ReportList() {
  const [list, setList] = useState<Slot<ReportRow[]>>(null);
  useEffect(() => { let live = true; reports(createBrowserSupabase()).then((r) => live && setList(r), () => live && setList(loadFailed())); return () => { live = false; }; }, []);
  return <ReportListView list={list} />;
}
export function ReportListView({ list }: { list: Slot<ReportRow[]> }) {
  if (list === null) return <p role="status">Loading.</p>;
  if (!list.ok) return <p className="error" role="alert">{list.message}</p>;
  if (!list.data.length) return <p className="muted">No report has been reviewed yet. Reports appear here after they have been checked.</p>;
  return (
    <div className="wide"><table className={styles.trend}>
      <caption>Reviewed reports</caption>
      <thead><tr><th scope="col">Month</th><th scope="col">Reviewed on</th><th scope="col">Report</th></tr></thead>
      <tbody>{list.data.map((r) => <tr key={r.id}><th scope="row">{month(r.period)}</th><td>{day(r.reviewed_at)}</td><td><Link href={`/vendor/reports/${r.id}`}>Open the report for {month(r.period)}</Link></td></tr>)}</tbody>
    </table></div>
  );
}

/** One reviewed report. The uuid is checked before any call; `vendor_report_opened` is recorded once per opening, when a report is actually shown. */
export function ReportPage({ id }: { id: string }) {
  const [one, setOne] = useState<Slot<ReportDetail | null>>(null);
  const recorded = useRef('');
  useEffect(() => {
    let live = true;
    openReport(createBrowserSupabase(), id).then((r) => {
      if (!live) return;
      setOne(r);
      if (r.ok && r.data && recorded.current !== id) { recorded.current = id; new EventLog().record('vendor_report_opened'); }
    }, () => { if (live) setOne(loadFailed()); });
    return () => { live = false; };
  }, [id]);
  return <ReportView one={one} />;
}
/** The heading is part of the view: 'Report: November 2026' once the report is known, 'Report' while loading or when there is none. */
export function ReportView({ one }: { one: Slot<ReportDetail | null> }) {
  return <><h1>{one?.ok && one.data ? `Report: ${monthName(one.data.period)}` : 'Report'}</h1><ReportBody one={one} /></>;
}
function ReportBody({ one }: { one: Slot<ReportDetail | null> }) {
  if (one === null) return <p role="status">Loading.</p>;
  if (!one.ok) return <p className="error" role="alert">{one.message}</p>;
  const payload = one.data && parsePayload(one.data.payload);
  if (!one.data || !payload) return <><p role="status">{one.data ? INSIGHT_SENTENCES.unexpected : NOT_FOUND}</p><Link href="/vendor/reports">All reports</Link></>;
  return <Sections period={month(one.data.period)} reviewed={day(one.data.reviewed_at)} p={payload} />;
}

function Sections({ period, reviewed, p }: { period: string; reviewed: string; p: Payload }) {
  const people = p.coverage.users_rounded === null ? 'a cohort too small to display' : `about ${p.coverage.users_rounded} contributing users`;
  return (
    <div className="wide">
      <p className="muted">Month {period}. Reviewed on {reviewed}. <Link href="/vendor/reports">All reports</Link></p>
      <h2>Notes</h2>
      <ul>
        <li>Based on {people}. Counts are rounded to the nearest 5 and a segment with fewer than 10 users is never shown.</li>
        <li>Pilot period: aggregates cover {p.cube_first_period ? month(p.cube_first_period) : 'unknown'} to {p.cube_last_period ? month(p.cube_last_period) : 'unknown'}{p.coverage.last_run_at ? `, last aggregation run ${day(p.coverage.last_run_at)}` : ''}. Only consenting pilot participants are included.</li>
      </ul>
      <h2>Top gaps</h2>
      {p.gaps.length ? <GapsTable caption="Gaps by category and colour family, highest gap score first" rows={p.gaps} /> : <p className="muted">No gaps to show this month.</p>}
      <h2>Rising wishlist segments</h2>
      {p.rising_wishlist.length ? <BarList name="Rising wishlist categories: increase in users" rows={p.rising_wishlist.map((r) => ({ label: r.segment, value: r.increase, text: `+${r.increase} users (${r.previous_users_rounded} to ${r.users_rounded})` }))} /> : <p className="muted">No category is rising this month.</p>}
      <h2>Condition spectrum</h2>
      {p.condition_spectrum.map((s) => <section key={s.category}><h3>{s.category}</h3><BandShareBar category={s.category} bands={s.bands ?? []} /></section>)}
    </div>
  );
}
