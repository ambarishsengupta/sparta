/**
 * Set-up and clean-up for the R2c browser run (CC5). Not part of the app and not run by the gate; run by hand with
 *   npx tsx workflow/evidence/R2c/evidence-users.ts create|state|clean <creds-file-outside-the-repository>
 * It creates three real users on the LOCAL stack through the same sign-up, Mailpit confirmation, acceptance and onboarding calls the screens make
 * (test-support/stack.ts), so the browser run can start from "signed out, with an account". The generated password goes only to the creds file.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { SupabaseRepository } from '../../../apps/web/lib/supabase/repository';
import { cleanup, discover, makeReady, provisionUser, sql } from '../../../apps/web/test-support/stack';

const [cmd, credsFile] = process.argv.slice(2);
const stack = discover();
if (!stack || !credsFile || !['create', 'state', 'clean'].includes(cmd ?? '')) throw new Error('usage: evidence-users.ts create|state|clean <creds-file>; the local stack must be running');
const item = (name: string, subType: string, category: string, rgb: [number, number, number], hex: string, colourFamily: string) => ({
  name, category, subType, rgb, hex, colourFamily, fit: null, material: null, pattern: null, seasons: ['Spring'], occasions: ['Work'], condition: null,
  favourite: false, neverWorn: false, status: 'active' as const, archiveReason: null,
});

async function create() {
  const run = randomBytes(3).toString('hex');
  const creds = { run, pw: randomBytes(12).toString('base64url'), a: `evidence-r2c-${run}-a@example.test`, b: `evidence-r2c-${run}-b@example.test`, c: `evidence-r2c-${run}-c@example.test`, mailIds: [] as string[] };
  writeFileSync(credsFile!, JSON.stringify(creds)); // written first, so a crash still leaves what clean needs
  const [a, b, c] = [await provisionUser(stack!, creds.a, creds.pw, creds.mailIds), await provisionUser(stack!, creds.b, creds.pw, creds.mailIds), await provisionUser(stack!, creds.c, creds.pw, creds.mailIds)];
  writeFileSync(credsFile!, JSON.stringify(creds));
  await makeReady(a, 'IN'); await makeReady(b, 'IN'); await makeReady(c, 'US');
  for (const [client, tag] of [[a, 'Anika'], [b, 'Bruno']] as const) {
    const repo = new SupabaseRepository(client);
    const top = await repo.items.create(item(`${tag} navy shirt`, 'Shirt', 'Tops', [0, 0, 139], '#00008B', 'Navy'));
    const bottom = await repo.items.create(item(`${tag} black jeans`, 'Jeans', 'Bottoms', [27, 27, 27], '#1B1B1B', 'Black'));
    await repo.outfits.create({ occasion: 'Work', items: { top: top.id, bottom: bottom.id, layer: null, footwear: null, accessory: null }, score: null, reasons: [] });
    await repo.wishlist.create({ name: `${tag} linen shirt`, subType: 'Shirt', colourFamily: 'Beige', origin: 'user', note: null });
  }
  console.log('created 3 users: A and B (country IN, ready, with data), C (country US, held at not-available)');
}

function state() {
  const creds = JSON.parse(readFileSync(credsFile!, 'utf8')) as Record<string, string>;
  const tables = sql(`select relname from pg_class where relnamespace = 'app'::regnamespace and relkind in ('r', 'p') order by 1`).split('\n');
  for (const who of ['a', 'b', 'c'] as const) {
    const id = sql(`select coalesce((select id::text from auth.users where email = :'e'), 'none')`, { e: creds[who]! });
    const rows = id === 'none' ? 0 : tables.reduce((n, t) => n + Number(sql(`select count(*) from app.${t} where ${t === 'profiles' ? 'id' : 'user_id'} = :'u'`, { u: id })), 0);
    const invited = sql(`select count(*) from ops.invitations where email = :'e'`, { e: creds[who]! });
    console.log(`${who.toUpperCase()}: account ${id === 'none' ? 'GONE' : 'exists'}; rows in app tables: ${rows}; invitation rows: ${invited}`);
  }
  console.log(`deletions counted today: ${sql(`select coalesce(sum(n), 0) from ops.daily_counts where metric = 'deletions' and day = current_date`)}`);
}

async function clean() {
  const creds = JSON.parse(readFileSync(credsFile!, 'utf8')) as { a: string; b: string; c: string; mailIds: string[] };
  for (const e of [creds.a, creds.b, creds.c]) {
    const found = (await (await fetch(`${stack!.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${e}`)}`)).json()) as { messages: { ID: string }[] };
    for (const m of found.messages) if (!creds.mailIds.includes(m.ID)) creds.mailIds.push(m.ID);
  }
  await cleanup(stack!, [creds.a, creds.b, creds.c], creds.mailIds);
  console.log(`clean: users and invitations removed, ${creds.mailIds.length} Mailpit messages removed; users left: ${sql(`select count(*) from auth.users where email like 'evidence-r2c-%'`)}`);
}

await ({ create, state, clean } as Record<string, () => unknown>)[cmd!]!();
