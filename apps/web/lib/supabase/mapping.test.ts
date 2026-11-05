import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, COLOUR_FAMILIES, OCCASIONS, SUB_TYPES, categoryOfSubType, colourFamily, rgbToHex, subTypesOf } from '@sparta/taxonomy';
import type { Slot } from '@sparta/rules';
import type { ItemInput, OutfitInput, WishlistInput } from '../repository';
import { itemInput } from '../../test-support/arbitraries';
import { feedbackRow, itemFromRow, itemPatch, itemRow, outfitFromRow, outfitPatch, outfitRows, wishlistFromRow, wishlistPatch, wishlistRow } from './mapping';

// Unit tests of the mapping both ways (WO-0052). `database` stands in for what the real database does to a written row: it adds the
// id and times and fills the colour columns exactly as the trigger does (the same colour function, LLD 4.3); the integration suite
// repeats the round trip against the real stack.
const pick = <T>(xs: readonly T[]) => fc.constantFrom(...xs);

const database = (row: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: '5c1b3b52-0000-4000-8000-000000000001', created_at: '2026-11-05T10:00:00+00:00', updated_at: '2026-11-05T10:00:00+00:00', ...row,
  colour_hex: rgbToHex(row.colour_r as number, row.colour_g as number, row.colour_b as number),
  colour_family: colourFamily(row.colour_r as number, row.colour_g as number, row.colour_b as number), ...extra,
});

describe('items: engine item to app.items columns and back', () => {
  it('every item round-trips (property, 500 random items)', () => {
    fc.assert(fc.property(itemInput, (input) => {
      const row = itemRow(input, 'u1', '2026-11-05T10:00:00Z');
      const back = itemFromRow(database(row));
      expect(back).toEqual({ ...input, id: '5c1b3b52-0000-4000-8000-000000000001', createdAt: '2026-11-05T10:00:00+00:00', updatedAt: '2026-11-05T10:00:00+00:00' });
    }), { numRuns: 500 });
  });
  it('a written row never carries a colour hex, a colour family, an id or the secondary colour: the database sets those', () => {
    fc.assert(fc.property(itemInput, (input) => {
      const keys = Object.keys(itemRow(input, 'u1', 'now'));
      for (const k of ['id', 'colour_hex', 'colour_family', 'is_multicolour', 'colour2_r', 'colour2_hex', 'colour2_family', 'created_at', 'updated_at', 'hex', 'colourFamily']) expect(keys).not.toContain(k);
      expect(keys).toEqual(expect.arrayContaining(['user_id', 'origin', 'name', 'category', 'sub_type', 'colour_r', 'colour_g', 'colour_b']));
    }));
  });
  it('the written row is a different object from the input (arrays are copied), with the person as owner and origin manual', () => {
    const input = fc.sample(itemInput, 1)[0]!;
    const row = itemRow(input, 'u1', 'now');
    expect([row.user_id, row.origin]).toEqual(['u1', 'manual']);
    expect(row.seasons).not.toBe(input.seasons);
  });
  it('a patch holds only the fields given; unknown or derived fields are dropped; going active clears archived_at', () => {
    expect(itemPatch({ favourite: true })).toEqual({ favourite: true });
    expect(itemPatch({ rgb: [1, 2, 3], hex: '#010203', colourFamily: 'Black' })).toEqual({ colour_r: 1, colour_g: 2, colour_b: 3 });
    expect(itemPatch({ status: 'active' })).toEqual({ status: 'active', archived_at: null });
    expect(itemPatch({ status: 'archived', archiveReason: 'sold' })).toEqual({ status: 'archived', archive_reason: 'sold' });
    expect(itemPatch({ fit: null })).toEqual({ fit: null });
    expect(itemPatch({ id: 'x', createdAt: 'y' } as Partial<ItemInput>)).toEqual({});
  });
  it('an archived item keeps archived_at from the clock it was given', () => {
    expect(itemRow({ ...fc.sample(itemInput, 1)[0]!, status: 'archived' }, 'u', 'T').archived_at).toBe('T');
    expect(itemRow({ ...fc.sample(itemInput, 1)[0]!, status: 'active' }, 'u', 'T').archived_at).toBeNull();
  });
  it('a row with a value the app does not know is refused, not guessed', () => {
    const good = database(itemRow(fc.sample(itemInput, 1)[0]!, 'u', 'now'));
    for (const bad of [{ category: 'Hats' }, { sub_type: 'Fedora' }, { colour_r: 300 }, { colour_family: 'Chartreuse' }, { status: 'gone' }, { seasons: ['Monsoon'] }, { pattern: 'Plaid' }, { archive_reason: 'burned' }, { name: null }])
      expect(() => itemFromRow({ ...good, ...bad }), JSON.stringify(bad)).toThrow(/could not be read/);
  });
  it('sub-types always belong to their category (the pair the database checks)', () => {
    for (const c of CATEGORIES) for (const s of subTypesOf(c)) expect(categoryOfSubType(s)).toBe(c);
  });
});

