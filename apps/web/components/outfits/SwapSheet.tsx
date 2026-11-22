import { useEffect, useRef } from 'react';
import type { Slot } from '@sparta/rules';
import { SLOT_LABEL } from '../../lib/suggestions-view-model';
import type { StoredItem } from '../../lib/repository';
import { ProductPhoto } from '../ui/ProductPhoto';
import styles from './outfits.module.css';

/** The choices for one slot, most similar first (FR-53). It sits under the card; focus moves to it on open and Escape closes it. */
export function SwapSheet({ slot, choices, items, onPick, onClose }: {
  slot: Slot;
  choices: readonly string[];
  items: ReadonlyMap<string, StoredItem>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section className={styles.sheet} aria-labelledby="swap-title" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <h3 id="swap-title" tabIndex={-1} ref={heading}>Swap {SLOT_LABEL[slot].toLowerCase()}</h3>
      {choices.length === 0 ? (
        <p className="muted">No other item fits here and keeps the outfit valid.</p>
      ) : (
        <ul className={styles.choices}>
          {choices.map((id) => {
            const item = items.get(id);
            return (
              <li key={id}>
                <button type="button" className={styles.choice} onClick={() => onPick(id)} aria-label={`Use ${item?.name ?? id}`}>
                  <span className="thumb"><ProductPhoto id={item?.photoId} name={item?.name ?? id} /></span>
                  <span>{item?.name ?? id}<span className="muted"> {item?.subType}</span></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" onClick={onClose}>Cancel</button>
    </section>
  );
}
