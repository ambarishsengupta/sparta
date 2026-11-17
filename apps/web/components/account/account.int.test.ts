import { randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ItemInput } from '../../lib/repository';
import { signInWithEmail } from '../../lib/supabase/auth-actions';
import { decideRoute } from '../../lib/supabase/gate';
import { loadGateState } from '../../lib/supabase/gate-state';
import { SupabaseRepository } from '../../lib/supabase/repository';
import { cleanup, discover, lockStack, makeReady, newClient, provisionUser, sql } from '../../test-support/stack';
import { exportMyData, leaveThePilot, readProfile, saveProfile, type LeaveResult } from './account-actions';

// Integration suite against the REAL local stack (R2c CC3): Export my data and Leave the pilot as the screens call them, with three real people
// (two in the supported country, one in an unsupported country). The URL and publishable key are read from `supabase status` at run time and never
// written anywhere. Setup and checks use `docker exec ... psql` on the local database container only. Skips, with a message, when the stack is not running.
const stack = discover();
if (!stack) console.warn('SKIPPED account.int.test.ts: the local Supabase stack (or its database container) is not running. Start it with `supabase start`.');
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

const shirt = (name: string): ItemInput => ({
  name, category: 'Tops', subType: 'Shirt', rgb: [0, 0, 139], hex: '#00008B', colourFamily: 'Navy', fit: 'Regular', material: 'Cotton', pattern: 'Solid',
  seasons: ['Spring'], occasions: ['Work'], condition: 20, favourite: false, neverWorn: false, status: 'active', archiveReason: null,
});
const jeans = (name: string): ItemInput => ({ ...shirt(name), category: 'Bottoms', subType: 'Jeans', rgb: [27, 27, 27], hex: '#1B1B1B', colourFamily: 'Black' });

