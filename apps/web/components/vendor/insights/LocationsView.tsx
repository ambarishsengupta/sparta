'use client';
import { useState } from 'react';
import { AGE_GROUPS, BUDGETS, DEMO_CITIES, NO_USER_FILTER, cityUsers, leadingAge, type AgeGroup, type Budget, type DemoCity, type UserFilter } from '../../../lib/demo-vendor-insights';
import { BarList } from '../../ui/vendor';
import { DotMap } from './DotMap';

const pct = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '0%');

/** "Where your users are": a dot map of 14 cities, a side panel for the chosen city, and a table. The three filters re-weight the circles and the table. Fixed, simulated figures; nothing is called. */
export function LocationsView() {
  const [filter, setFilter] = useState<UserFilter>(NO_USER_FILTER);
  const [pick, setPick] = useState<string>('Bengaluru');
  const rows = DEMO_CITIES.map((c) => ({ c, users: cityUsers(c, filter) })).sort((a, b) => b.users - a.users || a.c.name.localeCompare(b.c.name));
  const total = rows.reduce((n, r) => n + r.users, 0);
  const city = DEMO_CITIES.find((c) => c.name === pick) ?? DEMO_CITIES[0]!;
  const set = (patch: Partial<UserFilter>) => setFilter({ ...filter, ...patch });
  return (
    <div className="wide">
      <div className="filters ins-filters" role="group" aria-label="Filter the users">
        <label>Age group<select value={filter.age} onChange={(e) => set({ age: e.target.value as AgeGroup | '' })}><option value="">Any</option>{AGE_GROUPS.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
        <label>Budget band<select value={filter.budget} onChange={(e) => set({ budget: e.target.value as Budget | '' })}><option value="">Any</option>{BUDGETS.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
        <label>City tier<select value={filter.tier} onChange={(e) => set({ tier: e.target.value as UserFilter['tier'] })}><option value="">Any</option><option value="1">Tier 1</option><option value="2">Tier 2</option></select></label>
      </div>
      <p role="status">{total} users in this view, counts rounded to the nearest 5.</p>
      <div className="ins-split">
        <DotMap cities={rows.map((r) => ({ city: r.c, users: r.users }))} selected={city.name} onSelect={setPick} />
        <CityPanel city={city} users={rows.find((r) => r.c.name === city.name)?.users ?? 0} />
      </div>
      <table className="ins-table">
        <caption>All cities, most users first</caption>
        <thead><tr><th scope="col">City</th><th scope="col">Users</th><th scope="col">Share</th><th scope="col">3-month growth</th><th scope="col">Leading age group</th></tr></thead>
        <tbody>
          {rows.map(({ c, users }) => (
            <tr key={c.name} aria-selected={c.name === city.name}>
              <th scope="row"><button type="button" className="linklike" aria-pressed={c.name === city.name} onClick={() => setPick(c.name)}>{c.name}</button></th>
              <td>{users}</td><td>{pct(users, total)}</td><td>+{c.growth}%</td><td>{leadingAge(c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CityPanel({ city, users }: { city: DemoCity; users: number }) {
  return (
    <section className="ins-panel" aria-label={`${city.name} in detail`}>
      <h2>{city.name}</h2>
      <dl className="ins-facts">
        <div><dt>Users</dt><dd>{users}</dd></div>
        <div><dt>Growth, 3 months</dt><dd>+{city.growth}%</dd></div>
        <div><dt>City tier</dt><dd>Tier {city.tier}</dd></div>
        <div><dt>Climate now</dt><dd>{city.climate}</dd></div>
      </dl>
      <h3>Age groups</h3>
      <BarList name={`Age groups in ${city.name}`} max={100} rows={AGE_GROUPS.map((a, i) => ({ label: a, value: city.ages[i]!, text: `${city.ages[i]}%` }))} />
      <h3>Budget bands</h3>
      <BarList name={`Budget bands in ${city.name}`} max={100} rows={BUDGETS.map((b, i) => ({ label: b, value: city.budgets[i]!, text: `${city.budgets[i]}%` }))} />
      <h3>Top styles</h3>
      <ol className="ins-styles">{city.styles.map((s) => <li key={s}>{s}</li>)}</ol>
    </section>
  );
}
