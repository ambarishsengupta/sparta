import { AuthRetryableFetchError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { LocalRepository } from '../local-repository';
import type { ItemInput, OutfitInput, WardrobeRepository } from '../repository';
import { blockedRepository, pickBackend, selectRepository } from './backend';
import { RepositoryError, attempt, classify, messageOf } from './errors';
import type { GateState } from './gate';
import { SupabaseRepository } from './repository';

// Unit tests over a fake client: the requests the repository makes, and what it does when the network or the session fails (WO-0052).
type Call = { schema: string; table: string; steps: [string, unknown[]][] };
type Answer = { data: unknown; error: { code?: string; message?: string; name?: string } | null; status?: number };
const OK: Answer = { data: null, error: null, status: 200 };
const builder = (call: Call, answer: (c: Call) => Answer): unknown => new Proxy({}, {
  get: (_t, prop) => (prop === 'then'
    ? (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => new Promise((ok) => ok(answer(call))).then(res, rej)
    : (...args: unknown[]) => { call.steps.push([String(prop), args]); return builder(call, answer); }),
});
function fake(answer: (c: Call) => Answer = () => OK, session: { user: { id: string } } | null = { user: { id: 'u1' } }) {
  const calls: Call[] = [];
  const client = {
    auth: { getSession: async () => ({ data: { session }, error: null }) },
    schema: (schema: string) => ({ from: (table: string) => { const call = { schema, table, steps: [] as Call['steps'] }; calls.push(call); return builder(call, answer); } }),
  } as unknown as SupabaseClient;
  return { repo: new SupabaseRepository(client, () => 'NOW'), calls };
}
const sent = (calls: Call[]) => calls.filter((c) => c.steps.length > 0); // a table handle taken but never used sends nothing
const step = (c: Call, name: string) => c.steps.find((s) => s[0] === name)?.[1][0];
const fail = (status: number, code = '', message = 'secret table app.items detail'): Answer => ({ data: null, error: { code, message }, status });
const UUID = '5c1b3b52-0000-4000-8000-000000000001';
const item: ItemInput = {
  name: 'Navy Shirt', category: 'Tops', subType: 'Shirt', rgb: [0, 0, 139], hex: '#00008B', colourFamily: 'Navy', fit: null, material: null, pattern: null,
  seasons: ['All year'], occasions: ['Work'], condition: null, favourite: false, neverWorn: false, status: 'active', archiveReason: null,
};
const outfit: OutfitInput = { occasion: 'Work', items: { top: UUID, bottom: null, layer: null, footwear: null, accessory: null }, score: 1, reasons: ['a'] };
const rejects = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as RepositoryError; } throw new Error('did not reject'); };

describe('requests', () => {
  it('create sends the mapped row for the signed-in person, without colour hex or family, and reads the row back', async () => {
    const { repo, calls } = fake();
    await rejects(repo.items.create(item)); // the fake answers with no row: the call fails loudly instead of returning nothing
    const row = step(calls[0]!, 'insert') as Record<string, unknown>;
    expect(calls[0]).toMatchObject({ schema: 'app', table: 'items' });
    expect(row).toMatchObject({ user_id: 'u1', origin: 'manual', sub_type: 'Shirt', colour_b: 139 });
    expect(Object.keys(row)).not.toContain('colour_hex');
    expect(Object.keys(row)).not.toContain('colour_family');
  });
  it('archive and restore are single updates by id with the reason and the clock', async () => {
    const { repo, calls } = fake();
    await repo.items.archive(UUID, 'sold');
    await repo.items.restore(UUID);
    expect(step(calls[0]!, 'update')).toEqual({ status: 'archived', archive_reason: 'sold', archived_at: 'NOW' });
    expect(step(calls[1]!, 'update')).toEqual({ status: 'active', archive_reason: null, archived_at: null });
    expect(calls[0]!.steps.find((s) => s[0] === 'eq')![1]).toEqual(['id', UUID]);
  });
  it('an id that is not a uuid is "not found" without a request; an empty patch reads instead of writing', async () => {
    const { repo, calls } = fake();
    expect(await repo.items.get('item-1')).toBeUndefined();
    expect(await repo.items.update('item-1', { favourite: true })).toBeUndefined();
    expect(await repo.items.archive('item-1', 'sold')).toBeUndefined();
    expect(await repo.wishlist.remove('x')).toBe(false);
    expect(sent(calls)).toEqual([]);
    await repo.items.update(UUID, { hex: '#000000' });
    expect(calls[0]!.steps.map((s) => s[0])).toEqual(['select', 'eq', 'maybeSingle']);
  });
  it('deleting an item is refused with a plain sentence and no request (the database grants no delete on items)', async () => {
    const { repo, calls } = fake();
    const e = await rejects(repo.items.remove(UUID));
    expect([e.kind, e.message]).toEqual(['unsupported', expect.stringMatching(/Archive it instead/)]);
    expect(sent(calls)).toEqual([]);
  });
  it('an outfit whose pieces cannot be stored is removed again and the person is told; no empty outfit is left', async () => {
    const { repo, calls } = fake((c) => (c.table === 'outfits' && c.steps.some((s) => s[0] === 'insert') ? { data: { id: UUID }, error: null, status: 201 } : c.table === 'outfit_items' ? fail(409, '23505') : OK));
    const e = await rejects(repo.outfits.create(outfit));
    expect(e.kind).toBe('rejected');
    expect(calls.some((c) => c.table === 'outfits' && c.steps.some((s) => s[0] === 'delete'))).toBe(true);
  });
});

