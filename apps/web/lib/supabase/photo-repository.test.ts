import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { ItemInput, PhotoAttachment } from '../repository';
import { featuresRow, itemRow } from './mapping';
import { SupabaseRepository } from './repository';

// Items added by photo (WO-0073): the item row carries origin 'photo' and the picture paths, and the features row is written only when valid.
const UID = '5c1b3b52-0000-4000-8000-0000000000aa';
const ITEM_ID = '5c1b3b52-0000-4000-8000-000000000001';
const base: ItemInput = {
  name: 'Navy Shirt', category: 'Tops', subType: 'Shirt', rgb: [0, 0, 139], hex: '#00008B', colourFamily: 'Navy', fit: null, material: null, pattern: null,
  seasons: [], occasions: [], condition: null, favourite: false, neverWorn: false, status: 'active', archiveReason: null,
};
const emb = Array.from({ length: 32 }, (_, i) => i / 31);
const photo = (features: PhotoAttachment['features']): PhotoAttachment => ({ imagePath: `${UID}/7-cutout.webp`, imageThumbPath: `${UID}/7-thumb.webp`, features });
const goodFeatures = { modelVersion: 'garment-cnn-v1', garmentClass: 7, p: 0.93, embedding: emb };

describe('itemRow with a photo', () => {
  it('a manual item is unchanged: origin manual and no image columns', () => {
    const row = itemRow(base, UID, 'NOW');
    expect(row.origin).toBe('manual');
    expect(Object.keys(row)).not.toContain('image_path');
    expect(Object.keys(row)).not.toContain('image_thumb_path');
    expect(Object.keys(row)).not.toContain('photo');
  });
  it('a photo item has origin photo and its two image paths, and no photo or features object leaks into the row', () => {
    const row = itemRow({ ...base, photo: photo(goodFeatures) }, UID, 'NOW');
    expect(row).toMatchObject({ origin: 'photo', image_path: `${UID}/7-cutout.webp`, image_thumb_path: `${UID}/7-thumb.webp`, user_id: UID });
    expect(Object.keys(row)).not.toContain('photo');
    expect(Object.keys(row)).not.toContain('embedding');
  });
});

describe('featuresRow', () => {
  it('builds the item_features row for version 1: 32 numbers, class, p, the owner and the item', () => {
    expect(featuresRow(ITEM_ID, UID, goodFeatures)).toEqual({ item_id: ITEM_ID, user_id: UID, model_version: 'garment-cnn-v1', garment_class: 7, garment_p: 0.93, embedding: emb });
  });
  it('accepts a null class and p (the table allows them)', () => {
    expect(featuresRow(ITEM_ID, UID, { ...goodFeatures, garmentClass: null, p: null })).toMatchObject({ garment_class: null, garment_p: null });
  });
  it('refuses what the table would refuse: unknown version, wrong count for the version, NaN or Infinity, class or p out of range', () => {
    const bad = [
      { ...goodFeatures, modelVersion: 'garment-cnn-v3' }, { ...goodFeatures, modelVersion: '' }, { ...goodFeatures, embedding: emb.slice(1) }, { ...goodFeatures, embedding: [...emb, 0] },
      { ...goodFeatures, modelVersion: 'garment-cnn-v2' }, { ...goodFeatures, embedding: [...emb.slice(1), Number.NaN] }, { ...goodFeatures, embedding: [...emb.slice(1), Infinity] },
      { ...goodFeatures, garmentClass: 10 }, { ...goodFeatures, garmentClass: -1 }, { ...goodFeatures, garmentClass: 1.5 }, { ...goodFeatures, p: 1.01 }, { ...goodFeatures, p: -0.01 },
    ];
    for (const f of bad) expect(featuresRow(ITEM_ID, UID, f), JSON.stringify(f).slice(0, 80)).toBeNull();
    expect(featuresRow(ITEM_ID, UID, { ...goodFeatures, modelVersion: 'garment-cnn-v2', embedding: [...emb, ...emb], garmentClass: 19 })).not.toBeNull();
  });
});

