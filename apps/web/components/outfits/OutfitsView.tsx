'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Occasion } from '@sparta/taxonomy';
import type { Ctx, Hemisphere, Slot, UnlockSuggestion } from '@sparta/rules';
import { DEMO_WARDROBE_NAMES, loadDemoWardrobe } from '../../lib/demo';
import { engineOpts } from '../../lib/engine-config';
import { EventLog } from '../../lib/events';
import { browserStorage } from '../../lib/local-repository';
import type { StoredItem } from '../../lib/repository';
import {
  OCCASIONS, anchorIntro, applySwap, buildCtx, eventDetails, loadHemisphere, markSaved, reject, saveHemisphere, sameAs, seasonOf, startView, swapOptions, thinMessage, toOutfitInput,
} from '../../lib/suggestions-view-model';
import type { Card, View } from '../../lib/suggestions-view-model';
import { addUnlockToWishlist, unlockFor, unlockKey } from '../../lib/wishlist';
import { useLearned } from '../use-learned';
import { useRepository } from '../use-repository';
import { OutfitCard } from './OutfitCard';
import { SwapSheet } from './SwapSheet';
import { UnlockPanel } from './UnlockPanel';
import styles from './outfits.module.css';

const DEMO = DEMO_WARDROBE_NAMES.includes('Office regular') ? 'Office regular' : (DEMO_WARDROBE_NAMES[0] ?? '');

