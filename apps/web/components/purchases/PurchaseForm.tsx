'use client';
import { useState } from 'react';
import { CURRENCIES, validatePurchase } from '../../lib/purchase-form';
import type { PurchaseErrors, PurchaseFormValues } from '../../lib/purchase-form';
import { ymd } from '../../lib/purchases';
import type { PurchaseDraft } from '../../lib/purchases';

const fail = (message?: string) => message && <span role="alert" className="error">{message}</span>;

/** The purchase form (FR-30): one piece's price, quantity, date, store and notes. `needsColour` asks for a colour too (a wishlist entry without one). Returns to the caller the sentence of a failed save, which stays on the form. */
export function PurchaseForm({ initial, currency, submitLabel, needsColour = false, onSubmit, onCancel }: {
  initial: PurchaseFormValues; currency: string; submitLabel: string; needsColour?: boolean;
  onSubmit: (draft: PurchaseDraft, colourHex?: string) => Promise<string | null>; onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const [hex, setHex] = useState('#808080');
  const [errors, setErrors] = useState<PurchaseErrors>({});
  const [failure, setFailure] = useState('');
  const set = (patch: Partial<PurchaseFormValues>) => setV({ ...v, ...patch });
  const currencies = [...new Set<string>([currency, v.currency, ...CURRENCIES])];
  const submit = async () => {
    const r = validatePurchase(v, ymd(new Date()));
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    setFailure((await onSubmit(r.draft, needsColour ? hex : undefined)) ?? '');
  };
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      {failure && <p role="alert" className="error">{failure}</p>}
      <label>Price of one piece
        <input type="text" inputMode="decimal" value={v.price} onChange={(e) => set({ price: e.target.value })} aria-invalid={errors.price ? true : undefined} />
        {fail(errors.price)}
      </label>
      <label>Currency
        <select value={v.currency} onChange={(e) => set({ currency: e.target.value })}>{currencies.map((c) => <option key={c}>{c}</option>)}</select>
        {fail(errors.currency)}
      </label>
      <label>Quantity
        <input type="text" inputMode="numeric" value={v.quantity} onChange={(e) => set({ quantity: e.target.value })} aria-invalid={errors.quantity ? true : undefined} />
        {fail(errors.quantity)}
      </label>
      <label>Date
        <input type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} aria-invalid={errors.date ? true : undefined} />
        {fail(errors.date)}
      </label>
      <label>Store
        <input type="text" value={v.store} maxLength={200} onChange={(e) => set({ store: e.target.value })} />
        {fail(errors.store)}
      </label>
      <label>Notes
        <input type="text" value={v.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} />
        {fail(errors.notes)}
      </label>
      {needsColour && <label>Colour of the item<input type="color" value={hex} onChange={(e) => setHex(e.target.value)} /></label>}
      <div className="row">
        <button type="submit" className="primary">{submitLabel}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
