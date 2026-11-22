'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatPrice } from '../../lib/money';
import { EventLog } from '../../lib/events';
import { emptyPurchase } from '../../lib/purchase-form';
import { logPurchase, ymd } from '../../lib/purchases';
import type { PurchaseDraft } from '../../lib/purchases';
import type { WishlistEntry } from '../../lib/repository';
import { attempt, messageOf } from '../../lib/supabase/errors';
import { NO_PLAN, emptyPlan, formFromEntry, monthLabel } from '../../lib/wishlist-plan';
import type { PlanDraft } from '../../lib/wishlist-plan';
import { ProductPhoto } from '../ui/ProductPhoto';
import { useRepository } from '../use-repository';
import { PlanForm } from './PlanForm';
import { PlanGroups } from './PlanGroups';
import { PurchaseForm } from './PurchaseForm';
import { usePrices } from './use-prices';

/** The wishlist with "Mark as bought" (FR-35: the purchase form opens for the entry, and one step moves it into the wardrobe with its purchase) and "Plan" (FR-36: a month and a budget, grouped by month with a total per currency). */
export function WishlistView() {
  const repo = useRepository();
  const { currency } = usePrices(repo);
  const [entries, setEntries] = useState<WishlistEntry[] | null>(null);
  const [open, setOpen] = useState<{ id: string; kind: 'buy' | 'plan' } | null>(null);
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
  const plan = (e: WishlistEntry) => async (draft: PlanDraft): Promise<string | null> => {
    let saved: WishlistEntry | undefined;
    const problem = await attempt(async () => { saved = await repo!.wishlist.update(e.id, draft); if (!saved) throw new Error('gone'); });
    if (problem || !saved) return problem ?? messageOf(null);
    setEntries((list) => (list ?? []).map((x) => (x.id === e.id ? saved! : x)));
    setOpen(null);
    setNote(draft.plannedMonth ? `${e.name} is planned for ${monthLabel(draft.plannedMonth)}.` : `The plan for ${e.name} was removed.`);
    return null;
  };
  const entry = (e: WishlistEntry) => {
    const mine = open?.id === e.id ? open.kind : null;
    return (
      <li key={e.id} className="card wish">
        <div className="wish-photo"><ProductPhoto id={e.photoId} name={e.name} /></div>
        <div className="grow">
          <p className="title">{e.name}</p>
          <p className="muted">{e.colourFamily ? `${e.colourFamily} · ` : ''}{e.subType}</p>
          {e.plannedMonth && <p className="muted">Planned for {monthLabel(e.plannedMonth)}{e.budget != null && e.currency ? ` · budget ${formatPrice(e.budget, e.currency)}` : ''}</p>}
          {mine === 'buy' && (
            <PurchaseForm initial={emptyPurchase(ymd(new Date()), currency)} currency={currency} submitLabel="Save purchase" needsColour={!e.colourFamily || e.colourFamily === 'Multi'}
              onSubmit={buy(e)} onCancel={() => setOpen(null)} />
          )}
          {mine === 'plan' && (
            <PlanForm initial={e.plannedMonth ? formFromEntry(e, currency) : emptyPlan(currency)} current={e.plannedMonth ?? null} currency={currency}
              onSubmit={plan(e)} onRemove={e.plannedMonth ? () => plan(e)(NO_PLAN) : undefined} onCancel={() => setOpen(null)} />
          )}
        </div>
        {!mine && (
          <div className="wish-actions">
            <button type="button" onClick={() => setOpen({ id: e.id, kind: 'plan' })} aria-label={`${e.plannedMonth ? 'Edit plan' : 'Plan'}: ${e.name}`}>{e.plannedMonth ? 'Edit plan' : 'Plan'}</button>
            <button type="button" onClick={() => setOpen({ id: e.id, kind: 'buy' })} aria-label={`Mark as bought: ${e.name}`}>Mark as bought</button>
          </div>
        )}
      </li>
    );
  };
  return (
    <div className="wide wishlist">
      <h1>Wishlist</h1>
      <p aria-live="polite" className="muted">{note}</p>
      {error && <p role="alert" className="error">{error}</p>}
      {entries === null && !error && <p className="muted">Loading…</p>}
      {entries?.length === 0 && <p>Your wishlist is empty. <Link href="/outfits">Outfits</Link> suggests what to add next.</p>}
      {entries && entries.length > 0 && <PlanGroups entries={entries} renderEntry={entry} />}
    </div>
  );
}
