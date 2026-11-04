'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CATEGORIES, COLOUR_FAMILIES, conditionBandOf } from '@sparta/taxonomy';
import type { Category, ColourFamily } from '@sparta/taxonomy';
import { DEMO_WARDROBE_NAMES, loadDemoWardrobe } from '../../lib/demo';
import { NO_FILTER, filterItems } from '../../lib/filters';
import type { WardrobeFilter } from '../../lib/filters';
import type { ArchiveReason, StoredItem } from '../../lib/repository';
import { useRepository } from '../use-repository';

const REASONS: ArchiveReason[] = ['sold', 'donated', 'discarded', 'lost'];

function ItemCard({ item, onArchive, onRestore }: {
  item: StoredItem; onArchive: (reason: ArchiveReason) => void; onRestore: () => void;
}) {
  const [reason, setReason] = useState<ArchiveReason>('sold');
  const band = item.condition === null ? null : conditionBandOf(item.condition);
  return (
    <li className="card">
      <span className="swatch" style={{ background: item.hex }} aria-hidden="true" />
      <div className="grow">
        <Link href={`/items/${item.id}`} className="title">{item.name}</Link>
        <p className="muted">
          {item.colourFamily} · {item.subType}{band ? ` · ${band}` : ''}
          {item.favourite ? ' · Favourite' : ''}{item.status === 'archived' && item.archiveReason ? ` · ${item.archiveReason}` : ''}
        </p>
        {item.status === 'archived' ? (
          <button type="button" onClick={onRestore}>Restore {item.name}</button>
        ) : (
          <details>
            <summary>Archive {item.name}</summary>
            <div className="row">
              <label>Reason
                <select value={reason} onChange={(e) => setReason(e.target.value as ArchiveReason)}>
                  {REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => onArchive(reason)}>Archive</button>
            </div>
          </details>
        )}
      </div>
    </li>
  );
}

export function WardrobeList() {
  const repo = useRepository();
  const [items, setItems] = useState<StoredItem[]>([]);
  const [filter, setFilter] = useState<WardrobeFilter>(NO_FILTER);
  const [demo, setDemo] = useState(DEMO_WARDROBE_NAMES[0] ?? '');
  const [note, setNote] = useState('');
  const refresh = useCallback(async () => { if (repo) setItems(await repo.items.list()); }, [repo]);
  useEffect(() => { void refresh(); }, [refresh]);
  const set = (patch: Partial<WardrobeFilter>) => setFilter({ ...filter, ...patch });
  const shown = filterItems(items, filter);
  const act = async (run: () => Promise<unknown>) => { await run(); await refresh(); };

  return (
    <>
      <div className="row between">
        <h1>Wardrobe</h1>
        <Link href="/items/new" className="button">Add item</Link>
      </div>
      <form className="filters" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <label>Category
          <select value={filter.category} onChange={(e) => set({ category: e.target.value as Category | '' })}>
            <option value="">All</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>Colour family
          <select value={filter.colourFamily} onChange={(e) => set({ colourFamily: e.target.value as ColourFamily | '' })}>
            <option value="">All</option>
            {COLOUR_FAMILIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={filter.archived} onChange={(e) => set({ archived: e.target.checked })} />Archived</label>
        <label className="check"><input type="checkbox" checked={filter.favourite} onChange={(e) => set({ favourite: e.target.checked })} />Favourites</label>
        <label className="check"><input type="checkbox" checked={filter.neverWorn} onChange={(e) => set({ neverWorn: e.target.checked })} />Never worn</label>
      </form>
      <p aria-live="polite" className="muted">{repo ? `${shown.length} of ${items.length} items` : 'Loading…'}</p>
      {repo && items.length === 0 && <p>Your wardrobe is empty. Add an item, or load a demo wardrobe below.</p>}
      <ul className="list">
        {shown.map((i) => (
          <ItemCard key={i.id} item={i}
            onArchive={(r) => void act(() => repo!.items.archive(i.id, r))}
            onRestore={() => void act(() => repo!.items.restore(i.id))} />
        ))}
      </ul>
      <section className="demo" aria-label="Demo wardrobe">
        <label>Demo wardrobe
          <select value={demo} onChange={(e) => setDemo(e.target.value)}>
            {DEMO_WARDROBE_NAMES.map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" disabled={!repo} onClick={() => void act(async () => setNote(`Added ${await loadDemoWardrobe(repo!, demo)} items.`))}>
          Load demo wardrobe
        </button>
        <p aria-live="polite" className="muted">{note}</p>
      </section>
    </>
  );
}
