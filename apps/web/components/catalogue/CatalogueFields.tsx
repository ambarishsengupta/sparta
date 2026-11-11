'use client';
import { CURRENCIES } from '../../lib/purchase-form';
import type { PurchaseErrors } from '../../lib/purchase-form';
import { formatPrice } from '../../lib/money';
import type { CatalogueItem, PaidValues } from '../../lib/catalogue';
import { CategoryIllustration } from '../ui/illustrations';
import { SourceLink } from './SourceLink';

const fail = (message?: string) => message && <span role="alert" className="error">{message}</span>;

/** The top of the form from the picker (FR-21, FR-24): the item's drawing in its stored colour, where it is from, and the source link. */
export function CatalogueIntro({ item }: { item: CatalogueItem }) {
  return (
    <>
      <div className="art"><div className="swatch"><CategoryIllustration category={item.category} hex={item.hex} label={`${item.subType} illustration`} /></div></div>
      <p className="muted">From the catalogue{item.brand ? `: ${item.brand}` : ''}{item.price !== null && item.currency ? `, listed at ${formatPrice(item.price, item.currency)}` : ''}. <SourceLink url={item.productUrl} /></p>
    </>
  );
}

/** The end of the form: a size, and the optional price paid, date and store (a purchase when typed). */
export function CatalogueDetails({ item, size, onSize, paid, onPaid, errors }: {
  item: CatalogueItem; size: string; onSize: (s: string) => void; paid: PaidValues; onPaid: (p: PaidValues) => void; errors: PurchaseErrors;
}) {
  const set = (patch: Partial<PaidValues>) => onPaid({ ...paid, ...patch });
  const currencies = [...new Set<string>([paid.currency, ...CURRENCIES])];
  return (
    <>
      {item.sizes.length > 0 ? (
        <label>Size
          <select value={size} onChange={(e) => onSize(e.target.value)}>
            <option value="">Not set</option>
            {item.sizes.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      ) : null}
      <fieldset>
        <legend>Price paid (optional)</legend>
        <p className="muted">Fill in the price and the date to record a purchase.</p>
        <label>Price of one piece
          <input type="text" inputMode="decimal" value={paid.price} onChange={(e) => set({ price: e.target.value })} aria-invalid={errors.price ? true : undefined} />
          {fail(errors.price)}
        </label>
        <label>Currency
          <select value={paid.currency} onChange={(e) => set({ currency: e.target.value })}>{currencies.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label>Date
          <input type="date" value={paid.date} onChange={(e) => set({ date: e.target.value })} aria-invalid={errors.date ? true : undefined} />
          {fail(errors.date)}
        </label>
        <label>Store
          <input type="text" value={paid.store} maxLength={200} onChange={(e) => set({ store: e.target.value })} />
          {fail(errors.store)}
        </label>
      </fieldset>
    </>
  );
}
