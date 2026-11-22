import type { DemoCity } from '../../../lib/demo-vendor-insights';

/** The map's window in degrees: an equirectangular projection (x from the longitude, y from the latitude, one scale for both), no outline and no tiles. */
const LON0 = 68, LON1 = 98, LAT0 = 6, LAT1 = 36;
const x = (lon: number) => ((lon - LON0) / (LON1 - LON0)) * 100;
const y = (lat: number) => ((LAT1 - lat) / (LAT1 - LAT0)) * 100;
/** The side a city's name sits on, chosen so neighbouring names do not overlap. */
const LEFT = new Set(['Mumbai', 'Bengaluru', 'Kochi', 'Ahmedabad']);
const TICKS = [10, 15, 20, 25, 30, 35];
const MERIDIANS = [70, 75, 80, 85, 90, 95];

/** A faint hairline grid, one circle per city sized by its users (area in proportion), and a button over each circle's centre that selects the city. The name is HTML text so it keeps the label size on a narrow screen. */
export function DotMap({ cities, selected, onSelect }: { cities: { city: DemoCity; users: number }[]; selected: string; onSelect: (name: string) => void }) {
  const top = Math.max(1, ...cities.map((c) => c.users));
  const radius = (u: number) => (u <= 0 ? 0 : 1.2 + 4.2 * Math.sqrt(u / top));   // in percent of the map's width
  return (
    <div className="ins-map" role="group" aria-label="Map of the cities, a circle per city sized by its users">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {TICKS.map((t) => <line key={`h${t}`} x1="0" x2="100" y1={y(t)} y2={y(t)} className="ins-grid" />)}
        {MERIDIANS.map((m) => <line key={`v${m}`} y1="0" y2="100" x1={x(m)} x2={x(m)} className="ins-grid" />)}
        {cities.map(({ city, users }) => users > 0 && <circle key={city.name} cx={x(city.lon)} cy={y(city.lat)} r={radius(users)} className={city.name === selected ? 'ins-circle on' : 'ins-circle'} />)}
      </svg>
      {cities.map(({ city, users }) => {
        const on = city.name === selected;
        return (
          <button key={city.name} type="button" className="ins-dot" data-side={LEFT.has(city.name) ? 'l' : 'r'} aria-pressed={on} aria-label={`${city.name}, ${users} users`} onClick={() => onSelect(city.name)}
            style={{ left: `${x(city.lon)}%`, top: `${y(city.lat)}%`, '--r': radius(users) } as React.CSSProperties}>
            <span className="ins-name">{city.name}</span>
          </button>
        );
      })}
    </div>
  );
}
