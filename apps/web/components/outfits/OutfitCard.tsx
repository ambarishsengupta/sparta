import type { Slot } from '@sparta/rules';
import { SLOT_LABEL, chipsOf, matchPercent, reasonSummary } from '../../lib/suggestions-view-model';
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
  /** Set when a swapped card now holds the same pieces as outfit N. */
  sameAs?: number | null;
  /** Complete the look: the item that stays where it is, so it gets no Swap button. */
  anchorId?: string;
}

export function OutfitCard({ card, index, items, onAccept, onReject, onSwap, sameAs = null, anchorId }: CardProps) {
  const n = index + 1;
  const percent = matchPercent(card);
  const { line, rest } = reasonSummary(card);
  return (
    <>
      <h2 id={`outfit-title-${n}`} tabIndex={-1} className={styles.heading}>Outfit {n}{card.saved ? ' (saved)' : ''}</h2>
      <ul className={styles.chips} aria-label={`Pieces in outfit ${n}`}>
        {chipsOf(card).map(({ itemId, slots }) => {
          const item = items.get(itemId);
          return (
            <li key={itemId} className={styles.chip}>
              <span className={styles.dot} style={{ background: item?.hex ?? 'transparent' }} aria-hidden="true" />
              <span className="grow">
                <span className="title">{item?.name ?? 'Removed item'}</span>
                <span className="muted"> {slots.map((s) => SLOT_LABEL[s]).join(' and ')}{itemId === anchorId ? ' · your pick' : ''}</span>
              </span>
              {!card.saved && itemId !== anchorId && (
                <button type="button" data-swap={`${card.key}:${slots[0]}`} onClick={() => onSwap(slots[0]!)} aria-label={`Swap ${item?.name ?? 'item'}`}>Swap</button>
              )}
            </li>
          );
        })}
      </ul>
      <p className={styles.line}>{line}</p>
      {rest.length > 0 && (
        <details>
          <summary>Why this outfit?</summary>
          <ul className={styles.reasons} aria-label={`More reasons for outfit ${n}`}>
            {rest.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </details>
      )}
      {sameAs !== null && <p className="muted">Same as outfit {sameAs}</p>}
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
