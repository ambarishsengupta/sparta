import type { UnlockSuggestion } from '@sparta/rules';
import { unlockKey, unlockLabel } from '../../lib/wishlist';
import styles from './outfits.module.css';

/** Wardrobe unlock (FR-59b): up to three things to add, as attributes only (no photo, price or store), each one tap from the wishlist. */
export function UnlockPanel({ entries, listed, onAdd }: { entries: readonly UnlockSuggestion[]; listed: ReadonlySet<string>; onAdd: (e: UnlockSuggestion) => void }) {
  if (entries.length === 0) return null;
  return (
    <section className={styles.unlock} aria-labelledby="unlock-title">
      <h2 id="unlock-title">Wardrobe unlock</h2>
      <p className="muted">What would give you the most new outfits for this occasion. Worked out in this browser; nothing is sent anywhere.</p>
      <ul className="list">
        {entries.map((e) => {
          const done = listed.has(unlockKey({ subType: e.subType, colourFamily: e.colourFamily }));
          return (
            <li key={`${e.subType}|${e.colourFamily}`} className="card">
              <span className="grow title">{unlockLabel(e)}</span>
              <button type="button" disabled={done} onClick={() => onAdd(e)} aria-label={`${done ? 'On wishlist' : 'Add to wishlist'}: ${e.colourFamily} ${e.subType}`}>
                {done ? 'On wishlist' : 'Add to wishlist'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