describe('failures are said, never swallowed (no silent data loss)', () => {
  const network = fail(0, '', 'TypeError: network down');
  it.each([
    ['network', network, /Could not reach the server, so your change was not saved/],
    ['session', fail(401, 'PGRST301'), /Your session has ended, so your change was not saved/],
    ['refused', fail(403, '42501'), /not allowed to do that, so your change was not saved/],
    ['rejected', fail(400, '23514'), /did not accept those details/],
    ['unexpected', fail(500, 'XX000'), /Something went wrong, so your change was not saved/],
  ] as const)('a %s failure on create rejects with its own sentence and never shows server text', async (kind, answer, text) => {
    const { repo } = fake(() => answer);
    for (const run of [() => repo.items.create(item), () => repo.outfits.create(outfit), () => repo.wishlist.create({ name: 'n', subType: 'Shirt', note: null }), () => repo.items.archive(UUID, 'lost')]) {
      const e = await rejects(run());
      expect(e).toBeInstanceOf(RepositoryError);
      expect([e.kind, e.message]).toEqual([kind, expect.stringMatching(text)]);
      expect(e.message).not.toMatch(/secret|app\.items|table/);
    }
  });
  it('a failed read rejects too, so the screen cannot show an empty wardrobe for a network failure', async () => {
    const { repo } = fake(() => network);
    for (const run of [() => repo.items.list(), () => repo.items.get(UUID), () => repo.outfits.list(), () => repo.wishlist.list()]) {
      const e = await rejects(run());
      expect(e.message).toMatch(/Could not reach the server to load your data/);
      expect(e.message).not.toMatch(/not saved/);
    }
  });
  it('a request that throws (the browser could not send it) is a network failure', async () => {
    const { repo } = fake(() => { throw new TypeError('x'); });
    expect((await rejects(repo.items.list())).kind).toBe('network');
  });
  it('with no session nothing is written and the person is told to sign in', async () => {
    const { repo, calls } = fake(() => OK, null);
    const e = await rejects(repo.items.create(item));
    expect([e.kind, e.message]).toEqual(['session', expect.stringMatching(/Sign in again/)]);
    expect(sent(calls)).toEqual([]);
  });
  it('classify and messageOf: fixed sentences for each kind; a plain error is "unexpected"; a TypeError is the network', () => {
    expect(classify({ status: 0, error: {} }, true).kind).toBe('network');
    expect(classify({ status: 500, error: { name: 'AuthRetryableFetchError' } }, true).kind).toBe('network');
    expect(classify({ status: 400, error: { message: 'JWT expired' } }, true).kind).toBe('session');
    expect(messageOf(new Error('boom'))).toMatch(/Something went wrong/);
    expect(messageOf(new TypeError('x'), false)).toMatch(/Could not reach the server to load/);
  });
});

