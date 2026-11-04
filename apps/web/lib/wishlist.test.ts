import { describe, expect, it } from 'vitest';
import { unlock } from '@sparta/rules';
import { WARDROBES } from '../../../packages/rules/src/fixtures/wardrobes';
import { EventLog } from './events';
import { LocalRepository } from './local-repository';
import type { StorageLike } from './local-repository';
import { buildCtx, seasonOf } from './suggestions-view-model';
import { addUnlockToWishlist, unlockEntries, unlockKey, unlockLabel, unlockWishlistInput, wishlistAggregate } from './wishlist';

const mem = (): StorageLike => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };
const ctx = buildCtx('Casual', 'north', new Date('2026-04-15T12:00:00Z'));
const office = WARDROBES['Office regular']!;
const CHINOS = { subType: 'Chinos', colourFamily: 'Navy', newOutfits: 6 } as const;
const fresh = () => ({ repo: new LocalRepository(mem()), log: new EventLog(mem(), () => '2026-11-04T10:00:00.000Z', () => 'cfg') });

describe('wishlistAggregate leaves out Wardrobe unlock entries (CC9, FR-74, FR-81)', () => {
  it('counts user entries and entries saved before R4 (no origin), not unlock entries', () => {
    expect(wishlistAggregate([
      { subType: 'Chinos', origin: 'user' }, { subType: 'Chinos', origin: 'unlock' }, { subType: 'Boots' }, { subType: 'Boots', origin: 'unlock' }, { subType: 'Boots', origin: 'unlock' },
    ])).toEqual({ total: 2, bySubType: { Chinos: 1, Boots: 1 }, excludedUnlock: 3 });
  });
  it('an empty list, and a list of only unlock entries, count zero', () => {
    expect(wishlistAggregate([])).toEqual({ total: 0, bySubType: {}, excludedUnlock: 0 });
    expect(wishlistAggregate([{ subType: 'Chinos', origin: 'unlock' }]).total).toBe(0);
  });
  it('end to end: an entry added from unlock never reaches the aggregate; the person\'s own entry does', async () => {
    const { repo, log } = fresh();
    await addUnlockToWishlist(repo, log, CHINOS, ctx);
    await repo.wishlist.create({ name: 'Brown boots', subType: 'Boots', note: null });
    expect(await repo.wishlist.list()).toHaveLength(2);
    expect(wishlistAggregate(await repo.wishlist.list())).toEqual({ total: 1, bySubType: { Boots: 1 }, excludedUnlock: 1 });
  });
});

describe('Wardrobe unlock entries (FR-59b)', () => {
  it('are the engine\'s list over the active items, at most three, as attributes and the exact count only', () => {
    const entries = unlockEntries(office, ctx, {});
    expect(entries).toEqual(unlock(office, ctx, {}));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThanOrEqual(3);
    for (const e of entries) expect(Object.keys(e).sort()).toEqual(['colourFamily', 'newOutfits', 'subType']);
    expect(JSON.stringify(entries)).not.toMatch(/price|store|photo|image|brand/i);
  });
  it('ignore archived items, so an all-archived wardrobe has none', () => {
    expect(unlockEntries(office.map((i) => ({ ...i, status: 'archived' as const })), ctx, {})).toEqual([]);
  });
  it('are labelled "Add <colour family> <sub-type>: N new outfits", singular for one', () => {
    expect(unlockLabel(CHINOS)).toBe('Add Navy Chinos: 6 new outfits');
    expect(unlockLabel({ ...CHINOS, newOutfits: 1 })).toBe('Add Navy Chinos: 1 new outfit');
  });
  it('make a wishlist entry with sub-type and colour family, no brand or price, origin unlock', () => {
    expect(unlockWishlistInput(CHINOS)).toEqual({ name: 'Navy Chinos', subType: 'Chinos', colourFamily: 'Navy', note: null, origin: 'unlock' });
  });
});

describe('Add to wishlist (FR-59b, FDD 16)', () => {
  it('creates the entry through the repository with origin unlock and logs wishlist_added with origin unlock, occasion and season but no names', async () => {
    const { repo, log } = fresh();
    expect(await addUnlockToWishlist(repo, log, CHINOS, ctx)).toEqual({ added: true });
    expect(await repo.wishlist.list()).toMatchObject([{ name: 'Navy Chinos', subType: 'Chinos', colourFamily: 'Navy', origin: 'unlock' }]);
    expect(log.list()).toEqual([{
      type: 'wishlist_added', at: '2026-11-04T10:00:00.000Z', occasion: 'Casual', season: seasonOf(ctx), engine_config: 'cfg', rule_ids: [], slot: null, origin: 'unlock',
    }]);
    expect(JSON.stringify(log.list())).not.toMatch(/Chinos|Navy/);
  });
  it('a second tap on the same entry adds nothing and logs nothing', async () => {
    const { repo, log } = fresh();
    await addUnlockToWishlist(repo, log, CHINOS, ctx);
    expect(await addUnlockToWishlist(repo, log, CHINOS, ctx)).toEqual({ added: false });
    expect(await repo.wishlist.list()).toHaveLength(1);
    expect(log.count('wishlist_added')).toBe(1);
  });
  it('the same sub-type in another colour, or the person\'s own entry of that kind, is not a duplicate', async () => {
    const { repo, log } = fresh();
    await repo.wishlist.create({ name: 'Navy chinos', subType: 'Chinos', note: null, colourFamily: 'Navy', origin: 'user' });
    expect((await addUnlockToWishlist(repo, log, CHINOS, ctx)).added).toBe(true);
    expect((await addUnlockToWishlist(repo, log, { ...CHINOS, colourFamily: 'Olive' }, ctx)).added).toBe(true);
    expect(await repo.wishlist.list()).toHaveLength(3);
    expect(unlockKey({ subType: 'Chinos' })).toBe('Chinos|');
  });
});
