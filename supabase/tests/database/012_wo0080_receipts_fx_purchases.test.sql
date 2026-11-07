-- WO-0080 (R6a) / CC2: receipts, purchase links, exchange rates, wishlist bought, receipt confirmation, the 7-day receipt-job purge, export
-- and deletion coverage. Users: A and B are eligible consumers, C has no consent. fx_role is exercised inside this rolled-back transaction.
begin;
\ir helpers.inc
select plan(217);

grant fx_role to postgres with set true, inherit false;
grant worker_role to postgres with set true, inherit false;
select pg_temp.mk_user(pg_temp.ua());
select pg_temp.mk_user(pg_temp.ub());
select pg_temp.mk_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
select pg_temp.make_eligible(pg_temp.ua());
select pg_temp.make_eligible(pg_temp.ub());

create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return 'ok'; exception when others then return 'err=' || sqlstate; end $f$;
-- a receipt row (as the session role) with a path built from a name
create function pg_temp.mkrc(p_uid uuid, p_n int) returns text language plpgsql as $f$
declare pth text := p_uid::text || '/r' || p_n || '.jpg';
begin
  insert into app.receipts (id, user_id, storage_path) values (pg_temp.oid('receipt', p_uid, p_n), p_uid, pth);
  return pth;
end $f$;
-- a receipt job for that path, driven through the status machine to `final` (done or failed) or left at `queued`
create function pg_temp.mkjob(p_uid uuid, p_type text, p_path text, p_final text, p_result jsonb) returns bigint language plpgsql as $f$
declare i bigint;
begin
  insert into app.jobs (user_id, type, input) values (p_uid, p_type, jsonb_build_object('path', p_path, 'currency', 'INR')) returning id into i;
  if p_final <> 'queued' then
    update app.jobs set status = 'running', attempts = 1 where id = i;
    if p_final = 'done' then update app.jobs set status = 'done', result = p_result where id = i;
    else update app.jobs set status = 'failed', last_error = 'no_lines' where id = i; end if;
  end if;
  return i;
end $f$;
create function pg_temp.cnt(p_uid uuid) returns text language sql as $f$
  select (select count(*) from app.items where user_id = p_uid) || '/' || (select count(*) from app.purchases where user_id = p_uid) || '/' ||
         (select count(*) from app.purchase_receipts where user_id = p_uid) || '/' || (select count(*) from app.receipts where user_id = p_uid and confirmed_at is not null) $f$;
create function pg_temp.conf(p_uid uuid, p_job bigint, p_lines jsonb) returns text language sql as
  $f$ select pg_temp.val_as(p_uid, 'authenticated', format('select app.confirm_receipt(%s, %L::jsonb)', p_job, p_lines)) $f$;
create function pg_temp.wb(p_uid uuid, p_entry uuid, p_item jsonb, p_purchase jsonb) returns text language sql as
  $f$ select pg_temp.val_as(p_uid, 'authenticated', format('select app.wishlist_bought(%L, %L::jsonb, %L::jsonb)', p_entry, p_item, p_purchase)) $f$;

-- ======== 1. shape and privileges ==========================================================================================================
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'app' and table_name = 'receipts'),
  array['id','user_id','storage_path','store','receipt_date','currency','total','job_id','confirmed_at','created_at'], 'receipts has the WO-0080 columns');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'app' and table_name = 'purchase_receipts'),
  array['purchase_id','receipt_id','user_id','created_at'], 'purchase_receipts has its columns');
select ok(not has_table_privilege('authenticated', 'app.receipts', 'delete') and not has_table_privilege('authenticated', 'app.receipts', 'truncate,references,trigger'), 'authenticated has no delete on receipts (LLD 4.6)');
select is((select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid = 'app.receipts'::regclass and a.attnum > 0 and not a.attisdropped
  and has_column_privilege('authenticated', 'app.receipts', a.attname, 'insert')), array['currency','receipt_date','storage_path','store','total','user_id'], 'authenticated inserts only the upload''s own facts');
select is((select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid = 'app.receipts'::regclass and a.attnum > 0 and not a.attisdropped
  and has_column_privilege('authenticated', 'app.receipts', a.attname, 'update')), array['confirmed_at','currency','job_id','receipt_date','store','total'], 'authenticated updates only what the draft sets (never storage_path or user_id)');
select ok(has_table_privilege('authenticated', 'app.purchase_receipts', 'select,insert,delete') and not has_table_privilege('authenticated', 'app.purchase_receipts', 'update'), 'purchase_receipts: select, insert, delete, no update');
select ok(not has_any_column_privilege('anon', 'app.receipts', 'select,insert,update,references') and not has_any_column_privilege('anon', 'app.purchase_receipts', 'select,insert,update,references'), 'anon has nothing on either table');
select is((select array_agg(policyname || ':' || cmd order by policyname) from pg_policies where schemaname = 'app' and tablename in ('receipts', 'purchase_receipts')),
  array['purchase_receipts_delete:DELETE','purchase_receipts_insert:INSERT','purchase_receipts_select:SELECT','receipts_insert:INSERT','receipts_select:SELECT','receipts_update:UPDATE'], 'exactly the documented policies');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'app.receipts'::regclass) and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'app.purchase_receipts'::regclass), 'RLS enabled and forced on both');
select is((select confdeltype::text from pg_constraint where conrelid = 'app.receipts'::regclass and confrelid = 'app.profiles'::regclass), 'c', 'receipts cascades from the profile');
select is((select count(*) from pg_constraint where conrelid = 'app.purchase_receipts'::regclass and contype = 'f' and confdeltype = 'c'), 3::bigint, 'purchase_receipts: all three keys cascade (profile, purchase, receipt)');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and tablename = 'purchases' and indexdef ~ '\(user_id, purchase_date DESC\)'), 'purchases (user_id, purchase_date desc) index exists (LLD 4.7)');

-- ======== 2. the storage path rule (same as job_input_ok and WO-0075) ===============================================================
create temp table pth (n int, label text, path text, ok bool);
insert into pth values
  (1, 'one plain file', pg_temp.ua() || '/a1.jpg', true), (2, 'a pdf name', pg_temp.ua() || '/A-b_c.1.pdf', true),
  (3, 'another user''s folder', pg_temp.ub() || '/a2.jpg', false), (4, 'a path that climbs', pg_temp.ua() || '/../' || pg_temp.ub() || '/x.jpg', false),
  (5, 'dots in the name', pg_temp.ua() || '/a..b.jpg', false), (6, 'a backslash', pg_temp.ua() || '/a\b.jpg', false),
  (7, 'a nested file', pg_temp.ua() || '/sub/a3.jpg', false), (8, 'a leading slash', '/' || pg_temp.ua() || '/a4.jpg', false),
  (9, 'no folder', 'a5.jpg', false), (10, 'a name starting with a dot', pg_temp.ua() || '/.hidden', false),
  (11, 'an empty name', pg_temp.ua() || '/', false), (12, 'a trailing newline', pg_temp.ua() || E'/a6.jpg\n', false),
  (13, 'a name of 129 characters', pg_temp.ua() || '/' || repeat('a', 129), false), (14, 'a name of 128 characters', pg_temp.ua() || '/' || repeat('a', 128), true);