describe('outfits: saved outfit to app.outfits and app.outfit_items and back', () => {
  const ids = fc.uuid();
  const outfit: fc.Arbitrary<{ input: OutfitInput; suit: string | null; subs: Map<string, string> }> = fc.record({
    occasion: pick(OCCASIONS), top: fc.option(ids, { nil: null }), footwear: fc.option(ids, { nil: null }), accessory: fc.option(ids, { nil: null }),
    bottom: fc.option(ids, { nil: null }), layer: fc.option(ids, { nil: null }), suit: fc.option(ids, { nil: null }),
    score: fc.option(fc.double({ min: 0, max: 100, noNaN: true }).map((x) => x + 0), { nil: null }), reasons: fc.array(fc.string({ maxLength: 60 }), { maxLength: 6 }),
  }).map((r) => {
    const slots: Record<Slot, string | null> = r.suit ? { top: r.top, bottom: r.suit, layer: r.suit, footwear: r.footwear, accessory: r.accessory } : { top: r.top, bottom: r.bottom, layer: r.layer, footwear: r.footwear, accessory: r.accessory };
    const subs = new Map<string, string>(Object.values(slots).flatMap((i) => (i ? [[i, i === r.suit ? 'Suit' : 'Shirt'] as [string, string]] : [])));
    return { input: { occasion: r.occasion, items: slots, score: r.score, reasons: r.reasons }, suit: r.suit, subs };
  });
  // Distinct ids per slot are needed (one item in two slots only happens for a Suit), so draw until the slots are unique.
  const valid = outfit.filter(({ input, suit }) => { const v = Object.values(input.items).filter((x): x is string => x !== null && x !== suit); return new Set(v).size === v.length && (suit === null || !v.includes(suit)); });
  const database_ = (rows: ReturnType<typeof outfitRows>, subs: Map<string, string>) => ({
    id: 'o1', created_at: '2026-11-05T10:00:00+00:00', ...rows.outfit,
    outfit_items: rows.pieces.map((p) => ({ item_id: p.item_id, slot: p.slot, items: { sub_type: subs.get(p.item_id as string) } })),
  });

  it('every outfit round-trips, including score, reasons and a Suit that fills two slots (property)', () => {
    fc.assert(fc.property(valid, ({ input, subs }) => {
      const back = outfitFromRow(database_(outfitRows(input, 'u1'), subs));
      expect(back).toEqual({ ...input, id: 'o1', createdAt: '2026-11-05T10:00:00+00:00' });
    }), { numRuns: 500 });
  });
  it('a piece is stored once however many slots it fills, and the row holds the person and one occasion', () => {
    const { input, subs } = fc.sample(valid.filter((o) => o.suit !== null), 1)[0]!;
    const rows = outfitRows(input, 'u1');
    expect(new Set(rows.pieces.map((p) => p.item_id)).size).toBe(rows.pieces.length);
    expect(rows.outfit).toMatchObject({ user_id: 'u1', occasions: [input.occasion], seasons: [] });
    expect(subs.size).toBeGreaterThan(0);
  });
  it('an outfit with no known occasion is skipped, and notes written by someone else read as no score and no reasons', () => {
    expect(outfitFromRow({ id: 'o', occasions: [], created_at: 't', outfit_items: [] })).toBeNull();
    expect(outfitFromRow({ id: 'o', occasions: ['Work'], created_at: 't', notes: 'wear the blue one', outfit_items: [] })).toMatchObject({ occasion: 'Work', score: null, reasons: [] });
  });
  it('a patch with an occasion changes the occasion and name only', () => { expect(outfitPatch({ occasion: 'Party' })).toEqual({ occasions: ['Party'], name: 'Party outfit' }); expect(outfitPatch({ score: 1 })).toEqual({}); });
});