describe.skipIf(!stack)('Export my data and Leave the pilot against the real stack', () => {
  const run = randomUUID().slice(0, 8);
  const email = { ann: `it-${run}-xann@example.test`, bob: `it-${run}-xbob@example.test`, cat: `it-${run}-xcat@example.test` };
  const pw = randomBytes(12).toString('base64url');
  const mailIds: string[] = [];
  let ann: SupabaseClient; let bob: SupabaseClient; let cat: SupabaseClient;
  let annId = ''; let bobId = ''; let catId = '';
  let tables: string[] = [];
  const BOB_ITEM = `Bobs-private-${run}`;
  const ANN_ITEM = `Anns-shirt-${run}`;

  const q = (text: string, vars: Record<string, string> = {}) => sql(text, vars);
  const ownerCol = (t: string) => (t === 'profiles' ? 'id' : 'user_id');
  const rowsOf = (t: string, user: string) => Number(q(`select count(*) from app.${t} where ${ownerCol(t)} = :'u'`, { u: user }));
  const totals = (user: string) => Object.fromEntries(tables.map((t) => [t, rowsOf(t, user)]));
  const userExists = (id: string) => q(`select count(*) from auth.users where id = :'u'`, { u: id }) === '1';
  const deletions = () => Number(q(`select coalesce(sum(n), 0) from ops.daily_counts where metric = 'deletions' and day = current_date`));
  const setting = (key: string) => q(`select value from ops.settings where key = :'k'`, { k: key });
  const exportOf = async (c: SupabaseClient) => { const out = await exportMyData(c); if (!out.ok) throw new Error(out.message); return { text: out.text, doc: JSON.parse(out.text) as Record<string, Record<string, unknown>[] & { id?: string; email?: string }>, filename: out.filename }; };

  let unlock: (() => void) | undefined;
  beforeAll(async () => {
    unlock = await lockStack();
    [ann, bob, cat] = [await provisionUser(stack!, email.ann, pw, mailIds), await provisionUser(stack!, email.bob, pw, mailIds), await provisionUser(stack!, email.cat, pw, mailIds)];
    [annId, bobId, catId] = (await Promise.all([ann, bob, cat].map((c) => c.auth.getUser()))).map((r) => r.data.user!.id) as [string, string, string];
    await makeReady(ann, 'IN'); await makeReady(bob, 'IN'); await makeReady(cat, 'US');
    tables = q(`select relname from pg_class where relnamespace = 'app'::regnamespace and relkind in ('r', 'p') order by 1`).split('\n');
    // each ready person gets a wardrobe, an outfit and a wishlist entry through the same repository the screens use
    for (const [client, label] of [[ann, ANN_ITEM], [bob, BOB_ITEM]] as const) {
      const repo = new SupabaseRepository(client);
      const top = await repo.items.create(shirt(label));
      const bottom = await repo.items.create(jeans(`${label}-jeans`));
      await repo.outfits.create({ occasion: 'Work', items: { top: top.id, bottom: bottom.id, layer: null, footwear: null, accessory: null }, score: null, reasons: [] });
      await repo.wishlist.create({ name: `${label}-wish`, subType: 'Shirt', colourFamily: 'Beige', origin: 'user', note: null });
    }
  });
  afterAll(async () => {
    try {
      for (const e of Object.values(email)) {
        const found = (await (await fetch(`${stack!.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${e}`)}`)).json()) as { messages: { ID: string }[] };
        for (const m of found.messages) if (!mailIds.includes(m.ID)) mailIds.push(m.ID);
      }
      await cleanup(stack!, Object.values(email), mailIds);
    } finally { unlock?.(); }
  });

  it('the setup is what the tests assume: three people, tables found from the catalog, data for the two ready people, none for the held one', () => {
    expect(tables).toEqual(expect.arrayContaining(['profiles', 'items', 'outfits', 'outfit_items', 'wishlist_entries', 'consent_records', 'document_acceptances']));
    expect(tables.length).toBeGreaterThanOrEqual(15);
    expect(rowsOf('items', annId)).toBe(2);
    expect(rowsOf('items', bobId)).toBe(2);
    expect(rowsOf('outfits', annId)).toBe(1);
    expect(rowsOf('wishlist_entries', bobId)).toBe(1);
    expect(rowsOf('items', catId)).toBe(0);
  });

  it('Export returns the caller\'s data and only theirs, in a file named by date only', async () => {
    const a = await exportOf(ann);
    expect(a.doc.format_version).toBe(1);
    expect(a.doc.account).toMatchObject({ id: annId, email: email.ann });
    expect(a.filename).toMatch(/^sparta-export-\d{4}-\d{2}-\d{2}\.json$/);
    // one key per table of the app schema, with the number of rows the database holds for the caller
    for (const t of tables) expect(a.doc[t], t).toHaveLength(rowsOf(t, annId));
    expect(a.doc.items!.map((i) => (i as { name: string }).name).sort()).toEqual([ANN_ITEM, `${ANN_ITEM}-jeans`]);
    // every row in every table belongs to the caller; nothing of the other person appears anywhere in the text
    for (const t of tables) for (const row of a.doc[t]!) expect((row as Record<string, unknown>)[ownerCol(t)], t).toBe(annId);
    for (const secret of [bobId, email.bob, BOB_ITEM, catId, email.cat]) expect(a.text.includes(secret), secret).toBe(false);
    expect(a.text.includes('password')).toBe(false);
  });

  it('the second person gets their own export, with none of the first person\'s data', async () => {
    const b = await exportOf(bob);
    expect(b.doc.account).toMatchObject({ id: bobId, email: email.bob });
    for (const t of tables) expect(b.doc[t], t).toHaveLength(rowsOf(t, bobId));
    for (const secret of [annId, email.ann, ANN_ITEM, catId]) expect(b.text.includes(secret), secret).toBe(false);
    expect(b.text.includes(BOB_ITEM)).toBe(true);
  });

  it('a person held at not-available can export: the profile and the agreements are in it', async () => {
    expect(await loadGateState(cat)).toBe('not_available');
    const c = await exportOf(cat);
    expect(c.doc.account).toMatchObject({ id: catId, email: email.cat });
    expect(c.doc.profiles).toHaveLength(1);
    expect((c.doc.profiles![0] as { country: string }).country).toBe('US');
    expect(c.doc.document_acceptances).toHaveLength(2);
    expect(c.doc.consent_records).toHaveLength(1);
    for (const secret of [annId, bobId, ANN_ITEM, BOB_ITEM]) expect(c.text.includes(secret), secret).toBe(false);
  });

  it('a person whose notice is out of date, who therefore sees no wardrobe through the gate, can still export all of it', async () => {
    const old = setting('current_notice_version');
    try {
      q(`update ops.settings set value = :'v' where key = 'current_notice_version'`, { v: `${old}-next` });
      expect(await loadGateState(ann)).toBe('needs_pilot_notice');
      expect((await ann.schema('app').from('items').select('id')).data ?? []).toEqual([]);
      expect(decideRoute('needs_pilot_notice', '/leave')).toEqual({ action: 'allow' });
      const a = await exportOf(ann);
      expect(a.doc.items).toHaveLength(2);
    } finally { q(`update ops.settings set value = :'v' where key = 'current_notice_version'`, { v: old }); }
    expect(await loadGateState(ann)).toBe('ready');
  });

  it('a person who is not signed in cannot export or delete; nothing changes', async () => {
    const before = { users: q('select count(*) from auth.users'), deletions: deletions() };
    const anon = newClient(stack!);
    const out = await exportMyData(anon);
    expect(out.ok).toBe(false);
    expect((await anon.schema('app').rpc('delete_my_account')).error).not.toBeNull();
    expect(await leaveThePilot(anon, pw)).toEqual({ ok: false, reason: 'session', message: expect.stringContaining('nothing was deleted') });
    expect({ users: q('select count(*) from auth.users'), deletions: deletions() }).toEqual(before);
  });

  it('settings: a person changes their own display name, hemisphere, currency and occasions, and reads them back', async () => {
    expect(await readProfile(bob)).toMatchObject({ country: 'IN', hemisphere: 'north', currency: 'USD' });
    expect(await saveProfile(bob, { display_name: 'Bob B', hemisphere: 'south', currency: 'USD', occasions: ['Casual', 'Work'] })).toEqual({ ok: true });
    expect(await readProfile(bob)).toEqual({ displayName: 'Bob B', country: 'IN', hemisphere: 'south', currency: 'USD', occasions: ['Casual', 'Work'] });
    expect(q(`select display_name || ',' || hemisphere || ',' || currency || ',' || country from app.profiles where id = :'u'`, { u: bobId })).toBe('Bob B,south,USD,IN');
    expect(await saveProfile(bob, { display_name: null, hemisphere: 'north', currency: 'INR', occasions: [] })).toEqual({ ok: true });
    expect((await readProfile(bob))!.displayName).toBe('');
  });

  it('settings: bad values are refused by the database and change nothing; protected columns and other people\'s profiles cannot be changed', async () => {
    const before = q(`select display_name || currency from app.profiles where id = :'u'`, { u: bobId });
    expect((await saveProfile(bob, { display_name: 'x', hemisphere: 'north', currency: 'XX', occasions: [] })).ok).toBe(false);
    expect((await saveProfile(bob, { display_name: 'x', hemisphere: 'north', currency: 'INR', occasions: ['Nonsense'] })).ok).toBe(false);
    expect(q(`select display_name || currency from app.profiles where id = :'u'`, { u: bobId })).toBe(before);
    expect((await bob.schema('app').from('profiles').update({ role: 'admin' }).eq('id', bobId)).error?.code).toBe('42501');
    expect((await bob.schema('app').from('profiles').update({ deleting: true }).eq('id', bobId)).error?.code).toBe('42501');
    const other = await ann.schema('app').from('profiles').update({ display_name: 'hacked' }).eq('id', bobId).select('id');
    expect(other.data ?? []).toEqual([]);
    expect(q(`select count(*) from app.profiles where display_name = 'hacked'`)).toBe('0');
  });

  it('Leave the pilot: an empty or wrong password deletes nothing and leaves the session working', async () => {
    const before = { totals: totals(annId), deletions: deletions() };
    expect(await leaveThePilot(ann, '')).toMatchObject({ ok: false, reason: 'credentials' });
    const wrong = await leaveThePilot(ann, `${pw}-wrong`);
    expect(wrong).toEqual({ ok: false, reason: 'credentials', message: expect.stringContaining('nothing was deleted') });
    expect(JSON.stringify(wrong)).not.toContain(pw);
    expect(userExists(annId)).toBe(true);
    expect({ totals: totals(annId), deletions: deletions() }).toEqual(before);
    expect((await ann.auth.getUser()).data.user?.id).toBe(annId);
    expect(await loadGateState(ann)).toBe('ready');
  });

  it('the delete function cannot be pointed at another person: it takes no argument, and the caller\'s password only opens the caller\'s account', async () => {
    const withTarget = await bob.schema('app').rpc('delete_my_account', { p_user: annId });
    expect(withTarget.error).not.toBeNull();
    expect(userExists(annId)).toBe(true);
    expect(userExists(bobId)).toBe(true);
    // ann's password does not open bob's account: the sign-in the flow makes is for the signed-in person's own email
    expect(await signInWithEmail(newClient(stack!), email.bob, `${pw}-other`)).toMatchObject({ ok: false });
  });

  describe('after the first person leaves', () => {
    let token = '';
    let confirmationToken = '';
    let before = { bob: {} as Record<string, number>, deletions: 0, bobExport: '' };
    let result: LeaveResult;
    beforeAll(async () => {
      // WO-0062: the token captured here used to be the one from the sign-up confirmation link. The database now wants a password (or other primary) sign-in in the token,
      // so the retry below uses a token from a fresh password sign-in, which is what a person who just typed the password again holds; the confirmation token is kept to show it is refused.
      confirmationToken = (await ann.auth.getSession()).data.session!.access_token;
      expect((await ann.auth.signInWithPassword({ email: email.ann, password: pw })).error).toBeNull();
      token = (await ann.auth.getSession()).data.session!.access_token;
      before = { bob: totals(bobId), deletions: deletions(), bobExport: (await exportOf(bob)).text.replace(/"generated_at": "[^"]+"/, '') };
      result = await leaveThePilot(ann, pw);
    });

    it('the delete after re-entering the password succeeds', () => { expect(result).toEqual({ ok: true, result: 'deleted' }); });

    it('the user, the profile and every row in every app table are gone, and the invitation entry with them', () => {
      expect(userExists(annId)).toBe(false);
      for (const t of tables) expect(rowsOf(t, annId), t).toBe(0);
      expect(q(`select count(*) from ops.invitations where email = :'e'`, { e: email.ann })).toBe('0');
      expect(q(`select count(*) from auth.sessions where user_id = :'u'`, { u: annId })).toBe('0');
      expect(q(`select count(*) from auth.identities where user_id = :'u'`, { u: annId })).toBe('0');
    });

    it('signing in again fails, with the plain wrong-credentials message, and the old session is of no use', async () => {
      expect(await signInWithEmail(newClient(stack!), email.ann, pw)).toEqual({ ok: false, message: 'That email and password do not match. Check them and try again.' });
      expect((await newClient(stack!).auth.getUser(token)).data.user).toBeNull();
      expect(await loadGateState(ann)).toBe('unauthenticated');
      expect(decideRoute('unauthenticated', '/settings')).toEqual({ action: 'redirect', to: '/sign-in?next=%2Fsettings' });
    });

    it('only a count was recorded: one more deletion today, in a table that holds a day, a metric and a number', () => {
      expect(deletions()).toBe(before.deletions + 1);
      expect(q(`select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'ops' and table_name = 'daily_counts'`)).toBe('day,metric,n');
      expect(q(`select count(*) from ops.daily_counts where metric ilike '%' || :'e' || '%' or metric ilike '%' || :'u' || '%'`, { e: email.ann, u: annId })).toBe('0');
    });

    it('the second person is unaffected: same rows, same export, can still sign in, still ready', async () => {
      expect(userExists(bobId)).toBe(true);
      expect(totals(bobId)).toEqual(before.bob);
      expect((await exportOf(bob)).text.replace(/"generated_at": "[^"]+"/, '')).toBe(before.bobExport);
      expect(await signInWithEmail(newClient(stack!), email.bob, pw)).toEqual({ ok: true });
      expect(await loadGateState(bob)).toBe('ready');
      expect((await new SupabaseRepository(bob).items.list()).map((i) => i.name).sort()).toEqual([BOB_ITEM, `${BOB_ITEM}-jeans`]);
    });

    it('asking again is harmless: the old token reaches the function once more and gets "already_deleted", with nothing counted', async () => {
      const old = createClient(stack!.url, stack!.key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
      const again = await old.schema('app').rpc('delete_my_account');
      expect(again.error).toBeNull();
      expect(again.data).toBe('already_deleted');
      const viaLink = createClient(stack!.url, stack!.key, { global: { headers: { Authorization: `Bearer ${confirmationToken}` } }, auth: { persistSession: false, autoRefreshToken: false } });
      expect((await viaLink.schema('app').rpc('delete_my_account')).error?.message).toBe('reauthentication_required');
      expect(deletions()).toBe(before.deletions + 1);
      expect(await leaveThePilot(newClient(stack!), pw)).toMatchObject({ ok: false, reason: 'session' });
    });
  });

  it('a person held at not-available can leave the pilot too, with the same result', async () => {
    const days = deletions();
    expect(await leaveThePilot(cat, pw)).toEqual({ ok: true, result: 'deleted' });
    expect(userExists(catId)).toBe(false);
    for (const t of tables) expect(rowsOf(t, catId), t).toBe(0);
    expect(deletions()).toBe(days + 1);
    expect(await signInWithEmail(newClient(stack!), email.cat, pw)).toMatchObject({ ok: false });
    expect(userExists(bobId)).toBe(true);
  });

  it('the last person leaves the same way, and no row of any of the three is left anywhere in app', async () => {
    expect(await leaveThePilot(bob, pw)).toEqual({ ok: true, result: 'deleted' });
    for (const id of [annId, bobId, catId]) { expect(userExists(id)).toBe(false); for (const t of tables) expect(rowsOf(t, id), `${t} ${id}`).toBe(0); }
    for (const e of Object.values(email)) expect(q(`select count(*) from auth.users where email = :'e'`, { e })).toBe('0');
  });
});