select is(pg_temp.try(format('insert into app.receipts (user_id, storage_path) values (%L, %L)', pg_temp.ua(), path)), case when ok then 'ok' else 'err=23514' end,
  'storage path: ' || label) from pth order by n;
select is(pg_temp.try(format('update app.receipts set storage_path = %L where storage_path = %L', pg_temp.ub() || '/moved.jpg', pg_temp.ua() || '/a1.jpg')), 'err=23514', 'a stored path cannot be moved to another user''s folder');
select is(pg_temp.try(format('insert into app.receipts (user_id, storage_path) values (%L, %L)', pg_temp.ua(), pg_temp.ua() || '/a1.jpg')), 'err=23505', 'one row per stored file (storage_path is unique)');
select is(pg_temp.try(format('insert into app.receipts (user_id, storage_path, currency) values (%L, %L, %L)', pg_temp.ua(), pg_temp.ua() || '/c1.jpg', 'inr')), 'err=23514', 'a currency must be three capital letters');
select is(pg_temp.try(format('insert into app.receipts (user_id, storage_path, total) values (%L, %L, -1)', pg_temp.ua(), pg_temp.ua() || '/c2.jpg')), 'err=23514', 'a negative total is refused');
delete from app.receipts where user_id = pg_temp.ua();

-- ======== 3. owner-only, consent-gated policy; links across users are impossible ====================================================
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.receipts (user_id, storage_path, store) values (%L, %L, %L)', pg_temp.ua(), pg_temp.ua() || '/own.jpg', 'Shop')), 'rows=1', 'A uploads a receipt row');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.receipts (user_id, storage_path) values (%L, %L)', pg_temp.ub(), pg_temp.ub() || '/forged.jpg')), 'err=42501', 'A cannot create a receipt for B');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.receipts (id, user_id, storage_path) values (%L, %L, %L)', gen_random_uuid(), pg_temp.ua(), pg_temp.ua() || '/id.jpg')), 'err=42501', 'a client cannot choose the id, job_id or confirmed_at of a receipt');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'delete from app.receipts'), 'err=42501', 'A cannot delete a receipt');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'update app.receipts set storage_path = user_id::text || ''/x.jpg'''), 'err=42501', 'A cannot change a storage path');
select pg_temp.mkrc(pg_temp.ub(), 1);
select pg_temp.mkrc(pg_temp.ua(), 2);
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('select 1 from app.receipts where user_id = %L', pg_temp.ub())), 'rows=0', 'A reads none of B''s receipts');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('update app.receipts set store = %L where user_id = %L', 'x', pg_temp.ub())), 'rows=0', 'A updates none of B''s receipts');
select is(pg_temp.run_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'authenticated', format('insert into app.receipts (user_id, storage_path) values (%L, %L)', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c.jpg')), 'err=42501', 'without consent a receipt cannot be created');
-- purchases for the links
insert into app.items (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin) values
  (pg_temp.oid('item', pg_temp.ua(), 1), pg_temp.ua(), 'Tee', 'Tops', 'T-shirt', 1, 2, 3, 'manual'), (pg_temp.oid('item', pg_temp.ub(), 1), pg_temp.ub(), 'Tee', 'Tops', 'T-shirt', 1, 2, 3, 'manual');
insert into app.purchases (id, user_id, item_id) values (pg_temp.oid('purchase', pg_temp.ua(), 1), pg_temp.ua(), pg_temp.oid('item', pg_temp.ua(), 1)),
  (pg_temp.oid('purchase', pg_temp.ub(), 1), pg_temp.ub(), pg_temp.oid('item', pg_temp.ub(), 1));
select is(pg_temp.try(format('insert into app.purchase_receipts (user_id, purchase_id, receipt_id) values (%L, %L, %L)', pg_temp.ua(), pg_temp.oid('purchase', pg_temp.ua(), 1), pg_temp.oid('receipt', pg_temp.ub(), 1))),
  'err=23503', 'a link from A''s purchase to B''s receipt is refused by the key (even for a role that bypasses RLS)');
select is(pg_temp.try(format('insert into app.purchase_receipts (user_id, purchase_id, receipt_id) values (%L, %L, %L)', pg_temp.ua(), pg_temp.oid('purchase', pg_temp.ub(), 1), pg_temp.oid('receipt', pg_temp.ua(), 2))),
  'err=23503', 'a link from B''s purchase to A''s receipt is refused by the key');
select is(pg_temp.try(format('insert into app.purchase_receipts (user_id, purchase_id, receipt_id) values (%L, %L, %L)', pg_temp.ub(), pg_temp.oid('purchase', pg_temp.ua(), 1), pg_temp.oid('receipt', pg_temp.ub(), 1))),
  'err=23503', 'a link naming B as owner of A''s purchase is refused by the key');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.purchase_receipts (user_id, purchase_id, receipt_id) values (%L, %L, %L)', pg_temp.ua(), pg_temp.oid('purchase', pg_temp.ua(), 1), pg_temp.oid('receipt', pg_temp.ub(), 1))),
  'err=23503', 'as A the same cross link is refused');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.purchase_receipts (user_id, purchase_id, receipt_id) values (%L, %L, %L)', pg_temp.ub(), pg_temp.oid('purchase', pg_temp.ub(), 1), pg_temp.oid('receipt', pg_temp.ub(), 1))), 'err=42501', 'A cannot write a link as B');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.purchase_receipts (user_id, purchase_id, receipt_id) values (%L, %L, %L)', pg_temp.ua(), pg_temp.oid('purchase', pg_temp.ua(), 1), pg_temp.oid('receipt', pg_temp.ua(), 2))), 'rows=1', 'A links A''s purchase to A''s receipt');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'delete from app.purchase_receipts'), 'rows=1', 'and can unlink it');
insert into app.purchase_receipts (user_id, purchase_id, receipt_id) values (pg_temp.ua(), pg_temp.oid('purchase', pg_temp.ua(), 1), pg_temp.oid('receipt', pg_temp.ua(), 2));
delete from app.purchases where id = pg_temp.oid('purchase', pg_temp.ua(), 1);
select is((select count(*) from app.purchase_receipts where user_id = pg_temp.ua()), 0::bigint, 'deleting the purchase removes its link');
insert into app.purchases (id, user_id, item_id) values (pg_temp.oid('purchase', pg_temp.ua(), 1), pg_temp.ua(), pg_temp.oid('item', pg_temp.ua(), 1));
insert into app.purchase_receipts (user_id, purchase_id, receipt_id) values (pg_temp.ua(), pg_temp.oid('purchase', pg_temp.ua(), 1), pg_temp.oid('receipt', pg_temp.ua(), 2));
delete from app.receipts where id = pg_temp.oid('receipt', pg_temp.ua(), 2);
select is((select count(*) from app.purchase_receipts where user_id = pg_temp.ua()) + (select count(*) from app.purchases where user_id = pg_temp.ua()), 1::bigint, 'deleting the receipt removes the link and keeps the purchase');
-- job_id: the caller's own receipt job only, once
select pg_temp.mkrc(pg_temp.ua(), 3);
select pg_temp.mkrc(pg_temp.ua(), 4);
create temp table jb as select pg_temp.mkjob(pg_temp.ua(), 'receipt', pg_temp.ua() || '/r3.jpg', 'done', '{"lines":[]}') as ja,
  pg_temp.mkjob(pg_temp.ub(), 'receipt', pg_temp.ub() || '/r1.jpg', 'done', '{"lines":[]}') as jbb, pg_temp.mkjob(pg_temp.ua(), 'photo', pg_temp.ua() || '/p.webp', 'done', '{"path":"x"}') as jp;
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('update app.receipts set job_id = %s where id = %L', (select jbb from jb), pg_temp.oid('receipt', pg_temp.ua(), 3))), 'err=42501', 'a receipt cannot point at another user''s job');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('update app.receipts set job_id = %s where id = %L', (select jp from jb), pg_temp.oid('receipt', pg_temp.ua(), 3))), 'err=42501', 'nor at a photo job');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('update app.receipts set job_id = %s where id = %L', (select ja from jb), pg_temp.oid('receipt', pg_temp.ua(), 3))), 'rows=1', 'but at its own receipt job');
select is(pg_temp.try(format('update app.receipts set job_id = %s where id = %L', (select ja from jb), pg_temp.oid('receipt', pg_temp.ua(), 4))), 'err=23505', 'one receipt per job');

-- ======== 4. exchange rates =================================================================================================================
select is((select rolcanlogin::text || rolsuper::text || rolbypassrls::text || rolcreaterole::text || rolcreatedb::text || rolreplication::text || rolinherit::text from pg_roles where rolname = 'fx_role'), 'falsefalsefalsefalsefalsefalsefalse', 'fx_role: NOLOGIN and no privileged attribute');
select is((select rolpassword is null from pg_authid where rolname = 'fx_role'), true, 'fx_role has no password');
select is((select count(*) from pg_auth_members where member = 'fx_role'::regrole), 0::bigint, 'fx_role is a member of no role');
select is((select count(*) from pg_auth_members where roleid = 'fx_role'::regrole and member <> 'postgres'::regrole), 0::bigint, 'nobody but its creator is a member of fx_role');
select is((select array_agg(nspname::text order by nspname) from pg_namespace where has_schema_privilege('fx_role', oid, 'usage') and nspname not like 'pg\_%' and nspname <> 'information_schema'), array['ops','public'], 'fx_role has usage on ops (and the open public schema) and on no other schema');
select is((select array_agg(c.relnamespace::regnamespace::text || '.' || c.relname order by c.relname) from pg_class c where c.relkind in ('r', 'p', 'v', 'm', 'f') and c.relnamespace::regnamespace::text not in ('pg_catalog', 'information_schema')
  and c.relnamespace::regnamespace::text not like 'pg\_%' and has_schema_privilege('fx_role', c.relnamespace, 'usage')
  and (has_any_column_privilege('fx_role', c.oid, 'select,insert,update,references') or has_table_privilege('fx_role', c.oid, 'delete,truncate,trigger'))), array['ops.fx_rates'], 'the only table fx_role can touch is ops.fx_rates');
select ok(has_table_privilege('fx_role', 'ops.fx_rates', 'select,insert,update') and not has_table_privilege('fx_role', 'ops.fx_rates', 'delete,truncate,references,trigger'), 'fx_role: select, insert, update on ops.fx_rates');
select is((select array_agg(policyname || ':' || cmd order by policyname) from pg_policies where tablename = 'fx_rates'), array['fx_rates_insert:INSERT','fx_rates_select:SELECT','fx_rates_update:UPDATE'], 'one policy per operation, all for fx_role');
select is((select count(*) from pg_policies where tablename = 'fx_rates' and roles <> array['fx_role']::name[]), 0::bigint, 'no fx_rates policy for any other role');
select ok(not has_any_column_privilege('anon', 'ops.fx_rates', 'select,insert,update') and not has_any_column_privilege('authenticated', 'ops.fx_rates', 'select,insert,update')
  and not has_any_column_privilege('service_role', 'ops.fx_rates', 'select,insert,update') and not has_table_privilege('authenticated', 'ops.fx_rates', 'delete'), 'anon, authenticated and service_role have no grant on ops.fx_rates');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select 1 from ops.fx_rates'), 'err=42501', 'a signed-in user cannot read ops.fx_rates directly');
select is(pg_temp.run_as(null, 'fx_role', $$ insert into ops.fx_rates (currency, rate_date, per_usd) values ('EUR', '2026-11-01', 0.9), ('EUR', '2026-11-03', 0.92), ('INR', '2026-11-03', 84.5), ('INR', '2026-11-02', 84.1), ('GBP', '2026-10-30', 0.78) $$), 'rows=5', 'fx_role inserts rates');
select is(pg_temp.run_as(null, 'fx_role', $$ update ops.fx_rates set per_usd = 84.6 where currency = 'INR' and rate_date = '2026-11-03' $$), 'rows=1', 'fx_role updates a rate');
select is(pg_temp.run_as(null, 'fx_role', $$ insert into ops.fx_rates values ('EUR', '2026-11-03', 0.93) on conflict (currency, rate_date) do update set per_usd = excluded.per_usd $$), 'rows=1', 'fx_role upserts a day''s rate');
select is(pg_temp.run_as(null, 'fx_role', 'select 1 from ops.fx_rates'), 'rows=5', 'fx_role reads the rates');
select is(pg_temp.run_as(null, 'fx_role', 'delete from ops.fx_rates'), 'err=42501', 'fx_role cannot delete rates');
select is(pg_temp.run_as(null, 'fx_role', $$ insert into ops.fx_rates values ('USD', '2026-11-03', 0) $$), 'err=23514', 'a rate must be above zero');
select is(pg_temp.run_as(null, 'fx_role', $$ insert into ops.fx_rates values ('usd', '2026-11-03', 1) $$), 'err=23514', 'a currency code must be three capital letters');
select is(pg_temp.run_as(null, 'fx_role', q), 'err=42501', 'fx_role cannot: ' || q)
  from unnest(array['select 1 from app.items', 'select 1 from app.profiles', 'select 1 from app.receipts', 'select 1 from app.jobs', 'select 1 from ops.settings', 'select 1 from ops.invitations', 'select 1 from ops.worker_heartbeat',
    'select 1 from auth.users', 'select 1 from catalog.lk_category', 'select 1 from storage.objects', 'update app.items set name = name', 'create table ops.x (a int)']) q order by q;
select is(pg_temp.run_as(null, 'worker_role', 'select 1 from ops.fx_rates'), 'err=42501', 'worker_role cannot read the rates either');
select ok(not has_function_privilege('anon', 'app.latest_fx_rates()', 'execute') and has_function_privilege('authenticated', 'app.latest_fx_rates()', 'execute') and not has_function_privilege('fx_role', 'app.latest_fx_rates()', 'execute'),
  'app.latest_fx_rates is executable by authenticated only');
select is((select prosecdef from pg_proc where oid = 'app.latest_fx_rates()'::regprocedure), true, 'it is a definer function (clients have no access to ops)');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', $$ select string_agg(currency || '=' || rate_date || '=' || per_usd::numeric(18,2), ',' order by currency) from app.latest_fx_rates() $$),
  'EUR=2026-11-03=0.93,GBP=2026-10-30=0.78,INR=2026-11-03=84.60', 'latest_fx_rates returns the newest row per currency');
select is(pg_temp.run_as(null, 'anon', 'select * from app.latest_fx_rates()'), 'err=42501', 'anon cannot call latest_fx_rates');

-- ======== 5. wishlist_bought ================================================================================================================
insert into app.wishlist_entries (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, brand, size_system, size_value, seasons, currency) values
  (pg_temp.oid('wish', pg_temp.ua(), 1), pg_temp.ua(), 'Navy chinos', 'Bottoms', 'Chinos', 0, 0, 128, 'Acme', 'Waist and length', '32', '{Summer}', 'INR'),
  (pg_temp.oid('wish', pg_temp.ua(), 2), pg_temp.ua(), 'Catalogue tee', 'Tops', 'T-shirt', 9, 9, 9, null, null, null, '{}', null),
  (pg_temp.oid('wish', pg_temp.ua(), 3), pg_temp.ua(), 'Third', 'Tops', 'Shirt', 1, 1, 1, null, null, null, '{}', null),
  (pg_temp.oid('wish', pg_temp.ua(), 4), pg_temp.ua(), 'No colour', 'Tops', 'Shirt', null, null, null, null, null, null, '{}', null),
  (pg_temp.oid('wish', pg_temp.ub(), 1), pg_temp.ub(), 'B''s entry', 'Tops', 'Shirt', 1, 1, 1, null, null, null, '{}', null);
update app.wishlist_entries set catalog_item_id = 'dddddddd-0000-4000-8000-000000000001' where id = pg_temp.oid('wish', pg_temp.ua(), 2);
create temp table wb0 as select pg_temp.cnt(pg_temp.ua()) as c;
create temp table wb1 as select pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 1), '{}', '{"purchase_date":"2026-10-05","store":"Mall","price":"1299.50","currency":"INR","quantity":2}') as r;
select matches((select r from wb1), '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'wishlist_bought returns the new item id');
select is((select name || '|' || category || '|' || sub_type || '|' || origin || '|' || coalesce(brand, '') || '|' || size_value || '|' || colour_b || '|' || seasons::text || '|' || (catalog_item_id is null) from app.items where id::text = (select r from wb1)),
  'Navy chinos|Bottoms|Chinos|manual|Acme|32|128|{Summer}|true', 'the item copies the entry and has origin manual');
select is((select status from app.wishlist_entries where id = pg_temp.oid('wish', pg_temp.ua(), 1)), 'bought', 'the entry is marked bought');
select is((select purchase_date || '|' || store || '|' || price || '|' || currency || '|' || quantity from app.purchases where item_id::text = (select r from wb1)), '2026-10-05|Mall|1299.50|INR|2', 'one purchase with the given facts');
select is(pg_temp.cnt(pg_temp.ua()), (select (split_part(c, '/', 1)::int + 1) || '/' || (split_part(c, '/', 2)::int + 1) || '/' || split_part(c, '/', 3) || '/' || split_part(c, '/', 4) from wb0), 'exactly one item and one purchase were added');
select is(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 1), '{}', '{}'), 'err=P0001: already_bought', 'a second call for the same entry is refused');
select is(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ub(), 1), '{}', '{}'), 'err=P0001: entry_not_found', 'another user''s entry is refused as not found');
select is((select status from app.wishlist_entries where id = pg_temp.oid('wish', pg_temp.ub(), 1)), 'open', 'and stays open');
select is(pg_temp.wb(pg_temp.ua(), gen_random_uuid(), '{}', '{}'), 'err=P0001: entry_not_found', 'a missing entry is refused');
select is(pg_temp.wb('cccccccc-cccc-cccc-cccc-cccccccccccc', pg_temp.oid('wish', pg_temp.ua(), 3), '{}', '{}'), 'err=P0001: entry_not_found', 'a user without consent sees no entry');
select is(pg_temp.val_as(null, 'anon', 'select app.wishlist_bought(gen_random_uuid(), ''{}'', ''{}'')'), 'err=42501: permission denied for function wishlist_bought', 'anon cannot call it');
create temp table wb2 as select pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 2), '{"name":"Better tee","condition":80}', '{"price":"20","currency":"USD"}') as r;
select is((select name || '|' || origin || '|' || catalog_item_id || '|' || condition from app.items where id::text = (select r from wb2)), 'Better tee|catalogue|dddddddd-0000-4000-8000-000000000001|80', 'an entry from the catalogue gives an item with origin catalogue and the same catalogue id; p_item overrides the entry');
-- all or nothing: nothing is left behind by a refused call
create temp table wb3 as select pg_temp.cnt(pg_temp.ua()) as c;
select is(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 3), '{"category":"Nope secret-1"}', '{}'), 'err=22023: invalid_input', 'an unknown category is refused with a fixed code that does not echo it');
select is(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 3), '{}', '{"price":"abc secret-2"}'), 'err=22023: invalid_input', 'a price that is not a number is refused, not echoed');
select is(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 3), '{}', '{"price":"-1"}'), 'err=22023: invalid_input', 'a negative price is refused');
select is(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 3), '{}', '{"currency":"inr"}'), 'err=22023: invalid_input', 'a currency that is not three capitals is refused');
select is(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 3), '{}', '{"quantity":0}'), 'err=22023: invalid_input', 'quantity 0 is refused');
select is(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 3), '{"user_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}', '{}'), 'err=22023: invalid_input', 'an item key outside the list (user_id) is refused');
select is(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 3), '{}', '{"item_id":"x"}'), 'err=22023: invalid_input', 'a purchase key outside the list is refused');
select is(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 3), '[1]', '{}'), 'err=22023: invalid_input', 'p_item that is not an object is refused');
select is(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 3), '{"seasons":"Summer"}', '{}'), 'err=22023: invalid_input', 'seasons that is not an array is refused');
select is(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 4), '{}', '{}'), 'err=22023: invalid_input', 'an entry without a colour needs one in p_item');
select is(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 3), jsonb_build_object('name', repeat('n', 201)), '{}'), 'err=22023: invalid_input', 'a name over 200 characters is refused');
select is(pg_temp.cnt(pg_temp.ua()), (select c from wb3), 'after all those refusals no item, purchase or link was added');
select is((select status from app.wishlist_entries where id = pg_temp.oid('wish', pg_temp.ua(), 3)), 'open', 'and the entry is still open');
select is(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 4), '{"colour_r":1,"colour_g":2,"colour_b":3}', 'null'), 'err=22023: invalid_input', 'a purchase that is JSON null is refused, not treated as empty');
select matches(pg_temp.wb(pg_temp.ua(), pg_temp.oid('wish', pg_temp.ua(), 4), '{"colour_r":1,"colour_g":2,"colour_b":3}', null), '^[0-9a-f-]{36}$', 'with a colour in p_item and no purchase facts the bought call works');

-- ======== 6. confirm_receipt ================================================================================================================
select pg_temp.mkrc(pg_temp.ua(), 10);   -- the receipt of the done job
select pg_temp.mkrc(pg_temp.ua(), 11);   -- the receipt of the queued job
select pg_temp.mkrc(pg_temp.ua(), 12);   -- the receipt of the failed job
select pg_temp.mkrc(pg_temp.ua(), 13);   -- for the all-or-nothing case
select pg_temp.mkrc(pg_temp.ua(), 14);   -- a receipt with only skipped lines
create temp table cj as select
  pg_temp.mkjob(pg_temp.ua(), 'receipt', pg_temp.ua() || '/r10.jpg', 'done', '{"store":"Shopwell","date":"2026-09-30","currency":"INR","lines":[]}') as done,
  pg_temp.mkjob(pg_temp.ua(), 'receipt', pg_temp.ua() || '/r11.jpg', 'queued', null) as queued,
  pg_temp.mkjob(pg_temp.ua(), 'receipt', pg_temp.ua() || '/r12.jpg', 'failed', null) as failed,
  pg_temp.mkjob(pg_temp.ua(), 'receipt', pg_temp.ua() || '/r13.jpg', 'done', '{"store":"Shopwell","date":"2026-09-30","lines":[]}') as atomic,
  pg_temp.mkjob(pg_temp.ua(), 'receipt', pg_temp.ua() || '/r14.jpg', 'done', '{"store":"Skipper","lines":[]}') as skipped,
  pg_temp.mkjob(pg_temp.ua(), 'receipt', pg_temp.ua() || '/nofile.jpg', 'done', '{"lines":[]}') as norow;
create temp table good as select '[{"action":"new","name":"Blue tee","category":"Tops","sub_type":"T-shirt","colour_r":10,"colour_g":20,"colour_b":200,"qty":2,"amount":19.98},
  {"action":"match","catalog_item_id":"dddddddd-0000-4000-8000-000000000002","name":"Slim jeans","category":"Bottoms","sub_type":"Jeans","colour_r":0,"colour_g":0,"colour_b":128,"amount":1499,"store":"Other Store","date":"2026-10-01"},
  {"action":"skip","text":"CARRY BAG"}]'::jsonb as l;
select is(pg_temp.conf(pg_temp.ua(), (select queued from cj), (select l from good)), 'err=P0001: job_not_done', 'a queued job cannot be confirmed');
select is(pg_temp.conf(pg_temp.ua(), (select failed from cj), (select l from good)), 'err=P0001: job_not_done', 'a failed job cannot be confirmed');
select is(pg_temp.conf(pg_temp.ua(), (select jp from jb), (select l from good)), 'err=P0001: job_not_found', 'a photo job is not a receipt job');
select is(pg_temp.conf(pg_temp.ub(), (select done from cj), (select l from good)), 'err=P0001: job_not_found', 'another user''s job is not found');
select is(pg_temp.conf(pg_temp.ua(), 999999999, (select l from good)), 'err=P0001: job_not_found', 'a missing job is not found');
select is(pg_temp.conf(pg_temp.ua(), (select norow from cj), (select l from good)), 'err=P0001: receipt_not_found', 'a done job with no receipt row is refused');
select is(pg_temp.conf('cccccccc-cccc-cccc-cccc-cccccccccccc', (select done from cj), (select l from good)), 'err=P0001: job_not_found', 'a user without consent sees no job');
select is(pg_temp.val_as(null, 'anon', 'select app.confirm_receipt(1, ''[]'')'), 'err=42501: permission denied for function confirm_receipt', 'anon cannot call it');
create temp table bad (n int, label text, l jsonb);
insert into bad values
  (1, 'lines that are not an array', '{"action":"skip"}'), (2, 'an empty list', '[]'), (3, 'a line that is not an object', '[1]'), (4, 'an unknown action', '[{"action":"buy"}]'),
  (5, 'no action', '[{"name":"x"}]'), (6, 'match without a catalogue id', '[{"action":"match","name":"x","category":"Tops","sub_type":"Shirt","colour_r":1,"colour_g":1,"colour_b":1,"amount":5}]'),
  (7, 'new with a catalogue id', '[{"action":"new","catalog_item_id":"dddddddd-0000-4000-8000-000000000002","name":"x","category":"Tops","sub_type":"Shirt","colour_r":1,"colour_g":1,"colour_b":1,"amount":5}]'),
  (8, 'a catalogue id that is not a uuid', '[{"action":"match","catalog_item_id":"secret-3","name":"x","category":"Tops","sub_type":"Shirt","colour_r":1,"colour_g":1,"colour_b":1,"amount":5}]'),
  (9, 'a missing amount', '[{"action":"new","name":"x","category":"Tops","sub_type":"Shirt","colour_r":1,"colour_g":1,"colour_b":1}]'),
  (10, 'an amount that is text', '[{"action":"new","name":"x","category":"Tops","sub_type":"Shirt","colour_r":1,"colour_g":1,"colour_b":1,"amount":"5"}]'),
  (11, 'a negative amount', '[{"action":"new","name":"x","category":"Tops","sub_type":"Shirt","colour_r":1,"colour_g":1,"colour_b":1,"amount":-5}]'),
  (12, 'quantity 0', '[{"action":"new","name":"x","category":"Tops","sub_type":"Shirt","colour_r":1,"colour_g":1,"colour_b":1,"amount":5,"qty":0}]'),
  (13, 'an unknown category', '[{"action":"new","name":"x","category":"Nope secret-4","sub_type":"Shirt","colour_r":1,"colour_g":1,"colour_b":1,"amount":5}]'),
  (14, 'a colour outside 0..255', '[{"action":"new","name":"x","category":"Tops","sub_type":"Shirt","colour_r":256,"colour_g":1,"colour_b":1,"amount":5}]'),
  (15, 'a missing colour', '[{"action":"new","name":"x","category":"Tops","sub_type":"Shirt","amount":5}]'),
  (16, 'a key outside the list', '[{"action":"new","name":"x","category":"Tops","sub_type":"Shirt","colour_r":1,"colour_g":1,"colour_b":1,"amount":5,"user_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}]'),
  (17, 'a date that is not a date', '[{"action":"new","name":"x","category":"Tops","sub_type":"Shirt","colour_r":1,"colour_g":1,"colour_b":1,"amount":5,"date":"secret-5"}]'),
  (18, 'a currency in lower case', '[{"action":"new","name":"x","category":"Tops","sub_type":"Shirt","colour_r":1,"colour_g":1,"colour_b":1,"amount":5,"currency":"inr"}]');
select is(pg_temp.conf(pg_temp.ua(), (select atomic from cj), l), 'err=22023: invalid_lines', 'refused with a fixed code: ' || label) from bad order by n;
select is(pg_temp.conf(pg_temp.ua(), (select atomic from cj), (select jsonb_agg(x) from (select e as x from jsonb_array_elements((select l from good)) e limit 1) s) || jsonb_build_array(jsonb_build_object('action', 'new', 'name', 'x', 'category', 'Nope', 'sub_type', 'x', 'colour_r', 1, 'colour_g', 1, 'colour_b', 1, 'amount', 5))),
  'err=22023: invalid_lines', 'a good line followed by a bad one is refused');
select is(pg_temp.conf(pg_temp.ua(), (select atomic from cj), (select jsonb_agg('{"action":"skip"}'::jsonb) from generate_series(1, 201))), 'err=22023: invalid_lines', 'more than 200 lines are refused');
create temp table cb0 as select pg_temp.cnt(pg_temp.ua()) as c;
create temp table cr as select pg_temp.conf(pg_temp.ua(), (select done from cj), (select l from good))::jsonb as r;
select is((select r->>'receipt_id' from cr), pg_temp.oid('receipt', pg_temp.ua(), 10)::text, 'confirm returns the receipt id');
select is((select jsonb_array_length(r->'items') || '/' || jsonb_array_length(r->'purchases') from cr), '2/2', 'two lines became two items and two purchases (the skipped line created nothing)');
select is(pg_temp.cnt(pg_temp.ua()), (select (split_part(c, '/', 1)::int + 2) || '/' || (split_part(c, '/', 2)::int + 2) || '/2/' || (split_part(c, '/', 4)::int + 1) from cb0), 'two items, two purchases, two links and one confirmed receipt were added');
select is((select string_agg(i.name || ':' || i.origin || ':' || coalesce(i.catalog_item_id::text, '-'), ',' order by i.name) from app.items i where i.id in (select jsonb_array_elements_text((select r->'items' from cr))::uuid)),
  'Blue tee:receipt:-,Slim jeans:receipt:dddddddd-0000-4000-8000-000000000002', 'items have origin receipt; the matched one keeps its catalogue id');
select is((select string_agg(p.price || '|' || p.quantity || '|' || coalesce(p.store, '-') || '|' || p.purchase_date || '|' || p.currency, ',' order by p.price) from app.purchases p where p.id in (select jsonb_array_elements_text((select r->'purchases' from cr))::uuid)),
  '9.99|2|Shopwell|2026-09-30|INR,1499.00|1|Other Store|2026-10-01|INR', 'purchases hold the unit price (amount / qty), the quantity, and the header values or the line''s own');
select is((select count(*) from app.purchase_receipts pr where pr.receipt_id = pg_temp.oid('receipt', pg_temp.ua(), 10) and pr.purchase_id in (select jsonb_array_elements_text((select r->'purchases' from cr))::uuid)), 2::bigint, 'both purchases are linked to the receipt');
select is((select store || '|' || receipt_date || '|' || currency || '|' || total || '|' || (job_id = (select done from cj)) || '|' || (confirmed_at is not null) from app.receipts where id = pg_temp.oid('receipt', pg_temp.ua(), 10)),
  'Shopwell|2026-09-30|INR|1518.98|true|true', 'the receipt carries store, date, currency, the sum of the amounts, its job and the confirmation time');
select is(pg_temp.conf(pg_temp.ua(), (select done from cj), (select l from good)), 'err=P0001: already_confirmed', 'a second call is refused');
select is(pg_temp.cnt(pg_temp.ua()), (select (split_part(c, '/', 1)::int + 2) || '/' || (split_part(c, '/', 2)::int + 2) || '/2/' || (split_part(c, '/', 4)::int + 1) from cb0), 'and creates nothing');
select is(pg_temp.conf(pg_temp.ub(), (select done from cj), (select l from good)), 'err=P0001: job_not_found', 'B cannot confirm A''s job');
select is(pg_temp.conf(pg_temp.ua(), (select skipped from cj), '[{"action":"skip"},{"action":"skip","text":"x"}]'), (select jsonb_build_object('receipt_id', pg_temp.oid('receipt', pg_temp.ua(), 14), 'items', '[]'::jsonb, 'purchases', '[]'::jsonb)::text), 'a receipt whose lines are all skipped is confirmed with nothing created');
select is((select store || '|' || total || '|' || (confirmed_at is not null) from app.receipts where id = pg_temp.oid('receipt', pg_temp.ua(), 14)), 'Skipper|0.00|true', 'its header comes from the job result');
select is((select count(*) from app.receipts where id = pg_temp.oid('receipt', pg_temp.ua(), 13) and confirmed_at is null), 1::bigint, 'the receipt of the refused call is still unconfirmed');
-- defence in depth: a session that bypasses RLS (the owner) acting as B still cannot confirm A's job, because the function filters by auth.uid() itself
create function pg_temp.bypass_as_b(p_job bigint) returns text language plpgsql as $f$
declare res text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.ub(), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', pg_temp.ub()::text, true);
  begin
    perform app.confirm_receipt(p_job, '[{"action":"skip"}]');
    res := 'confirmed';
  exception when others then res := sqlerrm; end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return res;
end $f$;
select is(pg_temp.bypass_as_b((select done from cj)), 'job_not_found', 'even without RLS (owner session) B''s identity cannot reach A''s job');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select app.insert_item_from_json(''{"name":"x","category":"Tops","sub_type":"Shirt","colour_r":1,"colour_g":1,"colour_b":1}'', ''manual'', null)'), 'rows=1', 'the builder works for the signed-in caller (as a direct insert would)');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('select app.insert_purchase_from_json(%L, ''{}'')', pg_temp.oid('item', pg_temp.ub(), 1))), 'err=23503', 'a purchase builder call cannot reach B''s item');
select ok((select bool_and(not prosecdef) from pg_proc where oid in ('app.confirm_receipt(bigint,jsonb)'::regprocedure, 'app.wishlist_bought(uuid,jsonb,jsonb)'::regprocedure,
  'app.insert_item_from_json(jsonb,text,uuid)'::regprocedure, 'app.insert_purchase_from_json(uuid,jsonb)'::regprocedure)), 'all four functions are security invoker');

-- ======== 7. the 7-day purge of receipt jobs ================================================================================================
create temp table pj as select
  pg_temp.mkjob(pg_temp.ub(), 'receipt', pg_temp.ub() || '/p1.jpg', 'done', '{"lines":[]}') as old_done,
  pg_temp.mkjob(pg_temp.ub(), 'receipt', pg_temp.ub() || '/p2.jpg', 'failed', null) as old_failed,
  pg_temp.mkjob(pg_temp.ub(), 'receipt', pg_temp.ub() || '/p3.jpg', 'done', '{"lines":[]}') as young,
  pg_temp.mkjob(pg_temp.ub(), 'receipt', pg_temp.ub() || '/p4.jpg', 'queued', null) as queued,
  pg_temp.mkjob(pg_temp.ub(), 'photo', pg_temp.ub() || '/p5.webp', 'done', '{"path":"x"}') as old_photo;
alter table app.jobs disable trigger jobs_state_machine;   -- (rolled back) the machine forbids changing a final job; the test needs old finish times
update app.jobs set finished_at = now() - interval '7 days 1 minute' where id in ((select old_done from pj), (select old_failed from pj), (select old_photo from pj));
update app.jobs set finished_at = now() - interval '6 days 23 hours' where id = (select young from pj);
update app.jobs set finished_at = now() - interval '9 days' where id = (select done from cj);   -- the confirmed receipt's job is purged too
select pg_temp.mkrc(pg_temp.ub(), 20);
select is(pg_temp.try('select app.purge_receipt_jobs()'), 'ok', 'the purge function runs');
select is((select array_agg(id order by id) from app.jobs where id in (select old_done from pj union select old_failed from pj union select young from pj union select queued from pj union select old_photo from pj)),
  (select array_agg(x order by x) from (select young as x from pj union select queued from pj union select old_photo from pj) s), 'old finished receipt jobs are gone; a young one, a queued one and an old photo job stay');
select is((select count(*) from app.jobs where id = (select done from cj)), 0::bigint, 'the confirmed receipt''s job went too');
select is((select count(*) from app.receipts where id = pg_temp.oid('receipt', pg_temp.ua(), 10) and job_id is not null), 1::bigint, 'and the receipt itself and its purchases are untouched');
select is(app.purge_receipt_jobs(), 0, 'a second run finds nothing');
select is((select schedule || '|' || command || '|' || active::text from cron.job where jobname = 'sparta-purge-receipt-jobs'), '17 3 * * *|select app.purge_receipt_jobs()|true', 'pg_cron runs the purge daily');
select ok(not has_function_privilege('authenticated', 'app.purge_receipt_jobs()', 'execute') and not has_function_privilege('anon', 'app.purge_receipt_jobs()', 'execute')
  and not has_function_privilege('worker_role', 'app.purge_receipt_jobs()', 'execute') and (select prosecdef from pg_proc where oid = 'app.purge_receipt_jobs()'::regprocedure), 'only the owner can run the purge; it is a definer function');
alter table app.jobs enable trigger jobs_state_machine;

-- ======== 7b. WO-0092 (fix loop 1): purge ignores unfinished jobs, permission errors pass through, write-once, finite prices, skip keys =======
-- K08: only `finished_at` counts. A queued and a running receipt job created 30 days ago are not "finished", so the purge leaves both.
create temp table pk as select
  pg_temp.mkjob(pg_temp.ub(), 'receipt', pg_temp.ub() || '/q1.jpg', 'queued', null) as q,
  pg_temp.mkjob(pg_temp.ub(), 'receipt', pg_temp.ub() || '/q2.jpg', 'queued', null) as r,
  pg_temp.mkjob(pg_temp.ub(), 'receipt', pg_temp.ub() || '/q3.jpg', 'done', '{"lines":[]}') as d;
alter table app.jobs disable trigger jobs_state_machine;   -- (rolled back) the machine forbids these edits; the test needs old creation times
update app.jobs set status = 'running', attempts = 1, started_at = now() - interval '29 days' where id = (select r from pk);
update app.jobs set created_at = now() - interval '30 days' where id in ((select q from pk), (select r from pk), (select d from pk));
update app.jobs set finished_at = now() - interval '8 days' where id = (select d from pk);
select is((select status from app.jobs where id = (select r from pk)) || '/' || (select status from app.jobs where id = (select q from pk)), 'running/queued', 'fixture: one running and one queued receipt job, both created 30 days ago');
select is(app.purge_receipt_jobs(), 1, 'the purge deletes exactly the one job that finished more than 7 days ago');
select is((select count(*) from app.jobs where id in ((select q from pk), (select r from pk))), 2::bigint, 'a queued and a running job older than 7 days (by created_at) are left alone: only finished_at counts');
select is((select count(*) from app.jobs where id = (select d from pk)), 0::bigint, 'and the old finished one is gone');
alter table app.jobs enable trigger jobs_state_machine;

-- K10: a permission error from deeper down (no insert on purchase_receipts) passes through as 42501; it is not turned into invalid_lines
select pg_temp.mkrc(pg_temp.ua(), 16);
create temp table kj as select pg_temp.mkjob(pg_temp.ua(), 'receipt', pg_temp.ua() || '/r16.jpg', 'done', '{"store":"Shopwell","date":"2026-09-30","currency":"INR","lines":[]}') as j;
create temp table kc0 as select pg_temp.cnt(pg_temp.ua()) as c;
revoke insert on app.purchase_receipts from authenticated;   -- (restored right after) the call below must hit this as a permission error
select is(pg_temp.conf(pg_temp.ua(), (select j from kj), (select l from good)), 'err=42501: permission denied for table purchase_receipts', 'a permission error passes through: 42501, not invalid_lines');
grant insert on app.purchase_receipts to authenticated;
select is(pg_temp.cnt(pg_temp.ua()), (select c from kc0), 'and that refused call left no item, purchase or link behind');
select is((select count(*) from app.receipts where id = pg_temp.oid('receipt', pg_temp.ua(), 16) and confirmed_at is null), 1::bigint, 'the receipt stays unconfirmed');
select ok(has_table_privilege('authenticated', 'app.purchase_receipts', 'select,insert,delete'), 'the grant is back (the revoke was only for that call)');

-- skip lines are checked for unknown keys like every other line (the line keys, the item keys and the draft's `text` are allowed)
create temp table sk0 as select pg_temp.cnt(pg_temp.ua()) as c;
select is(pg_temp.conf(pg_temp.ua(), (select atomic from cj), '[{"action":"skip","bogus":"secret-6"}]'), 'err=22023: invalid_lines', 'a skip line with an unknown key is refused');
select is(pg_temp.conf(pg_temp.ua(), (select atomic from cj), '[{"action":"skip","user_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}]'), 'err=22023: invalid_lines', 'a skip line cannot carry user_id');
select is(pg_temp.conf(pg_temp.ua(), (select atomic from cj), '[{"action":"skip","text":"ok"},{"action":"skip","text":"x","job_id":1}]'), 'err=22023: invalid_lines', 'a good skip line followed by a bad one is refused');
select is(pg_temp.cnt(pg_temp.ua()), (select c from sk0), 'and nothing was created');
select is((select count(*) from app.receipts where id = pg_temp.oid('receipt', pg_temp.ua(), 13) and confirmed_at is null), 1::bigint, 'the receipt of those refused calls is still unconfirmed');

-- confirmed_at and job_id are write-once. Receipt 10 is confirmed (job cj.done); cj.queued is another receipt job of A; receipt 13 is unconfirmed.
create function pg_temp.rc_upd(p_n int, p_set text) returns text language sql as
  $f$ select format('update app.receipts set %s where id = %L', p_set, pg_temp.oid('receipt', pg_temp.ua(), p_n)) $f$;
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', pg_temp.rc_upd(10, 'confirmed_at = null')), 'err=55000', 'the owner cannot clear confirmed_at');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', pg_temp.rc_upd(10, 'confirmed_at = now() + interval ''1 day''')), 'err=55000', 'nor move it');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', pg_temp.rc_upd(10, format('job_id = %s', (select queued from cj)))), 'err=55000', 'nor point job_id at another of their own receipt jobs');
select is(pg_temp.try(pg_temp.rc_upd(10, 'confirmed_at = null')), 'err=55000', 'nobody else can clear confirmed_at either (the table owner session)');
select is(pg_temp.try(pg_temp.rc_upd(10, 'job_id = null')), 'err=55000', 'nor clear job_id (the table owner session)');
select is(pg_temp.try(pg_temp.rc_upd(10, 'job_id = 1')), 'err=55000', 'nor change job_id (the table owner session)');
-- (receipt 14, confirmed with a job that still exists: for receipt 10 the job was purged above, and the update policy then refuses ANY update, see WO-0092-NOTES)
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', pg_temp.rc_upd(14, 'store = ''Renamed'', confirmed_at = confirmed_at, job_id = job_id')), 'rows=1', 'writing the same values, or other columns, on a confirmed receipt is still allowed');
select is((select store || '|' || (job_id = (select skipped from cj)) || '|' || (confirmed_at is not null) from app.receipts where id = pg_temp.oid('receipt', pg_temp.ua(), 14)), 'Renamed|true|true', 'and confirmed_at and job_id are as they were');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', pg_temp.rc_upd(13, format('job_id = %s, confirmed_at = now()', (select atomic from cj)))), 'rows=1', 'the first write of both on an unconfirmed receipt works');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', pg_temp.rc_upd(13, 'confirmed_at = null')), 'err=55000', 'and then it cannot be cleared');
select is(pg_temp.conf(pg_temp.ua(), (select atomic from cj), '[{"action":"skip"}]'), 'err=P0001: already_confirmed', 'a second confirm_receipt is still refused');
select ok(not has_function_privilege('authenticated', 'app.receipts_write_once()', 'execute') and (select tgenabled = 'O' and (tgtype & 2) = 2 and (tgtype & 16) = 16 and (tgtype & 1) = 1 from pg_trigger where tgrelid = 'app.receipts'::regclass and tgname = 'receipts_write_once'),
  'the write-once trigger is enabled, BEFORE UPDATE, per row, and its function is not callable by authenticated');