describe('attempt: what the screens use around every change', () => {
  it('null when the change worked; the sentence when it failed, for a repository error, a thrown TypeError or anything else', async () => {
    expect(await attempt(async () => 1)).toBeNull();
    expect(await attempt(() => Promise.reject(new RepositoryError('network', true)))).toMatch(/your change was not saved/);
    expect(await attempt(() => { throw new TypeError('x'); })).toMatch(/Could not reach the server/);
    expect(await attempt(() => Promise.reject(new Error('internal detail')))).not.toMatch(/internal detail/);
  });
});

describe('suggestion feedback', () => {
  const facts = { type: 'suggestion_accepted', occasion: 'Work', engine_config: 'gm1;emb0;pair0;ul:fb;w:base', rule_ids: ['R1', 'R2'] };
  it('inserts one row with the occasion, rule ids, accepted flag and engine string; nothing else', async () => {
    const { repo, calls } = fake();
    expect(await repo.feedback.record({ ...facts, itemId: UUID, name: 'Navy Shirt' } as typeof facts)).toBe(true);
    expect(calls[0]).toMatchObject({ schema: 'app', table: 'suggestion_feedback' });
    expect(step(calls[0]!, 'insert')).toEqual({ user_id: 'u1', occasion: 'Work', rule_ids: ['R1', 'R2'], accepted: true, engine_config: facts.engine_config });
  });
  it('a failure returns false and does not throw; other event types and a missing session send nothing', async () => {
    expect(await fake(() => fail(0)).repo.feedback.record(facts)).toBe(false);
    const { repo, calls } = fake();
    expect(await repo.feedback.record({ ...facts, type: 'suggestion_swapped' })).toBe(true);
    expect(sent(calls)).toEqual([]);
    expect(await fake(() => OK, null).repo.feedback.record(facts)).toBe(false);
  });
});

describe('the backend switch', () => {
  const states: (GateState | null)[] = ['unauthenticated', 'needs_email_confirmation', 'needs_documents', 'needs_pilot_notice', 'needs_onboarding', 'not_available', 'ready', null];
  it('local unless the app is set to supabase; supabase only for a ready person; blocked (never local) for everyone else', () => {
    for (const s of states) {
      expect(pickBackend('local', s)).toBe('local');
      expect(pickBackend('supabase', s)).toBe(s === 'ready' ? 'supabase' : 'blocked');
    }
  });
  it('a blocked repository fails every call with the sentence for its kind', async () => {
    const repo = blockedRepository('session');
    const calls = [repo.items.list(), repo.items.get('a'), repo.items.create(item), repo.items.update('a', {}), repo.items.remove('a'), repo.items.archive('a', 'sold'), repo.items.restore('a'), repo.outfits.list(), repo.outfits.create(outfit), repo.wishlist.list()];
    for (const c of calls) expect((await rejects(c)).kind).toBe('session');
  });
  const local = () => new LocalRepository(null) as WardrobeRepository;
  const clientFor = (user: boolean | 'down') => (() => ({
    auth: { getUser: async () => (user === 'down' ? { data: { user: null }, error: new AuthRetryableFetchError('down', 0) } : { data: { user: user ? { email_confirmed_at: 'T' } : null }, error: null }) },
    schema: () => ({ from: () => builder({ schema: '', table: '', steps: [] }, () => ({ data: { role: 'consumer', age_confirmed: true, country: 'IN' }, error: null })), rpc: async () => ({ data: true, error: null }) }),
  }) as unknown as SupabaseClient);
  it('selectRepository: local never makes a client; a ready person gets the account repository; signed out or unreachable gets a blocked one', async () => {
    const never = () => { throw new Error('client made'); };
    const l = local();
    expect(await selectRepository('local', never, () => l)).toBe(l);
    expect(await selectRepository('supabase', clientFor(true), local)).toBeInstanceOf(SupabaseRepository);
    expect((await rejects((await selectRepository('supabase', clientFor(false), local)).items.list())).kind).toBe('session');
    expect((await rejects((await selectRepository('supabase', clientFor('down'), local)).items.list())).kind).toBe('network');
  });
});
