'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EventLog, createItemLogged } from '../../lib/events';
import { attachmentOf, checkPaid, emptyPaid, formFromCatalogue } from '../../lib/catalogue';
import type { CatalogueItem, PaidValues } from '../../lib/catalogue';
import type { PurchaseErrors } from '../../lib/purchase-form';
import { logPurchase, ymd } from '../../lib/purchases';
import { SUGGESTED_LABEL } from '../../lib/photo-flow';
import type { PhotoAttachment, StoredItem } from '../../lib/repository';
import { canDeleteItems } from '../../lib/supabase/config';
import { attempt, messageOf } from '../../lib/supabase/errors';
import { FITS, MATERIALS, OCCASIONS, PATTERNS, SEASONS, conditionBandOf } from '@sparta/taxonomy';
import { categoryChoices, emptyForm, familyOfHex, formFromItem, subTypeChoices, updateForm, validateForm } from '../../lib/item-form';
import type { FormErrors, ItemFormValues } from '../../lib/item-form';
import { CatalogueDetails, CatalogueIntro } from '../catalogue/CatalogueFields';
import { CategoryIllustration } from '../ui/illustrations';
import { useRepository } from '../use-repository';

function Choice({ label, value, options, onChange, error }: {
  label: string; value: string; options: readonly string[]; onChange: (v: string) => void; error?: string | undefined;
}) {
  return (
    <label>{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined}>
        <option value="">Not set</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
      {error && <span role="alert" className="error">{error}</span>}
    </label>
  );
}

function Multi<T extends string>({ legend, options, value, onChange }: {
  legend: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o} className="check">
          <input type="checkbox" checked={value.includes(o)}
            onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((v) => v !== o))} />{o}
        </label>
      ))}
    </fieldset>
  );
}

/** From add-by-photo (WO-0073): the values the photo filled in, which of them are suggestions, and the picture to store with the item. */
export interface PhotoStart { values: ItemFormValues; garmentSuggested: boolean; colourSuggested: boolean; photo: PhotoAttachment }

/** From the catalogue picker (WO-0085): the chosen item and where Cancel goes (back to the picker). */
export interface CatalogueStart { item: CatalogueItem; onCancel: () => void }

