import type { Slot } from '@sparta/rules';
import { SLOT_LABEL, chipsOf, matchPercent } from '../../lib/suggestions-view-model';
import type { Card } from '../../lib/suggestions-view-model';
import type { StoredItem } from '../../lib/repository';
import styles from './outfits.module.css';

export interface CardProps {
  card: Card;
  index: number;
  items: ReadonlyMap<string, StoredItem>;
  onAccept: () => void;
  onReject: () => void;
  onSwap: (slot: Slot) => void;
}

export function OutfitCard({ card, index, items, onAccept, onReject, onSwap }: CardProps) {
  const n = index + 1;
  const percent = matchPercent(card);
  return (
    <>
      <h2 className={styles.heading}>Outfit {n}{card.saved ? ' (saved)' : ''}</h2>
      <ul className={styles.chips} aria-label={`Pieces in outfit ${n}`}>
        {chipsOf(card).map(({ itemId, slots }) => {
          const item = items.get(itemId);
          return (
            <li key={itemId} className={styles.chip}>
              <span className={styles.dot} style={{ background: item?.hex ?? 'transparent' }} aria-hidden="true" />
              <span className="grow">
                <span className="title">{item?.name ?? 'Removed item'}</span>
                <span className="muted"> {slots.map((s) => SLOT_LABEL[s]).join(' and ')}</span>
              </span>
              {!card.saved && (
                <button type="button" onClick={() => onSwap(slots[0]!)} aria-label={`Swap ${item?.name ?? 'item'}`}>Swap</button>
              )}
            </li>
          );
        })}
      </ul>
      <ul className={styles.reasons} aria-label={`Why outfit ${n}`}>
        {card.reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
      {percent === null ? (
        <p className="muted">Swapped by you, so it is not scored again.</p>
      ) : (
        <div className={styles.match}>
          <span>{percent}% match</span>
          <div className={styles.meter} role="meter" aria-label={`Match for outfit ${n}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}
      <div className="row">
        <button type="button" className="primary" disabled={card.saved} onClick={onAccept} aria-label={`Accept outfit ${n}`}>
          {card.saved ? 'Saved' : 'Accept'}
        </button>
        <button type="button" disabled={card.saved} onClick={onReject} aria-label={`Reject outfit ${n}`}>Reject</button>
      </div>
    </>
  );
}
