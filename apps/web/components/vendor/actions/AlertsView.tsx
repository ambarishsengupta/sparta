'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { FACTORY_THRESHOLDS, THRESHOLD_LIMITS, getThresholds, resetThresholds, setThresholds } from '../../../lib/demo-vendor-actions';
import { useThresholdsVersion } from './hooks';
import { Thumb } from './Parts';
import { currentAlerts, type AlertKind } from './alerts';

const KINDS: readonly AlertKind[] = ['Stockout soon', 'Overstock', 'Demand rise', 'Slow mover'];

/** `/vendor/alerts`: the feed of the current alerts, and the settings for the cover thresholds (kept in this browser; changing them changes every status and every alert). */
export function AlertsView() {
  const tv = useThresholdsVersion();
  const alerts = useMemo(currentAlerts, [tv]);
  const th = getThresholds();
  const [kind, setKind] = useState<AlertKind | ''>('');
  const shown = alerts.filter((a) => kind === '' || a.kind === kind);
  return (
    <div className="wide va">
      <Settings restock={th.restockCover} overstock={th.overstockCover} watch={th.watchCover} />
      <section aria-labelledby="va-feed">
        <h2 id="va-feed">Open alerts ({alerts.length})</h2>
        <div className="va-filters" role="group" aria-label="Filter the alerts">
          <label>Type<select value={kind} onChange={(e) => setKind(e.target.value as AlertKind | '')}><option value="">All types</option>{KINDS.map((k) => <option key={k} value={k}>{k} ({alerts.filter((a) => a.kind === k).length})</option>)}</select></label>
        </div>
        {shown.length === 0 ? <p className="vd-empty">No alerts of this type.</p> : (
          <ul className="va-feed">
            {shown.map((a) => (
              <li key={a.id} className="va-alert" data-severity={a.severity}>
                <Link href={`/vendor/products/${a.product.id}`} aria-label={`${a.product.name}: product page`}><Thumb product={a.product} /></Link>
                <div className="va-alert-body">
                  <p className="va-alert-head"><span className="va-sev" data-severity={a.severity}>{a.severity}</span> <b>{a.kind}</b> <span className="muted">{a.time}</span></p>
                  <p><Link href={`/vendor/products/${a.product.id}`}>{a.product.name}</Link>{' · '}{a.stores.length === 0 ? 'All stores' : a.stores.length <= 3 ? a.stores.map((s) => s.name).join(', ') : `${a.stores.slice(0, 2).map((s) => s.name).join(', ')} and ${a.stores.length - 2} more`}</p>
                  <p>{a.text}</p>
                </div>
                <Link className="button secondary" href={a.href} aria-label={`${a.action}: ${a.product.name}`}>{a.action}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Settings({ restock, overstock, watch }: { restock: number; overstock: number; watch: number }) {
  const [r, setR] = useState(String(restock));
  const [o, setO] = useState(String(overstock));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = () => {
    const problem = setThresholds(Number(r.trim()), Number(o.trim()));
    setMsg(problem ? { ok: false, text: problem } : { ok: true, text: `Saved in this browser. Restock now is under ${Number(r)} weeks of cover and Overstock is over ${Number(o)} weeks, on every screen.` });
  };
  const reset = () => { resetThresholds(); setR(String(FACTORY_THRESHOLDS.restockCover)); setO(String(FACTORY_THRESHOLDS.overstockCover)); setMsg({ ok: true, text: `Back to ${FACTORY_THRESHOLDS.restockCover} and ${FACTORY_THRESHOLDS.overstockCover} weeks.` }); };
  return (
    <section className="va-settings" aria-labelledby="va-settings-h">
      <h2 id="va-settings-h">Alert thresholds</h2>
      <p className="muted">Weeks of cover is stock on hand divided by the average weekly units of the last 4 weeks. Watch stays at under {watch} weeks. Saving changes the status badges, the counts and these alerts everywhere.</p>
      <form className="va-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label>Restock now: cover under (weeks)<input type="text" inputMode="decimal" value={r} onChange={(e) => setR(e.target.value)} aria-describedby="va-limits" autoComplete="off" /></label>
        <label>Overstock: cover over (weeks)<input type="text" inputMode="decimal" value={o} onChange={(e) => setO(e.target.value)} aria-describedby="va-limits" autoComplete="off" /></label>
        <button type="submit" className="primary">Save thresholds</button>
        <button type="button" onClick={reset}>Reset to {FACTORY_THRESHOLDS.restockCover} and {FACTORY_THRESHOLDS.overstockCover}</button>
      </form>
      <p id="va-limits" className="muted">Restock now: {THRESHOLD_LIMITS.restockMin} to {watch} weeks. Overstock: above {watch} and up to {THRESHOLD_LIMITS.overstockMax} weeks.</p>
      {msg ? <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'va-done' : 'va-error'}>{msg.text}</p> : null}
    </section>
  );
}
