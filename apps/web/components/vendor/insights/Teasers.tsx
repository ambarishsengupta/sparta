import Link from 'next/link';
import { DEMO_CITIES, planCards } from '../../../lib/demo-vendor-insights';

/** Two cards above the demo dashboard: the three largest cities, and the count of Stock up advice with the first card's headline. Fixed, simulated figures. */
export function Teasers() {
  const cities = [...DEMO_CITIES].sort((a, b) => b.users - a.users).slice(0, 3);
  const cards = planCards();
  const stock = cards.filter((c) => c.action === 'Stock up').length;
  return (
    <div className="ins-teasers">
      <section className="ins-teaser" aria-label="Top cities">
        <h2>Top cities</h2>
        <ul>{cities.map((c) => <li key={c.name}><span>{c.name}</span><strong>{c.users} users</strong></li>)}</ul>
        <Link href="/vendor/locations">Locations</Link>
      </section>
      <section className="ins-teaser" aria-label="Planning advice">
        <h2>Planning advice</h2>
        <p><strong>{stock}</strong> Stock up cards of {cards.length}</p>
        <p className="muted">{cards[0]!.headline}</p>
        <Link href="/vendor/planning">Planning</Link>
      </section>
    </div>
  );
}