-- price must be finite and not negative: the CHECK (direct inserts) and the builders
select ok((select convalidated from pg_constraint where conrelid = 'app.purchases'::regclass and conname = 'purchases_price_finite_chk'), 'the price check exists and is validated');
create function pg_temp.ins_price(p_price text) returns text language sql as
  $f$ select pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.purchases (user_id, item_id, price, currency) values (%L, %L, %L::numeric, ''INR'')', pg_temp.ua(), pg_temp.oid('item', pg_temp.ua(), 1), p_price)) $f$;
select is(pg_temp.ins_price('-1'), 'err=23514', 'a direct insert with a negative price is refused');
select is(pg_temp.ins_price('NaN'), 'err=23514', 'a direct insert with a NaN price is refused');
select isnt(pg_temp.ins_price('Infinity'), 'rows=1', 'and an infinite price is refused too');
select is(pg_temp.ins_price('0'), 'rows=1', 'a price of 0 is fine');
select is(pg_temp.ins_price('1299.50'), 'rows=1', 'and so is an ordinary price');
create function pg_temp.pur_bad(p_price text) returns text language sql as
  $f$ select pg_temp.val_as(pg_temp.ua(), 'authenticated', format('select app.insert_purchase_from_json(%L, %L::jsonb)', pg_temp.oid('item', pg_temp.ua(), 1), jsonb_build_object('price', p_price, 'currency', 'INR'))) $f$;
