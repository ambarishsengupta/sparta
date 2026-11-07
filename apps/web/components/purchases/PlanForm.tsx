'use client';
import { useState } from 'react';
import { CURRENCIES } from '../../lib/purchase-form';
import { monthOf, validatePlan } from '../../lib/wishlist-plan';
import type { PlanDraft, PlanErrors, PlanFormValues } from '../../lib/wishlist-plan';

const fail = (message?: string) => message && <span role="alert" className="error">{message}</span>;

/**
 * The plan form of a wishlist entry (FR-36): the month and a budget with its currency. Returns to the caller the sentence of a failed save,
 * which stays on the form. `current` is the month the entry is already planned for (it stays valid even when it is now in the past).
 */
export function PlanForm({ initial, current, currency, onSubmit, onRemove, onCancel }: {
  initial: PlanFormValues; current: string | null; currency: string;
  onSubmit: (draft: PlanDraft) => Promise<string | null>; onRemove?: () => Promise<string | null>; onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<PlanErrors>({});
  const [failure, setFailure] = useState('');
  const set = (patch: Partial<PlanFormValues>) => setV({ ...v, ...patch });
  const now = monthOf(new Date());
  const currencies = [...new Set<string>([currency, v.currency, ...CURRENCIES])];
  const submit = async () => {
    const r = validatePlan(v, now, current);
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    setFailure((await onSubmit(r.draft)) ?? '');
  };
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      {failure && <p role="alert" className="error">{failure}</p>}
      <label>Planned month
        <input type="month" value={v.month} min={!current || current >= now ? now : undefined} placeholder="YYYY-MM" onChange={(e) => set({ month: e.target.value })} aria-invalid={errors.month ? true : undefined} />
        {fail(errors.month)}
      </label>
      <label>Budget (optional)
        <input type="text" inputMode="decimal" value={v.budget} onChange={(e) => set({ budget: e.target.value })} aria-invalid={errors.budget ? true : undefined} />
        {fail(errors.budget)}
      </label>
      <label>Currency
        <select value={v.currency} onChange={(e) => set({ currency: e.target.value })}>{currencies.map((c) => <option key={c}>{c}</option>)}</select>
        {fail(errors.currency)}
      </label>
      <div className="row">
        <button type="submit" className="primary">Save plan</button>
        {onRemove && <button type="button" onClick={() => void onRemove().then((p) => setFailure(p ?? ''))}>Remove plan</button>}
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
