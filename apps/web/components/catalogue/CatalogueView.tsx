'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CATEGORIES, COLOUR_FAMILIES } from '@sparta/taxonomy';
import { NO_CATALOGUE_FILTER, STYLES, hmPhotoId, styleLabel } from '../../lib/catalogue';
import type { CatalogueCursor, CatalogueFilter, CatalogueItem } from '../../lib/catalogue';
import { formatPrice } from '../../lib/money';
import { HM_ARTICLES } from '../../lib/demo-hm';
import { dataBackend } from '../../lib/supabase/config';
import { messageOf } from '../../lib/supabase/errors';
import { addOwnWithBarcode, noMatch, severalMatches } from '../../lib/barcode-lookup';
import type { BarcodeResult } from '../../lib/barcode-lookup';
import { ItemForm } from '../wardrobe/ItemForm';
import { ProductPhoto } from '../ui/ProductPhoto';
import { useRepository } from '../use-repository';
import { BarcodeLookup } from './BarcodeLookup';
import { catalogueCaption } from './caption';
import { SourceLink } from './SourceLink';

export function CatalogueTile({ item, onChoose }: { item: CatalogueItem; onChoose: () => void }) {
  return (
    <li className="card item">
      <div className="swatch"><ProductPhoto id={hmPhotoId(item.sku, item.source)} name={item.name} /></div>
      <div className="grow">
        <p className="title">{item.name}</p>
        <p className="muted">{[item.brand, item.colourFamily, item.price !== null && item.currency ? formatPrice(item.price, item.currency) : null].filter(Boolean).join(' · ')}</p>
        <div className="row">
          <button type="button" onClick={onChoose} aria-label={`Choose ${item.name}`}>Add to wardrobe</button>
          <SourceLink url={item.productUrl} />
        </div>
      </div>
    </li>
  );
}

/** The catalogue picker (FR-21): search by name or brand, filters, 40 per page, then the item form pre-filled. An empty catalogue says so and offers "Add my own". */
export function CatalogueView() {
  const repo = useRepository();
  const [draft, setDraft] = useState<CatalogueFilter>(NO_CATALOGUE_FILTER);
  const [applied, setApplied] = useState<CatalogueFilter>(NO_CATALOGUE_FILTER);
  const [rows, setRows] = useState<CatalogueItem[] | null>(null);
  const [next, setNext] = useState<CatalogueCursor | null>(null);
  const [brands, setBrands] = useState<string[]>([]);
  const [chosen, setChosen] = useState<CatalogueItem | null>(null);
  const [error, setError] = useState('');
  const [barcode, setBarcode] = useState<Exclude<BarcodeResult, { kind: 'invalid' | 'one' }> | null>(null); // a lookup that found none or several
  const [chosenCode, setChosenCode] = useState<string | undefined>(); // the padded code a single match was found with
  const run = useRef(0); // only the newest request may change the screen
  const load = useCallback(async (after: CatalogueCursor | null) => {
    if (!repo) return;
    const mine = ++run.current;
    try {
      const page = await repo.catalogue.page(applied, after);
      if (mine !== run.current) return;
      setRows((old) => (after && old ? [...old, ...page.rows] : page.rows));
      setNext(page.next);
      setError('');
    } catch (e) { if (mine === run.current) setError(messageOf(e, false)); }
  }, [repo, applied]);
  useEffect(() => { void load(null); }, [load]);
  const jumped = useRef(false); // "Add by barcode" on the wardrobe links here with ?barcode=1: show the barcode section and focus its field, once
  useEffect(() => {
    if (!repo || jumped.current || typeof window === 'undefined' || !new URLSearchParams(window.location.search).has('barcode')) return;
    const section = document.querySelector<HTMLElement>('section[aria-label="Find by barcode"]');
    if (!section) return;
    jumped.current = true;
    section.scrollIntoView({ block: 'start' });
    section.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [repo, chosen]);
  useEffect(() => { if (repo) void repo.catalogue.brands().then(setBrands, () => setBrands([])); }, [repo]);

  if (chosen) return <ItemForm catalogueStart={{ item: chosen, onCancel: () => setChosen(null) }} barcode={chosenCode} />;
  const pick = (patch: Partial<CatalogueFilter>) => { const n = { ...draft, ...patch }; setDraft(n); setApplied(n); };
  const filtered = JSON.stringify(applied) !== JSON.stringify(NO_CATALOGUE_FILTER);
  const caption = catalogueCaption(dataBackend(), HM_ARTICLES.length > 0);
  return (
    <>
      <div className="row between">
        <h1>Catalogue</h1>
        <Link href="/items/new" className="button secondary">Add my own</Link>
      </div>
      {caption && <p className="muted" data-demo={caption.kind === 'hm' ? 'hm-catalogue' : 'catalogue'}>{caption.text}</p>}
      {repo && (
        <BarcodeLookup catalogue={repo.catalogue} onResult={(r) => {
          if (r.kind === 'one') { setBarcode(null); setChosenCode(r.gtin); setChosen(r.item); } else { setChosenCode(undefined); setBarcode(r); }
        }} />
      )}
      {barcode && (
        <div role="status">
          <p>{barcode.kind === 'none' ? noMatch(barcode.gtin) : severalMatches(barcode.items.length, barcode.gtin)}</p>
          <div className="row">
            {barcode.kind === 'many' && <ul className="list tiles">{barcode.items.map((i) => <CatalogueTile key={i.id} item={i} onChoose={() => { setChosenCode(barcode.gtin); setChosen(i); }} />)}</ul>}
            <Link href={addOwnWithBarcode(barcode.gtin)} className="button secondary">Add my own with this barcode</Link>
            <button type="button" onClick={() => setBarcode(null)}>Back to the catalogue</button>
          </div>
        </div>
      )}
      <form className="filters six" role="search" aria-label="Search the catalogue" onSubmit={(e) => { e.preventDefault(); setApplied(draft); }}>
        <label>Search by name or brand
          <input type="text" value={draft.q} maxLength={80} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        </label>
        <label>Category
          <select value={draft.category} onChange={(e) => pick({ category: e.target.value })}>
            <option value="">All</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>Brand
          <select value={draft.brand} onChange={(e) => pick({ brand: e.target.value })}>
            <option value="">All</option>
            {brands.map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
        <label>Colour family
          <select value={draft.colourFamily} onChange={(e) => pick({ colourFamily: e.target.value })}>
            <option value="">All</option>
            {COLOUR_FAMILIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>Style
          <select value={draft.style} onChange={(e) => pick({ style: e.target.value })}>
            <option value="">All</option>
            {STYLES.map((s) => <option key={s} value={s}>{styleLabel(s)}</option>)}
          </select>
        </label>
        <button type="submit">Search</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      <p aria-live="polite" className="muted">{rows === null ? 'Loading…' : `${rows.length} shown${next ? ', more available' : ''}`}</p>
      {rows !== null && rows.length === 0 && !error && (
        <div role="status">
          <p>{filtered ? 'Nothing in the catalogue matches. Change the search or the filters.' : 'The catalogue is empty for now.'}</p>
          <Link href="/items/new" className="button">Add my own</Link>
        </div>
      )}
      <ul className="list tiles">
        {(rows ?? []).map((i) => <CatalogueTile key={i.id} item={i} onChoose={() => setChosen(i)} />)}
      </ul>
      {next && <button type="button" onClick={() => void load(next)}>Show 40 more</button>}
    </>
  );
}