select is(pg_temp.pur_bad('NaN'), 'err=22023: invalid_input', 'the purchase builder refuses a NaN price with the fixed code');
select is(pg_temp.pur_bad('Infinity'), 'err=22023: invalid_input', 'and an infinite one');
select is(pg_temp.pur_bad('-Infinity'), 'err=22023: invalid_input', 'and a negative infinite one');
select is(pg_temp.pur_bad('-0.01'), 'err=22023: invalid_input', 'and a negative one');
select is((select count(*) from app.purchases where user_id = pg_temp.ua() and (price = 'NaN'::numeric or price < 0)), 0::bigint, 'no NaN or negative price is stored');
select is(pg_temp.conf(pg_temp.ua(), (select j from kj), '[{"action":"new","name":"x","category":"Tops","sub_type":"Shirt","colour_r":1,"colour_g":1,"colour_b":1,"amount":"NaN"}]'), 'err=22023: invalid_lines', 'a receipt line whose amount is the text NaN is refused with the fixed code (a JSON number cannot be NaN)');
select is(pg_temp.conf(pg_temp.ua(), (select j from kj), '[{"action":"new","name":"x","category":"Tops","sub_type":"Shirt","colour_r":1,"colour_g":1,"colour_b":1,"amount":-0.004}]'), 'err=22023: invalid_lines', 'a tiny negative amount (it would round to a zero price) is refused: the line check itself, not the rounding (WO-0092 re-check, mutant C13)');