// ---- the repository over a fake client ----------------------------------------------------------------------------------
type Call = { table: string; steps: [string, unknown[]][] };
const itemRowBack = {
  id: ITEM_ID, name: 'Navy Shirt', category: 'Tops', sub_type: 'Shirt', colour_r: 0, colour_g: 0, colour_b: 139, colour_hex: '#00008B', colour_family: 'Navy', fit: null, material: null,
  pattern: null, seasons: [], occasions: [], condition: null, never_worn: false, favourite: false, status: 'active', archive_reason: null, created_at: 'a', updated_at: 'b',
};
const builder = (call: Call, answer: (c: Call) => { data: unknown; error: unknown; status?: number }): unknown => new Proxy({}, {
  get: (_t, prop) => (prop === 'then'
    ? (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => new Promise((ok) => ok(answer(call))).then(res, rej)
    : (...args: unknown[]) => { call.steps.push([String(prop), args]); return builder(call, answer); }),
});
function fake(featuresAnswer: () => { data: unknown; error: unknown; status?: number } = () => ({ data: null, error: null, status: 201 })) {
  const calls: Call[] = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: UID } } }, error: null }) },
    schema: () => ({ from: (table: string) => { const call: Call = { table, steps: [] }; calls.push(call); return builder(call, (c) => (c.table === 'items' ? { data: itemRowBack, error: null, status: 201 } : featuresAnswer())); } }),
  } as unknown as SupabaseClient;
  return { repo: new SupabaseRepository(client, () => 'NOW'), calls };
}
const inserted = (calls: Call[], table: string) => calls.filter((c) => c.table === table && c.steps.some((s) => s[0] === 'insert'));

describe('SupabaseRepository.items.create with a photo', () => {
  it('writes the item with origin photo and then its features row for the same item and owner', async () => {
    const { repo, calls } = fake();
    const item = await repo.items.create({ ...base, photo: photo(goodFeatures) });
    expect(item.id).toBe(ITEM_ID);
    expect(inserted(calls, 'items')).toHaveLength(1);
    expect(inserted(calls, 'item_features')).toHaveLength(1);
    expect(calls.findIndex((c) => c.table === 'items')).toBeLessThan(calls.findIndex((c) => c.table === 'item_features'));
    const row = inserted(calls, 'items')[0]!.steps.find((s) => s[0] === 'insert')![1][0] as Record<string, unknown>;
    expect(row).toMatchObject({ origin: 'photo', image_path: `${UID}/7-cutout.webp` });
    const feat = inserted(calls, 'item_features')[0]!.steps.find((s) => s[0] === 'insert')![1][0] as Record<string, unknown>;
    expect(feat).toMatchObject({ item_id: ITEM_ID, user_id: UID, model_version: 'garment-cnn-v1' });
    expect(feat.embedding).toHaveLength(32);
  });
  it('writes NO features row when the result had none (the guess switch is off)', async () => {
    const { repo, calls } = fake();
    await repo.items.create({ ...base, photo: photo(null) });
    expect(inserted(calls, 'items')).toHaveLength(1);
    expect(inserted(calls, 'item_features')).toHaveLength(0);
  });
  it('writes NO features row for a manual item', async () => {
    const { repo, calls } = fake();
    await repo.items.create(base);
    expect(inserted(calls, 'item_features')).toHaveLength(0);
  });
  it('writes NO features row when the numbers do not fit the table, and the item is still saved', async () => {
    const { repo, calls } = fake();
    const item = await repo.items.create({ ...base, photo: photo({ ...goodFeatures, embedding: emb.slice(1) }) });
    expect(item.id).toBe(ITEM_ID);
    expect(inserted(calls, 'item_features')).toHaveLength(0);
  });
  it('a features row the server refuses does not undo or fail the save', async () => {
    const { repo, calls } = fake(() => ({ data: null, error: { code: '23514', message: 'check' }, status: 400 }));
    const item = await repo.items.create({ ...base, photo: photo(goodFeatures) });
    expect(item.id).toBe(ITEM_ID);
    expect(inserted(calls, 'item_features')).toHaveLength(1);
  });
  it('a failed item insert writes no features row and throws', async () => {
    const calls: Call[] = [];
    const client = {
      auth: { getSession: async () => ({ data: { session: { user: { id: UID } } }, error: null }) },
      schema: () => ({ from: (table: string) => { const call: Call = { table, steps: [] }; calls.push(call); return builder(call, () => ({ data: null, error: { code: '42501', message: 'x' }, status: 403 })); } }),
    } as unknown as SupabaseClient;
    await expect(new SupabaseRepository(client).items.create({ ...base, photo: photo(goodFeatures) })).rejects.toMatchObject({ kind: 'refused' });
    expect(inserted(calls, 'item_features')).toHaveLength(0);
  });
});
