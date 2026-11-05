import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { colourFamily } from '@sparta/taxonomy';
import { itemInput } from '../../test-support/arbitraries';
import { cleanup, discover, makeReady, provisionUser, sql } from '../../test-support/stack';
import { EventLog } from '../events';
import type { UnlockSuggestion } from '@sparta/rules';
import type { ItemInput, OutfitInput } from '../repository';
import { addUnlockToWishlist, wishlistAggregate } from '../wishlist';
import { selectRepository } from './backend';
import { messageOf } from './errors';
import { itemRow } from './mapping';
import { SupabaseRepository } from './repository';

// Integration suite against the REAL local stack (CC3, WO-0052): the repository with a signed-in person's own session, row-level security
// between two people, the refusal for an unsupported country, the stored wishlist origin and the content of the feedback rows. Skips, with a
// message, when the stack is not running.
const stack = discover();
if (!stack) console.warn('SKIPPED repository.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');
vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

const navy: ItemInput = {
  name: 'Navy Shirt', category: 'Tops', subType: 'Shirt', rgb: [0, 0, 139], hex: '#00008B', colourFamily: 'Navy', fit: 'Regular', material: 'Cotton', pattern: 'Solid',
  seasons: ['Spring', 'Summer'], occasions: ['Work', 'Casual'], condition: 20, favourite: true, neverWorn: false, status: 'active', archiveReason: null,
};
const rejects = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as { kind: string; message: string }; } throw new Error('did not reject'); };
const empty = { top: null, bottom: null, layer: null, footwear: null, accessory: null };