-- ======== 8. export and deletion ============================================================================================================
create temp table ex as select pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.export_my_data()')::jsonb as doc;
select is((select jsonb_typeof(doc -> 'receipts') || '/' || jsonb_typeof(doc -> 'purchase_receipts') from ex), 'array/array', 'the export holds receipts and purchase_receipts without raising export_uncovered_table');
select is((select jsonb_array_length(doc -> 'receipts') from ex), (select count(*) from app.receipts where user_id = pg_temp.ua())::int, 'all of A''s receipts are in the export');
select is((select jsonb_array_length(doc -> 'purchase_receipts') from ex), 2, 'and A''s links');
select is((select count(*) from ex, jsonb_array_elements(doc -> 'receipts') r where r ->> 'user_id' <> pg_temp.ua()::text), 0::bigint, 'with no row of anyone else');
insert into storage.objects (bucket_id, name, owner_id, metadata) values ('receipts', pg_temp.ua()::text || '/r10.jpg', pg_temp.ua()::text, '{"size":10}'), ('receipts', pg_temp.ub()::text || '/p1.jpg', pg_temp.ub()::text, '{"size":10}');
select is(pg_temp.val_fresh(pg_temp.ua(), 'authenticated', 'select app.delete_my_account()'), 'deleted', 'A leaves the pilot');
select is((select count(*) from app.receipts where user_id = pg_temp.ua()) + (select count(*) from app.purchase_receipts where user_id = pg_temp.ua()), 0::bigint, 'no receipt or link row of A remains');
select is((select count(*) from storage.objects where bucket_id = 'receipts' and name like pg_temp.ua()::text || '/%'), 0::bigint, 'A''s receipt object rows are gone');
select is((select count(*) from app.receipts where user_id = pg_temp.ub()) + (select count(*) from storage.objects where bucket_id = 'receipts' and name like pg_temp.ub()::text || '/%'), 3::bigint, 'B''s two receipt rows and object are untouched');

