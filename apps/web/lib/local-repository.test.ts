import { describe, expect, it } from 'vitest';
import { STORAGE_KEY, LocalRepository } from './local-repository';
import type { StorageLike } from './local-repository';
import type { ItemInput } from './repository';

/** A fake Storage over a Map; `fail` makes every call throw like a blocked or full store. */
function fakeStorage(fail = false): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const boom = (): never => { throw new Error('storage unavailable'); };
  return {
    data,
    getItem: (k) => (fail ? boom() : (data.get(k) ?? null)),
    setItem: (k, v) => (fail ? boom() : void data.set(k, v)),
  };
}
let tick = 0;
const clock = () => `2026-11-04T10:00:${String(tick++).padStart(2, '0')}.000Z`;
const shirt = (over: Partial<ItemInput> = {}): ItemInput => ({
  name: 'Navy Shirt', category: 'Tops', subType: 'Shirt', hex: '#1F2A44', rgb: [31, 42, 68], colourFamily: 'Navy', pattern: null,
  seasons: [], occasions: ['Work'], condition: null, favourite: false, status: 'active', fit: null, material: null,
  neverWorn: false, archiveReason: null, ...over,
});
const make = (storage: StorageLike | null = fakeStorage()) => new LocalRepository(storage, clock);

describe('LocalRepository items', () => {
  it('creates an item with an id and timestamps and reads it back', async () => {
    const repo = make();
    const item = await repo.items.create(shirt());
    expect(item.id).toBeTruthy();
    expect(item.createdAt).toBe(item.updatedAt);
    expect(await repo.items.get(item.id)).toEqual(item);
  });
  it('stores the engine Item fields untouched next to the display fields', async () => {
    const item = await make().items.create(shirt({ condition: 40, favourite: true }));
    expect(item).toMatchObject({ category: 'Tops', subType: 'Shirt', rgb: [31, 42, 68], colourFamily: 'Navy', status: 'active', condition: 40, favourite: true, hex: '#1F2A44' });
  });
  it('lists newest first', async () => {
    const repo = make();
    const a = await repo.items.create(shirt({ name: 'A' }));
    const b = await repo.items.create(shirt({ name: 'B' }));
    expect((await repo.items.list()).map((i) => i.id)).toEqual([b.id, a.id]);
  });
  it('gives every item a different id', async () => {
    const repo = make();
    const ids = new Set([(await repo.items.create(shirt())).id, (await repo.items.create(shirt())).id, (await repo.items.create(shirt())).id]);
    expect(ids.size).toBe(3);
  });
  it('updates attributes, keeps id and createdAt, and moves updatedAt', async () => {
    const repo = make();
    const item = await repo.items.create(shirt());
    const changed = await repo.items.update(item.id, { name: 'Work shirt', condition: 12, id: 'hacked', createdAt: 'x' } as Partial<ItemInput>);
    expect(changed).toMatchObject({ id: item.id, createdAt: item.createdAt, name: 'Work shirt', condition: 12 });
    expect(changed!.updatedAt > item.updatedAt).toBe(true);
  });
  it('returns undefined when updating or getting an unknown id', async () => {
    const repo = make();
    expect(await repo.items.update('nope', { name: 'x' })).toBeUndefined();
    expect(await repo.items.get('nope')).toBeUndefined();
  });
  it('archives with a reason and restores (FR-15)', async () => {
    const repo = make();
    const item = await repo.items.create(shirt());
    expect(await repo.items.archive(item.id, 'donated')).toMatchObject({ status: 'archived', archiveReason: 'donated' });
    expect(await repo.items.restore(item.id)).toMatchObject({ status: 'active', archiveReason: null });
  });
  it('removes an item for good and reports false for an unknown id', async () => {
    const repo = make();
    const item = await repo.items.create(shirt());
    expect(await repo.items.remove(item.id)).toBe(true);
    expect(await repo.items.remove(item.id)).toBe(false);
    expect(await repo.items.list()).toEqual([]);
  });
  it('hands out copies, so changing a result does not change the store', async () => {
    const repo = make();
    const item = await repo.items.create(shirt());
    item.name = 'tampered';
    (item.occasions as string[]).push('Party');
    expect((await repo.items.get(item.id))!.name).toBe('Navy Shirt');
    expect((await repo.items.get(item.id))!.occasions).toEqual(['Work']);
  });
});