describe.skipIf(!stack)('SupabaseRepository against the real stack', () => {
  const run = randomUUID().slice(0, 8);
  const email = { ann: `it-${run}-rann@example.test`, bob: `it-${run}-rbob@example.test`, cat: `it-${run}-rcat@example.test` };
  const pw = randomBytes(12).toString('base64url');
  const mailIds: string[] = [];
  let ann: SupabaseClient; let bob: SupabaseClient; let cat: SupabaseClient;
  let A: SupabaseRepository; let B: SupabaseRepository; let C: SupabaseRepository;
  let annId = ''; let bobId = '';
  const q = (text: string, vars: Record<string, string>) => sql(text, vars);
  const rowsOf = (table: string, user: string) => Number(q(`select count(*) from app.${table} where user_id = :'u'`, { u: user }));

  beforeAll(async () => {
    [ann, bob, cat] = [await provisionUser(stack!, email.ann, pw, mailIds), await provisionUser(stack!, email.bob, pw, mailIds), await provisionUser(stack!, email.cat, pw, mailIds)];
    [A, B, C] = [new SupabaseRepository(ann), new SupabaseRepository(bob), new SupabaseRepository(cat)];
    annId = (await ann.auth.getUser()).data.user!.id;
    bobId = (await bob.auth.getUser()).data.user!.id;
  });
  afterAll(() => cleanup(stack!, Object.values(email), mailIds));

  it('before the acceptance steps a signed-in person reads nothing and cannot write, and the switch gives a blocked repository', async () => {
    expect(await A.items.list()).toEqual([]);
    expect((await rejects(A.items.create(navy))).kind).toBe('refused');
    expect(rowsOf('items', annId)).toBe(0);
    const chosen = await selectRepository('supabase', () => ann, () => { throw new Error('local used'); });
    expect(chosen).not.toBeInstanceOf(SupabaseRepository);
    expect((await rejects(chosen.items.list())).kind).toBe('session');
  });

  it('after acceptance and onboarding the switch gives the account repository for a supported country and a blocked one for an unsupported country', async () => {
    await makeReady(ann, 'IN');
    await makeReady(bob, 'IN');
    await makeReady(cat, 'US');
    expect(await selectRepository('supabase', () => ann, () => { throw new Error('local used'); })).toBeInstanceOf(SupabaseRepository);
    const blocked = await selectRepository('supabase', () => cat, () => { throw new Error('local used'); });
    expect(blocked).not.toBeInstanceOf(SupabaseRepository);
    expect((await rejects(blocked.items.list())).kind).toBe('session');
  });

  it('an unsupported-country person reads nothing and cannot create an item, outfit, wishlist entry or feedback row', async () => {
    expect(await C.items.list()).toEqual([]);
    expect((await rejects(C.items.create(navy))).kind).toBe('refused');
    expect((await rejects(C.wishlist.create({ name: 'x', subType: 'Shirt', note: null }))).kind).toBe('refused');
    expect(await C.feedback.record({ type: 'suggestion_accepted', occasion: 'Work', engine_config: 'gm1', rule_ids: ['R1'] })).toBe(false);
    expect(rowsOf('items', (await cat.auth.getUser()).data.user!.id)).toBe(0);
  });

  let shirt: Awaited<ReturnType<typeof A.items.create>>;
  it('create, read, update, archive and restore through the repository as one user; the database sets the colour', async () => {
    shirt = await A.items.create(navy);
    expect(shirt).toMatchObject({ ...navy, hex: '#00008B', colourFamily: 'Navy' });
    expect(shirt.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(q(`select user_id = :'u' and origin = 'manual' and colour_hex = '#00008B' and colour_family = 'Navy' from app.items where id = :'i'`, { u: annId, i: shirt.id })).toBe('t');
    expect(await A.items.get(shirt.id)).toEqual(shirt);
    expect((await A.items.list()).map((i) => i.id)).toEqual([shirt.id]);

    const changed = await A.items.update(shirt.id, { name: 'Red Shirt', rgb: [220, 20, 20], favourite: false, condition: null, seasons: ['All year'] });
    expect(changed).toMatchObject({ name: 'Red Shirt', colourFamily: 'Red', hex: '#DC1414', favourite: false, condition: null, seasons: ['All year'], subType: 'Shirt' });
    expect(changed!.updatedAt >= shirt.updatedAt).toBe(true);

    const archived = await A.items.archive(shirt.id, 'donated');
    expect(archived).toMatchObject({ status: 'archived', archiveReason: 'donated' });
    expect(q(`select archived_at is not null from app.items where id = :'i'`, { i: shirt.id })).toBe('t');
    expect((await A.items.list())[0]!.status).toBe('archived');
    const restored = await A.items.restore(shirt.id);
    expect(restored).toMatchObject({ status: 'active', archiveReason: null });
    expect(q(`select archived_at is null from app.items where id = :'i'`, { i: shirt.id })).toBe('t');
  });

  it('deleting an item is refused (the database grants no delete) and the row stays', async () => {
    expect((await rejects(A.items.remove(shirt.id))).kind).toBe('unsupported');
    expect(rowsOf('items', annId)).toBe(1);
  });

  it('an unknown or malformed id is "not found", and a patch that changes nothing reads the row', async () => {
    expect(await A.items.get(randomUUID())).toBeUndefined();
    expect(await A.items.update(randomUUID(), { name: 'x' })).toBeUndefined();
    expect(await A.items.get('item-1')).toBeUndefined();
    expect((await A.items.update(shirt.id, {}))?.id).toBe(shirt.id);
  });

  it('every sub-type and every taxonomy value is accepted by the database and reads back unchanged (150 random items in one batch)', async () => {
    const items = fc.sample(itemInput, { numRuns: 150, seed: 7 }).map((i, n) => ({ ...i, name: `rt${n}|${i.name.slice(0, 40)}` }));
    const inserted = await ann.schema('app').from('items').insert(items.map((i) => itemRow(i, annId, '2026-01-01T00:00:00Z')));
    expect(inserted.error).toBeNull();
    const back = new Map((await A.items.list()).map((i) => [i.name, i]));
    for (const i of items) {
      const got = back.get(i.name)!;
      const { id, createdAt, updatedAt, ...rest } = got;
      expect([id, createdAt, updatedAt].every(Boolean)).toBe(true);
      expect(rest, i.name).toEqual(i);
      expect(got.colourFamily).toBe(colourFamily(...i.rgb)); // the database's colour function and the TypeScript one agree
    }
    q(`delete from app.items where user_id = :'u' and name like 'rt%|%'`, { u: annId });
  });

  it('outfits: create, read, update and remove, with score, reasons and a Suit in two slots', async () => {
    const pants = await A.items.create({ ...navy, name: 'Grey Pants', category: 'Bottoms', subType: 'Trousers', rgb: [128, 128, 128], hex: '#808080', colourFamily: 'Grey' });
    const suit = await A.items.create({ ...navy, name: 'Black Suit', category: 'Occasion wear', subType: 'Suit', rgb: [0, 0, 0], hex: '#000000', colourFamily: 'Black' });
    const input: OutfitInput = { occasion: 'Work', items: { ...empty, top: shirt.id, bottom: pants.id }, score: 0.87, reasons: ['Colours go together', 'Fits Work'] };
    const made = await A.outfits.create(input);
    expect(made).toMatchObject(input);
    expect(rowsOf('outfit_items', annId)).toBe(2);
    expect(await A.outfits.get(made.id)).toEqual(made);
    const withSuit = await A.outfits.create({ occasion: 'Formal', items: { ...empty, top: shirt.id, bottom: suit.id, layer: suit.id }, score: null, reasons: [] });
    expect(withSuit.items).toMatchObject({ top: shirt.id, bottom: suit.id, layer: suit.id });
    expect((await A.outfits.list()).map((o) => o.id).sort()).toEqual([made.id, withSuit.id].sort());

    await A.items.archive(pants.id, 'sold'); // archiving an item flags the outfits that hold it (FR-51)
    expect(q(`select count(*) from app.outfits where user_id = :'u' and needs_attention`, { u: annId })).toBe('1');
    const shoes = await A.items.create({ ...navy, name: 'White Sneakers', category: 'Footwear', subType: 'Sneakers', rgb: [255, 255, 255], hex: '#FFFFFF', colourFamily: 'White' });
    const moved = await A.outfits.update(made.id, { occasion: 'Casual', items: { ...empty, top: shirt.id, footwear: shoes.id } });
    expect(moved).toMatchObject({ occasion: 'Casual', items: { top: shirt.id, bottom: null, footwear: shoes.id }, score: 0.87 });
    expect(rowsOf('outfit_items', annId)).toBe(4); // the piece that was dropped is gone, the new one is in
    expect(await A.outfits.update(randomUUID(), { occasion: 'Party' })).toBeUndefined();

    const refused = await rejects(A.outfits.create({ occasion: 'Work', items: { ...empty, bottom: pants.id }, score: null, reasons: [] }));
    expect(refused.kind).toBe('rejected'); // only active items can be in an outfit
    expect(rowsOf('outfits', annId)).toBe(2); // and the failed attempt left no empty outfit behind

    expect(await A.outfits.remove(withSuit.id)).toBe(true);
    expect(await A.outfits.remove(withSuit.id)).toBe(false);
    expect(rowsOf('outfit_items', annId)).toBe(2);
  });

  it('wishlist: the origin is stored, unlock entries count nowhere in the vendor figure, and a family comes back as the same family', async () => {
    const mine = await A.wishlist.create({ name: 'Linen shirt', subType: 'Shirt', colourFamily: 'Beige', origin: 'user', note: 'for summer' });
    const unlock = await A.wishlist.create({ name: 'Navy Chinos', subType: 'Chinos', colourFamily: 'Navy', origin: 'unlock', note: null });
    const multi = await A.wishlist.create({ name: 'Patterned', subType: 'Shirt', colourFamily: 'Multi', note: null });
    expect([mine, unlock, multi].map((w) => [w.origin, w.colourFamily])).toEqual([['user', 'Beige'], ['unlock', 'Navy'], ['user', 'Multi']]);
    expect(q(`select string_agg(origin || ':' || colour_family || ':' || category, ',' order by name) from app.wishlist_entries where user_id = :'u'`, { u: annId })).toBe('user:Beige:Tops,unlock:Navy:Bottoms,user:Multi:Tops');
    expect(wishlistAggregate(await A.wishlist.list())).toMatchObject({ total: 2, excludedUnlock: 1 });
    expect((await A.wishlist.update(mine.id, { note: 'for autumn' }))?.note).toBe('for autumn');
    const log = new EventLog(null);
    const ctx = { occasion: 'Work', date: new Date('2026-04-15T12:00:00Z'), hemisphere: 'north' } as const;
    const entry = { subType: 'Blazer', colourFamily: 'Black', newOutfits: 4, score: 1 } as unknown as UnlockSuggestion;
    expect(await addUnlockToWishlist(A, log, entry, ctx)).toEqual({ added: true });
    expect(await addUnlockToWishlist(A, log, entry, ctx)).toEqual({ added: false });
    expect(q(`select count(*) from app.wishlist_entries where user_id = :'u' and origin = 'unlock' and sub_type = 'Blazer'`, { u: annId })).toBe('1');
    expect(await A.wishlist.remove(multi.id)).toBe(true);
    expect(await A.wishlist.remove(multi.id)).toBe(false);
  });

  it('a second user, who has rows of his own, sees and changes none of the first user\'s rows through the repository', async () => {
    const mine = await B.items.create({ ...navy, name: 'Bob shirt' }); // his own rows make a missing id filter show up: they would come back instead of "not found"
    const myWish = await B.wishlist.create({ name: 'Bob wish', subType: 'Shirt', note: null });
    const myOutfit = await B.outfits.create({ occasion: 'Work', items: { ...empty, top: mine.id }, score: null, reasons: [] });
    const hers = () => q(`select md5(string_agg(i::text, '' order by id)) from app.items i where user_id = :'u'`, { u: annId });
    const before = hers();
    const outfit = (await A.outfits.list())[0]!;
    const wish = (await A.wishlist.list())[0]!;
    expect((await B.items.list()).map((i) => i.id)).toEqual([mine.id]);
    expect((await B.outfits.list()).map((o) => o.id)).toEqual([myOutfit.id]);
    expect((await B.wishlist.list()).map((w) => w.id)).toEqual([myWish.id]);
    expect(await B.items.get(shirt.id)).toBeUndefined();
    expect(await B.outfits.get(outfit.id)).toBeUndefined();
    expect(await B.wishlist.get(wish.id)).toBeUndefined();
    expect(await B.items.update(shirt.id, { name: 'hacked' })).toBeUndefined();
    expect(await B.items.archive(shirt.id, 'lost')).toBeUndefined();
    expect(await B.items.restore(shirt.id)).toBeUndefined();
    expect(await B.outfits.update(outfit.id, { occasion: 'Party' })).toBeUndefined();
    expect(await B.outfits.remove(outfit.id)).toBe(false);
    expect(await B.wishlist.update(wish.id, { name: 'hacked' })).toBeUndefined();
    expect(await B.wishlist.remove(wish.id)).toBe(false);
    const stolen = await rejects(B.outfits.create({ occasion: 'Work', items: { ...empty, top: shirt.id }, score: null, reasons: [] })); // a piece that is not his
    expect(stolen.kind).toBe('rejected');
    expect(rowsOf('outfits', bobId)).toBe(1); // only his own; the failed attempt left nothing
    // his own rows are untouched by those calls, and so are hers
    expect([(await B.items.get(mine.id))?.name, (await B.wishlist.get(myWish.id))?.name, (await B.outfits.get(myOutfit.id))?.occasion]).toEqual(['Bob shirt', 'Bob wish', 'Work']);
    expect(q(`select count(*) from app.items where user_id = :'u' and name = 'hacked'`, { u: annId })).toBe('0');
    expect(q(`select count(*) from app.items where name = 'hacked'`, {})).toBe('0');
    expect(q(`select count(*) from app.wishlist_entries where user_id = :'u'`, { u: annId })).toBe(String((await A.wishlist.list()).length));
    expect(hers()).toBe(before); // every one of her item rows is byte for byte what it was
    expect((await bob.schema('app').from('items').insert({ ...itemRow(navy, annId, 'x') })).error?.code).toBe('42501'); // nor can he write a row for her
    expect((await A.items.list()).some((i) => i.id === mine.id)).toBe(false);
    expect((await A.outfits.list()).some((o) => o.id === myOutfit.id)).toBe(false);
  });

  it('suggestion feedback rows hold the occasion, rule ids, accepted flag and engine string, and no item id or name', async () => {
    const log = new EventLog(null, undefined, () => 'gm1;emb0;pair0;ul:fb;w:base');
    const accept = log.record('suggestion_accepted', { occasion: 'Work', season: 'Spring', ruleIds: ['R1', 'R2', 'ANCHOR'], slot: 'top' });
    const reject = log.record('suggestion_rejected', { occasion: 'Casual', season: 'Summer', ruleIds: [] });
    expect(await A.feedback.record(accept)).toBe(true);
    expect(await A.feedback.record(reject)).toBe(true);
    expect(await A.feedback.record(log.record('suggestion_swapped', { occasion: 'Work', slot: 'bottom' }))).toBe(true); // nothing to send
    expect(await A.feedback.record({ ...accept, engine_config: 'has spaces!' })).toBe(false); // the database refuses it; the caller is told
    const rows = q(`select string_agg((to_jsonb(f) - 'id' - 'created_at' - 'user_id')::text, E'\\n' order by occasion) from app.suggestion_feedback f where user_id = :'u'`, { u: annId }).split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(rows).toEqual([
      { occasion: 'Casual', rule_ids: [], accepted: false, engine_config: 'gm1;emb0;pair0;ul:fb;w:base' },
      { occasion: 'Work', rule_ids: ['R1', 'R2', 'ANCHOR'], accepted: true, engine_config: 'gm1;emb0;pair0;ul:fb;w:base' },
    ]);
    const everything = q(`select string_agg(f::text, ' ') from app.suggestion_feedback f where user_id = :'u'`, { u: annId });
    for (const i of await A.items.list()) { expect(everything).not.toContain(i.id); expect(everything).not.toContain(i.name); }
    expect(q(`select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'app' and table_name = 'suggestion_feedback'`, {})).toBe('id,user_id,occasion,rule_ids,accepted,engine_config,created_at');
    expect((await bob.schema('app').from('suggestion_feedback').select('id')).data ?? []).toEqual([]); // the second user cannot read them
  });

  it('when the network fails nothing is written and the person is told; when the session has ended the same', async () => {
    const down = { on: false };
    const flaky = createClient(stack!.url, stack!.key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (...a: Parameters<typeof fetch>) => (down.on ? Promise.reject(new TypeError('network down')) : fetch(...a)) } });
    expect((await flaky.auth.signInWithPassword({ email: email.ann, password: pw })).error).toBeNull();
    const F = new SupabaseRepository(flaky);
    const count = rowsOf('items', annId);
    expect((await F.items.list()).length).toBe(count);
    down.on = true;
    const e = await rejects(F.items.create({ ...navy, name: 'Lost?' }));
    expect([e.kind, messageOf(e)]).toEqual(['network', expect.stringMatching(/your change was not saved/)]);
    expect((await rejects(F.items.list())).kind).toBe('network'); // an error, not an empty wardrobe
    expect((await rejects(F.outfits.create({ occasion: 'Work', items: { ...empty, top: shirt.id }, score: null, reasons: [] }))).kind).toBe('network');
    expect(await F.feedback.record({ type: 'suggestion_accepted', occasion: 'Work', engine_config: 'gm1', rule_ids: [] })).toBe(false);
    expect(rowsOf('items', annId)).toBe(count);
    down.on = false;
    expect((await F.items.create({ ...navy, name: 'Saved after retry' })).name).toBe('Saved after retry'); // the same call works once the network is back
    expect((await flaky.auth.signOut()).error).toBeNull();
    const ended = await rejects(F.items.create({ ...navy, name: 'After sign-out' }));
    expect([ended.kind, ended.message]).toEqual(['session', expect.stringMatching(/Sign in again/)]);
    expect(rowsOf('items', annId)).toBe(count + 1);
    expect(q(`select count(*) from app.items where user_id = :'u' and name in ('Lost?', 'After sign-out')`, { u: annId })).toBe('0');
  });
});