describe('wishlist: entry to app.wishlist_entries and back', () => {
  const wish: fc.Arbitrary<WishlistInput> = fc.record({
    name: fc.string({ minLength: 1, maxLength: 60 }), subType: pick(SUB_TYPES), colourFamily: fc.option(pick(COLOUR_FAMILIES), { nil: null }),
    origin: pick(['user', 'unlock'] as const), note: fc.option(fc.string({ maxLength: 60 }), { nil: null }),
  });
  const database_ = (row: Record<string, unknown>) => ({
    id: 'w1', created_at: '2026-11-05T10:00:00+00:00', ...row,
    colour_family: row.is_multicolour ? 'Multi' : colourFamily(row.colour_r as number | null, row.colour_g as number | null, row.colour_b as number | null),
  });
  it('every entry round-trips, with its colour family and its origin (property)', () => {
    fc.assert(fc.property(wish, (input) => {
      const row = wishlistRow(input, 'u1');
      expect(wishlistFromRow(database_(row))).toEqual({ ...input, id: 'w1', createdAt: '2026-11-05T10:00:00+00:00' });
    }), { numRuns: 500 });
  });
  it('the colour is sent as the family\'s reference RGB, Multi as the flag with no RGB, and no hex or family column is sent', () => {
    const base = { name: 'n', subType: 'Shirt', origin: 'unlock', note: null } as const;
    expect(wishlistRow({ ...base, colourFamily: 'Multi' }, 'u')).toMatchObject({ colour_r: null, colour_g: null, colour_b: null, is_multicolour: true, origin: 'unlock', category: 'Tops' });
    expect(wishlistRow({ ...base, colourFamily: null }, 'u')).toMatchObject({ colour_r: null, is_multicolour: false });
    const keys = Object.keys(wishlistRow({ ...base, colourFamily: 'Navy' }, 'u'));
    for (const k of ['colour_hex', 'colour_family', 'id']) expect(keys).not.toContain(k);
  });
  it('an entry made without an origin is stored as the person\'s own', () => {
    expect(wishlistRow({ name: 'n', subType: 'Shirt', note: null }, 'u').origin).toBe('user');
    expect(wishlistPatch({ note: 'x' })).toEqual({ notes: 'x' });
  });
});

describe('suggestion feedback rows hold the occasion, the rules and the engine string only (FR-53, LLD 4.4)', () => {
  it('whatever else the event carries, the row has exactly five fields and no item id or name (property)', () => {
    fc.assert(fc.property(fc.uuid(), fc.string(), pick(['suggestion_accepted', 'suggestion_rejected'] as const), pick(OCCASIONS), fc.array(fc.oneof(fc.constantFrom('R1', 'R2', 'ANCHOR'), fc.uuid(), fc.string()), { maxLength: 8 }), (itemId, name, type, occasion, ruleIds) => {
      const event = { type, occasion, engine_config: 'gm1;emb0;pair0;ul:fb;w:base', rule_ids: ruleIds, itemId, name, items: { top: itemId } };
      const row = feedbackRow(event, 'u1')!;
      expect(Object.keys(row).sort()).toEqual(['accepted', 'engine_config', 'occasion', 'rule_ids', 'user_id']);
      expect(JSON.stringify(row)).not.toContain(itemId);
      for (const r of row.rule_ids as string[]) expect(r).toMatch(/^[A-Z][A-Z0-9_]{0,15}$/);
      expect(row.accepted).toBe(type === 'suggestion_accepted');
    }));
  });
  it('swaps, item_added and an event with no occasion send nothing', () => {
    for (const type of ['suggestion_swapped', 'item_added', 'wishlist_added']) expect(feedbackRow({ type, occasion: 'Work', engine_config: 'x', rule_ids: [] }, 'u')).toBeNull();
    expect(feedbackRow({ type: 'suggestion_accepted', occasion: null, engine_config: 'x', rule_ids: [] }, 'u')).toBeNull();
  });
});