describe('LocalRepository outfits and wishlist', () => {
  it('saves, lists and removes an outfit', async () => {
    const repo = make();
    const o = await repo.outfits.create({ occasion: 'Work', items: { top: 'a', bottom: 'b', layer: null, footwear: 'c', accessory: null }, score: 0.8, reasons: ['Neutral base'] });
    expect((await repo.outfits.list())[0]).toEqual(o);
    expect(await repo.outfits.remove(o.id)).toBe(true);
    expect(await repo.outfits.list()).toEqual([]);
  });
  it('keeps a wishlist and updates an entry', async () => {
    const repo = make();
    const w = await repo.wishlist.create({ name: 'Brown boots', subType: 'Boots', note: null });
    expect(await repo.wishlist.update(w.id, { note: 'Winter' })).toMatchObject({ name: 'Brown boots', note: 'Winter' });
  });
  it('keeps ids unique across collections', async () => {
    const repo = make();
    const i = await repo.items.create(shirt());
    const w = await repo.wishlist.create({ name: 'x', subType: 'Boots', note: null });
    expect(i.id).not.toBe(w.id);
  });
});

describe('LocalRepository persistence', () => {
  it('survives a reload: a new instance over the same storage sees the data', async () => {
    const storage = fakeStorage();
    const first = make(storage);
    const item = await first.items.create(shirt());
    await first.items.archive(item.id, 'sold');
    await first.outfits.create({ occasion: 'Casual', items: { top: item.id, bottom: null, layer: null, footwear: null, accessory: null }, score: 1, reasons: [] });
    const reloaded = make(storage);
    expect(await reloaded.items.get(item.id)).toMatchObject({ status: 'archived', archiveReason: 'sold' });
    expect(await reloaded.outfits.list()).toHaveLength(1);
    expect((await reloaded.items.create(shirt())).id).not.toBe(item.id);
  });
  it('writes under the versioned key', async () => {
    const storage = fakeStorage();
    await make(storage).items.create(shirt());
    expect(STORAGE_KEY).toMatch(/\.v1$/);
    expect(JSON.parse(storage.data.get(STORAGE_KEY)!).version).toBe(1);
  });
  it('works in memory when storage is null', async () => {
    const repo = make(null);
    await repo.items.create(shirt());
    expect(repo.persistent).toBe(false);
    expect(await repo.items.list()).toHaveLength(1);
  });
  it('works in memory when every storage call throws', async () => {
    const repo = make(fakeStorage(true));
    await repo.items.create(shirt());
    expect(repo.persistent).toBe(false);
    expect(await repo.items.list()).toHaveLength(1);
  });
  it('starts empty on corrupt JSON and on an unknown version, without throwing', async () => {
    for (const raw of ['{not json', JSON.stringify({ version: 2, items: [], outfits: [], wishlist: [] }), 'null', '[]']) {
      const storage = fakeStorage();
      storage.data.set(STORAGE_KEY, raw);
      expect(await make(storage).items.list()).toEqual([]);
    }
  });
});

describe('LocalRepository with a stored document of an unknown version (M3)', () => {
  it('ignores a version-2 document that holds real items, outfits and a wishlist, and starts empty', async () => {
    const storage = fakeStorage();
    const saved = await make(storage).items.create(shirt());
    const doc = JSON.parse(storage.data.get(STORAGE_KEY)!) as Record<string, unknown>;
    storage.data.set(STORAGE_KEY, JSON.stringify({ ...doc, version: 2, outfits: [{ id: 'outfit-9' }], wishlist: [{ id: 'wish-9' }] }));
    const repo = make(storage);
    expect(saved.id).toBeTruthy();
    expect(await repo.items.list()).toEqual([]);
    expect(await repo.outfits.list()).toEqual([]);
    expect(await repo.wishlist.list()).toEqual([]);
    expect(await repo.items.get(saved.id)).toBeUndefined();
  });
});
