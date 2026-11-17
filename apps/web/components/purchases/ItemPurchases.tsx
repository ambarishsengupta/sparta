'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EventLog } from '../../lib/events';
import { formatPrice } from '../../lib/money';
import { emptyPurchase, formFromPurchase } from '../../lib/purchase-form';
import { lineTotal, logPurchase, ymd } from '../../lib/purchases';
import type { Purchase, PurchaseDraft } from '../../lib/purchases';
import { attempt, messageOf } from '../../lib/supabase/errors';
import { ConfirmStep } from '../ui/ConfirmStep';
import { useRepository } from '../use-repository';
import { Price } from './Price';
import { PurchaseForm } from './PurchaseForm';
import { usePrices } from './use-prices';

/** The purchases of one item, on its page (FR-30): add, edit and delete, also for an archived item. Nothing shows for an item that is not there. */
export function ItemPurchases({ itemId }: { itemId: string }) {
  const repo = useRepository();
  const { currency, rates } = usePrices(repo);
  const [found, setFound] = useState(false);
  const [rows, setRows] = useState<Purchase[]>([]);
  const [open, setOpen] = useState<string | null>(null); // 'new' or the id being edited
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null); // where focus goes when the purchase it was on is deleted
  const [deleting, setDeleting] = useState<string | null>(null); // the purchase whose delete awaits the second press
  const refresh = useCallback(async () => {
    if (!repo) return;
    try { setRows(await repo.purchases.forItem(itemId)); } catch (e) { setError(messageOf(e, false)); }
  }, [repo, itemId]);
  useEffect(() => {
    if (!repo) return;
    void repo.items.get(itemId).then((i) => { setFound(!!i); if (i) void refresh(); }, (e) => setError(messageOf(e, false)));
  }, [repo, itemId, refresh]);

  if (!found && !error) return null;
  const save = (id: string | 'new') => async (draft: PurchaseDraft): Promise<string | null> => {
    const problem = await attempt(async () => {
      if (id === 'new') { await repo!.purchases.create({ ...draft, itemId }); logPurchase(new EventLog(), 'manual'); } else await repo!.purchases.update(id, draft);
    });
    if (problem) return problem;
    setOpen(null);
    await refresh();
    return null;
  };
  const remove = async (id: string) => {
    setDeleting(null);
    setError((await attempt(() => repo!.purchases.remove(id))) ?? '');
    await refresh();
    heading.current?.focus();
  };
  return (
    <section className="panel" aria-labelledby="purchases-title">
      <h2 id="purchases-title" ref={heading} tabIndex={-1}>Purchases</h2>
      {error && <p role="alert" className="error">{error}</p>}
      {rows.length === 0 && !error && <p className="muted">No purchase recorded for this item.</p>}
      <ul className="list">
        {rows.map((p) => (
          <li key={p.id} className="card line">
            <div className="grow">
              <p className="title">{p.date}{p.store ? ` · ${p.store}` : ''}</p>
              <p className="muted">{p.quantity} × {formatPrice(p.price, p.currency)}{p.notes ? ` · ${p.notes}` : ''}</p>
              {deleting === p.id && <ConfirmStep label={`Confirm deleting the purchase of ${p.date}`} question="Delete this purchase?" confirmLabel="Delete purchase" onConfirm={() => void remove(p.id)} onCancel={() => setDeleting(null)} />}
              {open === p.id && <PurchaseForm initial={formFromPurchase(p)} currency={currency} submitLabel="Save purchase" onSubmit={save(p.id)} onCancel={() => setOpen(null)} />}
            </div>
            <Price amount={lineTotal(p)} currency={p.currency} profile={currency} rates={rates} />
            {open !== p.id && (
              <div className="row">
                <button type="button" onClick={() => setOpen(p.id)} aria-label={`Edit the purchase of ${p.date}`}>Edit</button>
                <button type="button" className="danger" onClick={() => setDeleting(p.id)} aria-label={`Delete the purchase of ${p.date}`}>Delete</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {open === 'new'
        ? <PurchaseForm initial={emptyPurchase(ymd(new Date()), currency)} currency={currency} submitLabel="Save purchase" onSubmit={save('new')} onCancel={() => setOpen(null)} />
        : <button type="button" disabled={!repo} onClick={() => setOpen('new')}>Add a purchase</button>}
    </section>
  );
}
