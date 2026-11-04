'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EventLog, createItemLogged } from '../../lib/events';
import type { StoredItem } from '../../lib/repository';
import { FITS, MATERIALS, OCCASIONS, PATTERNS, SEASONS, conditionBandOf } from '@sparta/taxonomy';
import { categoryChoices, emptyForm, familyOfHex, formFromItem, subTypeChoices, updateForm, validateForm } from '../../lib/item-form';
import type { FormErrors, ItemFormValues } from '../../lib/item-form';
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

export function ItemForm({ itemId }: { itemId?: string }) {
  const repo = useRepository();
  const router = useRouter();
  const [values, setValues] = useState<ItemFormValues>(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [missing, setMissing] = useState(false);
  const [existing, setExisting] = useState<StoredItem>();
  const change = (patch: Partial<ItemFormValues>) => setValues((v) => updateForm(v, patch));

  useEffect(() => {
    if (!repo || !itemId) return;
    void repo.items.get(itemId).then((item) => (item ? (setExisting(item), setValues(formFromItem(item))) : setMissing(true)));
  }, [repo, itemId]);

  const save = async () => {
    const result = validateForm(values);
    if (!result.ok) return setErrors(result.errors);
    if (itemId && existing) await repo!.items.update(itemId, { ...result.input, status: existing.status, archiveReason: existing.archiveReason });
    else if (!itemId) await createItemLogged(repo!, new EventLog(), result.input, 'manual');
    router.push('/');
  };
  const remove = async () => {
    if (itemId && window.confirm('Delete this item permanently?')) { await repo!.items.remove(itemId); router.push('/'); }
  };

  if (missing) return <p role="alert">That item was not found.</p>;
  const family = familyOfHex(values.hex);
  const band = values.condition === null ? null : conditionBandOf(values.condition);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <h1>{itemId ? 'Edit item' : 'Add item'}</h1>
      <Choice label="Category" value={values.category} options={categoryChoices()} error={errors.category}
        onChange={(v) => change({ category: v as ItemFormValues['category'] })} />
      <Choice label="Sub-type" value={values.subType} options={subTypeChoices(values.category)} error={errors.subType}
        onChange={(v) => change({ subType: v as ItemFormValues['subType'] })} />
      <label>Colour
        <input type="color" value={values.hex} onChange={(e) => change({ hex: e.target.value })} />
      </label>
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
      <div className="row">
        <button type="submit" className="primary" disabled={!repo}>Save item</button>
        <button type="button" onClick={() => router.push('/')}>Cancel</button>
        {itemId && <button type="button" className="danger" onClick={() => void remove()}>Delete item</button>}
      </div>
    </form>
  );
}
