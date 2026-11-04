import { describe, expect, it } from 'vitest';
import { hexToRgb } from '@sparta/taxonomy';
import { suggest, isMissing } from '@sparta/rules';
import { DEMO_WARDROBE_NAMES, loadDemoWardrobe } from './demo';
import { LocalRepository } from './local-repository';
import type { StorageLike } from './local-repository';

const mem = (): StorageLike => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };

describe('demo wardrobe loader', () => {
  it('offers the five R1 fixture wardrobes', () => {
    expect(DEMO_WARDROBE_NAMES).toHaveLength(5);
  });
  it('loads a wardrobe into the repository, with hex matching rgb', async () => {
    const repo = new LocalRepository(mem());
    const n = await loadDemoWardrobe(repo, 'Office regular');
    const items = await repo.items.list();
    expect(items).toHaveLength(n);
    expect(n).toBeGreaterThan(20);
    for (const i of items) expect(hexToRgb(i.hex)).toEqual(i.rgb);
  });
  it('can be loaded twice without id clashes', async () => {
    const repo = new LocalRepository(mem());
    await loadDemoWardrobe(repo, 'Thin wardrobe');
    await loadDemoWardrobe(repo, 'Thin wardrobe');
    const ids = (await repo.items.list()).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('keeps archived fixture items archived with a reason', async () => {
    const repo = new LocalRepository(mem());
    await loadDemoWardrobe(repo, 'Thin wardrobe');
    const archived = (await repo.items.list()).filter((i) => i.status === 'archived');
    expect(archived.length).toBeGreaterThan(0);
    expect(archived.every((i) => i.archiveReason === 'sold')).toBe(true);
  });
  it('stores items the engine accepts as they are', async () => {
    const repo = new LocalRepository(mem());
    await loadDemoWardrobe(repo, 'Office regular');
    const result = suggest(await repo.items.list(), { occasion: 'Work', hemisphere: 'north', date: new Date(Date.UTC(2026, 3, 15)) });
    expect(isMissing(result)).toBe(false);
  });
});