export function OutfitsView() {
  const repo = useRepository();
  const { learned, ready } = useLearned(); // the prior and the H&M list load in the background; suggestions use whatever has loaded
  const engine = engineOpts(undefined, learned);
  const [anchor, setAnchor] = useState<string | null>(null); // Complete the look: /outfits?anchor=<id> (FR-59a)
  const [wished, setWished] = useState<ReadonlySet<string>>(new Set());
  const [items, setItems] = useState<StoredItem[] | null>(null);
  const [occasion, setOccasion] = useState<Occasion | null>(null);
  const [hemisphere, setHemisphere] = useState<Hemisphere>('north');
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [swap, setSwap] = useState<{ key: string; slot: Slot } | null>(null);
  const [note, setNote] = useState('');
  const [today, setToday] = useState<Date | null>(null); // read in the browser only, so the server page never bakes in a season
  const opener = useRef<string | null>(null); // `key:slot` of the Swap button that opened the sheet, so focus can return to it
  const log = useRef<EventLog | null>(null);
  const events = () => (log.current ??= new EventLog());
  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);

  useEffect(() => {
    setHemisphere(loadHemisphere(browserStorage()));
    setToday(new Date());
    setAnchor(new URLSearchParams(window.location.search).get('anchor'));
  }, []);
  useEffect(() => {
    if (!repo) return;
    void repo.items.list().then(setItems);
    void repo.wishlist.list().then((w) => setWished(new Set(w.filter((e) => e.origin === 'unlock').map(unlockKey))));
  }, [repo]);
  useEffect(() => { // after Cancel, Escape or a pick, focus goes back to the Swap button that opened the sheet (or its replacement)
    if (swap === null && opener.current) {
      document.querySelector<HTMLElement>(`[data-swap="${opener.current}"]`)?.focus();
      opener.current = null;
    }
  }, [swap, view]);

  const ask = (o: Occasion | null, h: Hemisphere, list: StoredItem[] | null = items, a: string | null = anchor) => {
    setSwap(null);
    opener.current = null;
    setNote('');
    if (!o || !list) { setCtx(null); setView(null); return; }
    const next = buildCtx(o, h);
    setCtx(next);
    setView(startView(list, next, { ...engine.suggest, ...(a ? { anchor: a } : {}) }));
  };
  const pick = (o: Occasion) => { setOccasion(o); ask(o, hemisphere); };
  const toggleHemisphere = (south: boolean) => {
    const h: Hemisphere = south ? 'south' : 'north';
    setHemisphere(h);
    saveHemisphere(browserStorage(), h);
    ask(occasion, h);
  };
  const details = (card?: Card, slot?: Slot) => eventDetails(ctx!, card, slot);
  const leaveAnchor = () => { setAnchor(null); window.history.replaceState(null, '', '/outfits'); ask(occasion, hemisphere, items, null); };
  const unlockList = useMemo(() => (ctx && items ? unlockFor(items, ctx, undefined, learned) : []), [ctx, items, learned]);
  const addUnlock = async (e: UnlockSuggestion) => {
    const { added } = await addUnlockToWishlist(repo!, events(), e, ctx!);
    setWished((w) => new Set(w).add(unlockKey({ subType: e.subType, colourFamily: e.colourFamily })));
    setNote(`${e.colourFamily} ${e.subType} ${added ? 'added to' : 'is already on'} your wishlist.`);
  };
  const anchorName = anchor ? byId.get(anchor)?.name : undefined;

  const accept = async (card: Card, n: number) => {
    await repo!.outfits.create(toOutfitInput(card, ctx!.occasion));
    events().record('suggestion_accepted', details(card));
    setView((v) => markSaved(v!, card.key));
    document.getElementById(`outfit-title-${n}`)?.focus(); // Accept is about to become disabled: keep keyboard focus on the card
    setNote(`Outfit ${n} saved.`);
  };
  const dismiss = (card: Card, n: number) => {
    events().record('suggestion_rejected', details(card));
    setView((v) => reject(v!, card.key));
    setSwap(null);
    setNote(`Outfit ${n} removed.`);
  };
  const pickSwap = (card: Card, slot: Slot, id: string) => {
    const result = applySwap(view!, card.key, slot, id, items!, ctx!);
    if (result.ok) {
      const after = result.view.kind === 'cards' ? result.view.cards.find((c) => c.key === card.key) : undefined;
      events().record('suggestion_swapped', details(after, slot)); // the card as it is now (R1 and R2), not its pre-swap rule ids
      setView(result.view);
      setNote(`Swapped the ${slot}. The outfit still follows the rules.`);
    } else {
      setNote('That swap would break the rules, so nothing changed.');
    }
    setSwap(null);
  };
  const loadDemo = async () => {
    const n = await loadDemoWardrobe(repo!, DEMO, events());
    const list = await repo!.items.list();
    setItems(list);
    ask(occasion, hemisphere, list);
    setNote(`Added ${n} items from the ${DEMO} demo wardrobe.`);
  };

  const noActive = items !== null && !items.some((i) => i.status === 'active');
  return (
    <>
      <h1>Outfits</h1>
      <p className="muted">Everything is worked out in this browser. Nothing is sent anywhere.</p>
      <fieldset className={styles.picker}>
        <legend>Occasion</legend>
        {OCCASIONS.map((o) => (
          <button key={o} type="button" aria-pressed={occasion === o} disabled={items === null || !ready} onClick={() => pick(o)}>{o}</button>
        ))}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={hemisphere === 'south'} onChange={(e) => toggleHemisphere(e.target.checked)} />
        Southern hemisphere
      </label>
      <p className="muted">{today ? `Season now: ${seasonOf(buildCtx('Casual', hemisphere, today))} (${hemisphere}ern hemisphere)` : ''}</p>
      <p aria-live="polite" className="muted">{note}</p>

      {anchor && (
        <section className={styles.anchor} aria-labelledby="anchor-title">
          <h2 id="anchor-title">Complete the look{anchorName ? ` around ${anchorName}` : ''}</h2>
          {anchorIntro(view, occasion) && <p className="muted">{anchorIntro(view, occasion)}</p>}
          <div className="row"><button type="button" onClick={leaveAnchor}>Back to normal suggestions</button></div>
        </section>
      )}
      {items === null && <p className="muted">Loading…</p>}
      {noActive && (
        <div className={styles.notice}>
          <p>You have no active items yet. Load a demo wardrobe to try suggestions, or add your own.</p>
          <div className="row">
            <button type="button" className="primary" disabled={!repo} onClick={() => void loadDemo()}>Load demo wardrobe</button>
            <Link href="/items/new" className="button">Add an item</Link>
          </div>
        </div>
      )}
      {!noActive && items !== null && !view && !anchor && <p>Pick an occasion to see outfits from your wardrobe.</p>}
      {view?.kind === 'anchor_invalid' && <div className={styles.notice} role="status"><p><strong>{view.message}.</strong></p></div>}
      {view?.kind === 'cards' && view.thin && view.cards.length > 0 && <p className="muted">{thinMessage(view.cards.length, byId.get(view.anchor ?? '')?.name ?? 'this item', ctx!)}</p>}
      {view?.kind === 'missing' && (
        <div className={styles.notice} role="status">
          <p><strong>{view.message}.</strong></p>
          <Link href="/">Go to your wardrobe to add items</Link>
        </div>
      )}
      {view?.kind === 'cards' && view.cards.length === 0 && (
        <div className={styles.notice}>
          <p>That is all the outfits for now.</p>
          <button type="button" onClick={() => ask(occasion, hemisphere)}>Show outfits again</button>
        </div>
      )}
      {view?.kind === 'cards' && (
        <ul className="list">
          {view.cards.map((card, i) => (
            <li key={card.key} className={`card ${styles.outfit}`}>
              <OutfitCard card={card} index={i} items={byId}
                onAccept={() => void accept(card, i + 1)} onReject={() => dismiss(card, i + 1)}
                sameAs={sameAs(view.cards, card)} anchorId={view.anchor}
                onSwap={(slot) => { opener.current = `${card.key}:${slot}`; setSwap({ key: card.key, slot }); }} />
              {swap?.key === card.key && (
                <SwapSheet slot={swap.slot} items={byId} choices={swapOptions(card, swap.slot, items!, ctx!, view.anchor)}
                  onPick={(id) => pickSwap(card, swap.slot, id)} onClose={() => setSwap(null)} />
              )}
            </li>
          ))}
        </ul>
      )}
      {ctx && view?.kind !== 'empty' && <UnlockPanel entries={unlockList} listed={wished} onAdd={(e) => void addUnlock(e)} />}
    </>
  );
}
