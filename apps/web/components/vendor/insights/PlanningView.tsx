'use client';
import { useMemo, useState } from 'react';
import { ACTIONS, AGE_GROUPS, BUDGETS, DEMAND_INDEX, REGIONS, STYLES, planCards, segmentText, type Action, type AgeGroup, type Budget, type PlanCard, type Region, type Style } from '../../../lib/demo-vendor-insights';
import { ProductPhoto } from '../../ui/ProductPhoto';

interface Pick { region: Region | ''; age: AgeGroup | ''; budget: Budget | ''; style: Style | ''; action: Action | '' }
const NONE: Pick = { region: '', age: '', budget: '', style: '', action: '' };
const keep = (c: PlanCard, p: Pick) => (p.region === '' || c.region === p.region) && (p.age === '' || c.age === p.age) && (p.action === '' || c.action === p.action)
  && (p.budget === '' || (c.segment.kind === 'budget' && c.segment.value === p.budget)) && (p.style === '' || (c.segment.kind === 'style' && c.segment.value === p.style));
/** The label with the most opportunity: the keys are summed over the cards and the largest sum wins (ties go to the first). */
function top(cards: PlanCard[], key: (c: PlanCard) => string): string | null {
  const sums = new Map<string, number>();
  for (const c of cards) sums.set(key(c), (sums.get(key(c)) ?? 0) + c.opportunity);
  return [...sums.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
const shade = (n: number) => `color-mix(in srgb, var(--accent) ${Math.round(n * 0.85)}%, var(--surface))`;

/** "Inventory planning by location": filters, a summary row, the recommendation cards and the demand matrix. Fixed, simulated advice; nothing is called. */
export function PlanningView() {
  const all = useMemo(planCards, []);
  const [p, setP] = useState<Pick>(NONE);
  const cards = all.filter((c) => keep(c, p));
  const set = (patch: Partial<Pick>) => setP({ ...p, ...patch });
  const sel = <T extends string>(label: string, key: keyof Pick, values: readonly T[]) => (
    <label>{label}<select value={p[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<Pick>)}><option value="">{key === 'region' ? 'All' : 'Any'}</option>{values.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
  );
  return (
    <div className="wide">
      <div className="filters ins-filters" role="group" aria-label="Filter the advice">
        {sel('Region', 'region', REGIONS)}{sel('Age group', 'age', AGE_GROUPS)}{sel('Budget band', 'budget', BUDGETS)}{sel('Style', 'style', STYLES)}{sel('Action', 'action', ACTIONS)}
      </div>
      <dl className="ins-summary" aria-label="Summary of the cards shown">
        <div><dt>Stock up cards</dt><dd>{cards.filter((c) => c.action === 'Stock up').length}</dd></div>
        <div><dt>Top city by opportunity</dt><dd>{top(cards, (c) => c.place) ?? 'None'}</dd></div>
        <div><dt>Top age group by opportunity</dt><dd>{top(cards, (c) => c.age) ?? 'None'}</dd></div>
      </dl>
      {cards.length === 0 ? <p role="status">No advice matches these filters.</p> : <ul className="ins-cards" aria-label="Recommendations">
        {cards.map((c) => (
          <li key={c.id} className="ins-card">
            <div className="ins-photo"><ProductPhoto id={c.photoId} name={c.line} /></div>
            <p className="ins-action" data-action={c.action}>{c.action}</p>
            <h3>{c.line}</h3>
            <p className="ins-where">{c.place} · {segmentText(c)}</p>
            <p className="ins-change">{c.change}</p>
            <p className="muted">Confidence: {c.confidence}</p>
            <p className="ins-reason">{c.reason}</p>
          </li>
        ))}
      </ul>}
      <h2>Demand by age group and region</h2>
      <table className="ins-matrix">
        <caption>Demand index, 0 to 100, simulated</caption>
        <thead><tr><th scope="col">Age group</th>{REGIONS.map((r) => <th key={r} scope="col">{r}</th>)}</tr></thead>
        <tbody>
          {AGE_GROUPS.map((a) => (
            <tr key={a}><th scope="row">{a}</th>{REGIONS.map((r) => { const n = DEMAND_INDEX[a][r]; return <td key={r} style={{ background: shade(n), color: n >= 60 ? 'var(--on-accent)' : 'var(--text)' }}>{n}</td>; })}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
