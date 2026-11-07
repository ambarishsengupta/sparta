'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EventLog } from '../../lib/events';
import { emptyPurchase } from '../../lib/purchase-form';
import { logPurchase, ymd } from '../../lib/purchases';
import type { PurchaseDraft } from '../../lib/purchases';
import type { WishlistEntry } from '../../lib/repository';
import { attempt, messageOf } from '../../lib/supabase/errors';
import { useRepository } from '../use-repository';
import { PurchaseForm } from './PurchaseForm';
import { usePrices } from './use-prices';

/** The wishlist with "Mark as bought" (FR-35): the purchase form opens for the entry, and one step moves it into the wardrobe with its purchase. */
export function WishlistView() {
  const repo = useRepository();
  const { currency } = usePrices(repo);
  const [entries, setEntries] = useState<WishlistEntry[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (repo) void repo.wishlist.list().then(setEntries, (e) => setError(messageOf(e, false)));
  }, [repo]);
  const buy = (e: WishlistEntry) => async (draft: PurchaseDraft, colourHex?: string): Promise<string | null> => {
    const problem = await attempt(() => repo!.wishlist.bought(e.id, { purchase: draft, ...(colourHex ? { colourHex } : {}) }));
    if (problem) return problem;
    logPurchase(new EventLog(), 'wishlist');
    setEntries((list) => (list ?? []).filter((x) => x.id !== e.id));
    setOpen(null);
    setNote(`${e.name} is now in your wardrobe, with its purchase.`);
    return null;
  };
  return (
    <>
      <h1>Wishlist</h1>
      <p aria-live="polite" className="muted">{note}</p>
      {error && <p role="alert" className="error">{error}</p>}
      {entries === null && !error && <p className="muted">Loading…</p>}
      {entries?.length === 0 && <p>Your wishlist is empty. <Link href="/outfits">Outfits</Link> suggests what to add next.</p>}
      <ul className="list">
        {(entries ?? []).map((e) => (
          <li key={e.id} className="card line">
            <div className="grow">
              <p className="title">{e.name}</p>
              <p className="muted">{e.colourFamily ? `${e.colourFamily} · ` : ''}{e.subType}</p>
              {open === e.id && (
                <PurchaseForm initial={emptyPurchase(ymd(new Date()), currency)} currency={currency} submitLabel="Save purchase" needsColour={!e.colourFamily || e.colourFamily === 'Multi'}
                  onSubmit={buy(e)} onCancel={() => setOpen(null)} />
              )}
            </div>
            {open !== e.id && <button type="button" onClick={() => setOpen(e.id)} aria-label={`Mark as bought: ${e.name}`}>Mark as bought</button>}
          </li>
        ))}
      </ul>
    </>
  );
}