-- ======== 9. WO-0092: the builder's own finite check, with the table CHECK out of the way ===============================================
-- (the CHECK would also refuse NaN, with the same fixed code, so it is dropped here, at the end of the rolled-back file, to test the function alone)
create function pg_temp.wb_price(p_price text) returns text language sql as
  $f$ select pg_temp.wb(pg_temp.ub(), pg_temp.oid('wish', pg_temp.ub(), 1), '{"colour_r":1,"colour_g":2,"colour_b":3}', jsonb_build_object('price', p_price, 'currency', 'INR')::text::jsonb) $f$;
select is(pg_temp.wb_price('NaN'), 'err=22023: invalid_input', 'wishlist_bought refuses a NaN price with the fixed code');
alter table app.purchases drop constraint purchases_price_finite_chk;
select is(pg_temp.wb_price('NaN'), 'err=22023: invalid_input', 'and does so by its own check, without the table constraint');
select is(pg_temp.wb_price('Infinity'), 'err=22023: invalid_input', 'an infinite price likewise');
select is(pg_temp.wb_price('-Infinity'), 'err=22023: invalid_input', 'a negative infinite price likewise');
select is((select status from app.wishlist_entries where id = pg_temp.oid('wish', pg_temp.ub(), 1)), 'open', 'the entry is still open after those refusals');
select is((select count(*) from app.purchases where user_id = pg_temp.ub() and price = 'NaN'::numeric), 0::bigint, 'and no NaN purchase was stored');

select * from finish();
rollback;