/** `barcode`: a padded GTIN (14 digits) the person looked up; it is saved with the item (FR-26). */
export function ItemForm({ itemId, photoStart, catalogueStart, barcode }: { itemId?: string; photoStart?: PhotoStart; catalogueStart?: CatalogueStart; barcode?: string }) {
  const repo = useRepository();
  const router = useRouter();
  const [values, setValues] = useState<ItemFormValues>(photoStart?.values ?? (catalogueStart ? formFromCatalogue(catalogueStart.item) : emptyForm()));
  const [size, setSize] = useState('');
  const [paid, setPaid] = useState<PaidValues>(emptyPaid(catalogueStart?.item.currency ?? 'USD'));
  const [paidErrors, setPaidErrors] = useState<PurchaseErrors>({});
  const [made, setMade] = useState<string | null>(null); // the item a catalogue save already made, so a retry after a failed purchase never adds it twice
  const [errors, setErrors] = useState<FormErrors>({});
  const [missing, setMissing] = useState(false);
  const [existing, setExisting] = useState<StoredItem>();
  const [failure, setFailure] = useState(''); // the form keeps what was typed when a save fails
  const change = (patch: Partial<ItemFormValues>) => setValues((v) => updateForm(v, patch));

  useEffect(() => {
    if (!repo || !itemId) return;
    void repo.items.get(itemId).then((item) => (item ? (setExisting(item), setValues(formFromItem(item))) : setMissing(true)), (e) => setFailure(messageOf(e, false)));
  }, [repo, itemId]);

  const save = async () => {
    const result = validateForm(values);
    const bought = catalogueStart ? checkPaid(paid, ymd(new Date())) : null;
    setPaidErrors(bought && !bought.ok ? bought.errors : {});
    if (!result.ok) return setErrors(result.errors);
    if (bought && !bought.ok) return setErrors({});
    const problem = await attempt(async () => {
      if (catalogueStart) {
        const log = new EventLog();
        const id = made ?? (await createItemLogged(repo!, log, { ...result.input, catalogue: attachmentOf(catalogueStart.item, size), barcode }, 'catalogue')).id;
        setMade(id);
        if (bought?.ok && bought.draft) { await repo!.purchases.create({ ...bought.draft, itemId: id }); logPurchase(log, 'catalogue'); setMade(null); }
      } else if (itemId && existing) await repo!.items.update(itemId, { ...result.input, status: existing.status, archiveReason: existing.archiveReason });
      else if (!itemId) await (photoStart ? createItemLogged(repo!, new EventLog(), { ...result.input, photo: photoStart.photo }, 'photo') : createItemLogged(repo!, new EventLog(), { ...result.input, barcode }, 'manual'));
    });
    if (problem) return setFailure(problem); // stay on the form: nothing typed is lost
    router.push('/');
  };
  const remove = async () => {
    if (!itemId || !window.confirm('Delete this item permanently?')) return;
    const problem = await attempt(() => repo!.items.remove(itemId));
    if (problem) return setFailure(problem);
    router.push('/');
  };

  if (missing) return <p role="alert">That item was not found.</p>;
  // A suggestion is labelled only while the value is still the suggested one: once the person changes it, it is theirs.
  const start = photoStart?.values;
  const garmentLabel = !!photoStart?.garmentSuggested && values.category === start?.category && values.subType === start?.subType;
  const colourLabel = !!photoStart?.colourSuggested && values.hex === start?.hex;
  const family = familyOfHex(values.hex);
  const band = values.condition === null ? null : conditionBandOf(values.condition);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <h1>{itemId ? 'Edit item' : 'Add item'}</h1>
      {barcode && !itemId && <p className="muted" data-barcode={barcode}>Barcode {barcode} will be saved with this item.</p>}
      {existing && <div className="art"><div className="swatch"><CategoryIllustration category={existing.category} hex={existing.hex} label={`${existing.subType} illustration`} /></div></div>}
      {catalogueStart && <CatalogueIntro item={catalogueStart.item} />}
      {failure && <p role="alert" className="error">{failure}</p>}
      {garmentLabel && <p className="muted" data-suggestion="garment">{SUGGESTED_LABEL}: category and sub-type. Change them if they are not right.</p>}
      <Choice label="Category" value={values.category} options={categoryChoices()} error={errors.category}
        onChange={(v) => change({ category: v as ItemFormValues['category'] })} />
      <Choice label="Sub-type" value={values.subType} options={subTypeChoices(values.category)} error={errors.subType}
        onChange={(v) => change({ subType: v as ItemFormValues['subType'] })} />
      <label>Colour
        <input type="color" value={values.hex} onChange={(e) => change({ hex: e.target.value })} />
      </label>
      {colourLabel && <p className="muted" data-suggestion="colour">{SUGGESTED_LABEL}: colour.</p>}
      <p aria-live="polite">Colour family: <strong>{family ?? 'unknown'}</strong></p>
      {errors.hex && <span role="alert" className="error">{errors.hex}</span>}
      <label>Name
        <input type="text" value={values.name} maxLength={120} onChange={(e) => change({ name: e.target.value })} aria-invalid={errors.name ? true : undefined} />
        {errors.name && <span role="alert" className="error">{errors.name}</span>}
      </label>
      <Choice label="Fit" value={values.fit} options={FITS} onChange={(v) => change({ fit: v as ItemFormValues['fit'] })} />
      <Choice label="Material" value={values.material} options={MATERIALS} onChange={(v) => change({ material: v as ItemFormValues['material'] })} />
      <Choice label="Pattern" value={values.pattern} options={PATTERNS} onChange={(v) => change({ pattern: v as ItemFormValues['pattern'] })} />
      <Multi legend="Seasons" options={SEASONS} value={values.seasons} onChange={(seasons) => change({ seasons })} />
      <Multi legend="Occasions" options={OCCASIONS} value={values.occasions} onChange={(occasions) => change({ occasions })} />
      <label className="check">
        <input type="checkbox" checked={values.condition !== null} onChange={(e) => change({ condition: e.target.checked ? 30 : null })} />
        Rate condition
      </label>
      {values.condition !== null && (
        <label>Condition, 0 brand new to 100 falling apart
          <input type="range" min={0} max={100} step={1} value={values.condition} onChange={(e) => change({ condition: Number(e.target.value) })} />
          <output aria-live="polite">{values.condition}: {band}</output>
        </label>
      )}
      <label className="check"><input type="checkbox" checked={values.favourite} onChange={(e) => change({ favourite: e.target.checked })} />Favourite</label>
      <label className="check"><input type="checkbox" checked={values.neverWorn} onChange={(e) => change({ neverWorn: e.target.checked })} />Never worn</label>
      {catalogueStart && <CatalogueDetails item={catalogueStart.item} size={size} onSize={setSize} paid={paid} onPaid={setPaid} errors={paidErrors} />}
      <div className="row">
        <button type="submit" className="primary" disabled={!repo}>Save item</button>
        <button type="button" onClick={() => (catalogueStart ? catalogueStart.onCancel() : router.push('/'))}>Cancel</button>
        {itemId && canDeleteItems() && <button type="button" className="danger" onClick={() => void remove()}>Delete item</button>}
      </div>
    </form>
  );
}
