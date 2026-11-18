-- WO-0159 (R8a) / FR-69, BR-45: the close outcome ends vendor access. app.admin_end_pilot_vendors withdraws every vendor item, deletes the vendor
-- query log and deletes the vendor users in batches. Everything runs in this rolled-back transaction. People: E and E2 admins; V1, V2 and V3
-- vendors (V1 and V2 belong to vendor VA, V3 to vendor VB); K a consumer.
begin;
\ir helpers.inc
select plan(40);

delete from auth.users;
delete from ops.invitations;
delete from ops.vendor_query_log;

select pg_temp.mk_user(u) from unnest(array['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
  'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'dddddddd-dddd-dddd-dddd-ddddddddddd2', 'dddddddd-dddd-dddd-dddd-ddddddddddd3',
  'b0000000-0000-4000-8000-000000000001']::uuid[]) u;
update app.profiles set role = 'admin' where id in ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02');
update app.profiles set role = 'vendor' where id in ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'dddddddd-dddd-dddd-dddd-ddddddddddd2', 'dddddddd-dddd-dddd-dddd-ddddddddddd3');
insert into catalog.vendors (id, name) values ('11111111-1111-4111-8111-111111111111', 'WO-0159 vendor A'), ('22222222-2222-4222-8222-222222222222', 'WO-0159 vendor B');
insert into catalog.vendor_members (vendor_id, user_id) values ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-dddd-dddd-ddddddddddd1'),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-dddd-dddd-ddddddddddd2'), ('22222222-2222-4222-8222-222222222222', 'dddddddd-dddd-dddd-dddd-ddddddddddd3');
insert into catalog.vendor_agreement_acceptances (vendor_id, user_id, version) values ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', '1'),
  ('22222222-2222-4222-8222-222222222222', 'dddddddd-dddd-dddd-dddd-ddddddddddd3', '1');
insert into ops.vendor_query_log (vendor_id, user_id, fn, params) values ('11111111-1111-4111-8111-111111111111', 'b0000000-0000-4000-8000-000000000001', 'gaps', '{}'),
  ('22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-000000000001', 'spectrum', '{}');
insert into catalog.sources (id, name, site_url, robots_allowed, terms_note, allowed, checked_on)
  values (915901, 'WO-0159 source', 'https://source.example.test', true, 'fixture', false, current_date);
insert into catalog.catalog_items (source_id, sku, name, category, sub_type, colour_r, colour_g, colour_b, product_url, status) values
  (915901, 'c1', 'Collector one', 'Tops', 'Shirt', 0, 0, 128, 'https://source.example.test/c1', 'active'),
  (915901, 'c2', 'Collector two', 'Tops', 'Shirt', 0, 0, 128, 'https://source.example.test/c2', 'review');
insert into catalog.catalog_items (vendor_id, sku, name, category, sub_type, colour_r, colour_g, colour_b, product_url, status) values
  ('11111111-1111-4111-8111-111111111111', 'v1', 'Vendor one', 'Tops', 'Shirt', 0, 0, 128, 'https://vendor.example.test/v1', 'active'),
  ('11111111-1111-4111-8111-111111111111', 'v2', 'Vendor two', 'Tops', 'Shirt', 0, 0, 128, 'https://vendor.example.test/v2', 'review'),
  ('22222222-2222-4222-8222-222222222222', 'v3', 'Vendor three', 'Tops', 'Shirt', 0, 0, 128, 'https://vendor.example.test/v3', 'withdrawn'),
  ('22222222-2222-4222-8222-222222222222', 'v4', 'Vendor four', 'Tops', 'Shirt', 0, 0, 128, 'https://vendor.example.test/v4', 'active');
insert into ops.invitations (email, accepted_at) values ('dddddddd-dddd-dddd-dddd-ddddddddddd1@example.test', now()), ('dddddddd-dddd-dddd-dddd-ddddddddddd3@example.test', now()),
  ('other@example.test', now());

create function pg_temp.sv(p_sql text) returns text language sql as $f$ select pg_temp.val_as(null, 'service_role', p_sql) $f$;
create function pg_temp.setp(p_end text, p_outcome text) returns void language sql as
  $f$ update ops.settings set value = case key when 'pilot_end_date' then p_end else p_outcome end where key in ('pilot_end_date', 'pilot_outcome') $f$;
create function pg_temp.ev(p_limit text) returns text language sql as
  $f$ select pg_temp.sv(format('select app.admin_end_pilot_vendors(%L, %s)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', p_limit)) $f$;
create function pg_temp.vstate() returns text language sql as $f$
  select (select count(*) from app.profiles where role = 'vendor') || '|' || (select count(*) from catalog.vendor_members) || '|'
      || (select count(*) from catalog.vendor_agreement_acceptances) || '|' || (select count(*) from ops.vendor_query_log) || '|'
      || (select count(*) from catalog.catalog_items where vendor_id is not null and status <> 'withdrawn') $f$;

-- ---- 1. grant matrix ------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', format('select app.admin_end_pilot_vendors(%L, 5)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')),
  'err=42501: permission denied for function admin_end_pilot_vendors', 'FR-69 grants: authenticated naming the admin cannot run the vendor end');
select is(pg_temp.val_as(null, 'anon', format('select app.admin_end_pilot_vendors(%L, 5)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')),
  'err=42501: permission denied for function admin_end_pilot_vendors', 'FR-69 grants: anon cannot run it');
select ok(not has_function_privilege('anon', 'app.admin_end_pilot_vendors(uuid,int)', 'execute') and not has_function_privilege('authenticated', 'app.admin_end_pilot_vendors(uuid,int)', 'execute')
  and has_function_privilege('service_role', 'app.admin_end_pilot_vendors(uuid,int)', 'execute'), 'FR-69 grants: anon and authenticated hold no execute, service_role does');
select is_empty($$ select 1 from pg_proc p where p.oid = 'app.admin_end_pilot_vendors(uuid,int)'::regprocedure
  and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) $$, 'FR-69 grants: PUBLIC holds no execute (the acl is explicit)');
select is_empty($$ select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'app.admin_end_pilot_vendors(uuid,int)'::regprocedure
  and a.grantee <> p.proowner and a.grantee <> 'service_role'::regrole $$, 'FR-69 grants: no other role holds execute');
select ok((select prosecdef and proconfig @> array['search_path=""'] and pg_get_userbyid(proowner) = 'postgres' from pg_proc where oid = 'app.admin_end_pilot_vendors(uuid,int)'::regprocedure),
  'FR-69 grants: security definer, empty search_path, owned by postgres');

-- ---- 2. refusals ----------------------------------------------------------------------------------------------------------------------------
select pg_temp.setp(to_char(current_date, 'YYYY-MM-DD'), 'close');
create temp table s0 as select pg_temp.vstate() as st, (select count(*) from ops.admin_audit_log) as audits, (select count(*) from auth.users) as users;
select is(pg_temp.sv(format('select app.admin_end_pilot_vendors(%L, 5)', 'b0000000-0000-4000-8000-000000000001')), 'err=42501: forbidden', 'FR-69 refused for a consumer');
select is(pg_temp.sv(format('select app.admin_end_pilot_vendors(%L, 5)', 'dddddddd-dddd-dddd-dddd-ddddddddddd1')), 'err=42501: forbidden', 'FR-69 refused for a vendor');
select is(pg_temp.sv('select app.admin_end_pilot_vendors(null, 5)'), 'err=42501: forbidden', 'FR-69 refused with no admin id');
select pg_temp.setp(to_char(current_date + 1, 'YYYY-MM-DD'), 'close');
select is(pg_temp.ev('5'), 'err=55000: pilot_not_ended', 'FR-69 refused before the end date');
select pg_temp.setp('', 'close');
select is(pg_temp.ev('5'), 'err=55000: pilot_not_ended', 'FR-69 refused with no end date');
select pg_temp.setp(to_char(current_date, 'YYYY-MM-DD'), 'continue');
select is(pg_temp.ev('5'), 'err=55000: not_closing', 'FR-69 refused under the continue outcome');
select pg_temp.setp(to_char(current_date, 'YYYY-MM-DD'), '');
select is(pg_temp.ev('5'), 'err=55000: not_closing', 'FR-69 refused while no outcome is set');
select pg_temp.setp(to_char(current_date, 'YYYY-MM-DD'), 'close');
select is(pg_temp.ev('0'), 'err=22023: invalid_limit', 'FR-69 refuses a limit of 0');
select is(pg_temp.ev('101'), 'err=22023: invalid_limit', 'FR-69 refuses a limit of 101');
select is(pg_temp.ev('null'), 'err=22023: invalid_limit', 'FR-69 refuses a null limit');
select is(pg_temp.ev('5'), 'err=55000: participants_remaining', 'FR-69 refused while a consumer is left (the batches of WO-0158 run first)');
select is(pg_temp.vstate() || '|' || (select count(*) from ops.admin_audit_log) || '|' || (select count(*) from auth.users),
  (select st || '|' || audits || '|' || users from s0), 'FR-69 the refused calls changed nothing: no vendor item, user, log row or audit row');

-- ---- 3. continue: nothing vendor-side changes ---------------------------------------------------------------------------------
select pg_temp.setp(to_char(current_date, 'YYYY-MM-DD'), 'continue');
select is(pg_temp.ev('5'), 'err=55000: not_closing', 'FR-69 continue with no consumer left is still refused');
select is(pg_temp.vstate(), (select st from s0), 'and nothing vendor-side changed');

-- ---- 4. the close run -----------------------------------------------------------------------------------------------------------------------
delete from auth.users where id = 'b0000000-0000-4000-8000-000000000001';   -- the participants went in the batches of WO-0158
select pg_temp.setp(to_char(current_date, 'YYYY-MM-DD'), 'close');
select is(pg_temp.vstate(), '3|3|2|2|3', 'before: three vendor users, three memberships, two acceptances, two log rows, three vendor items not withdrawn');
select is(pg_temp.ev('2')::jsonb, '{"vendor_items_withdrawn": 3, "vendor_users_deleted": 2, "remaining": 1}'::jsonb,
  'FR-69 the first call withdraws the three live vendor items, deletes the log and two of the three vendor users');
select is((select count(*) from catalog.catalog_items where vendor_id is not null and status <> 'withdrawn'), 0::bigint, 'FR-69 every vendor item is withdrawn');
select is((select count(*) from catalog.catalog_items where vendor_id is not null), 4::bigint, 'and none was deleted');
select is((select string_agg(sku || ':' || status, ',' order by sku) from catalog.catalog_items where source_id is not null), 'c1:active,c2:review', 'FR-69 collector items are unchanged');
select is((select count(*) from ops.vendor_query_log), 0::bigint, 'FR-69 the vendor query log is empty');
select is((select count(*) from app.profiles where role = 'vendor'), 1::bigint, 'one vendor user is left');
select is((select count(*) from auth.users where id in ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'dddddddd-dddd-dddd-dddd-ddddddddddd2')), 0::bigint, 'the first two vendor users are gone from auth.users');
select is((select string_agg(email, ',') from ops.invitations), 'dddddddd-dddd-dddd-dddd-ddddddddddd3@example.test,other@example.test',
  'their invitation rows are gone, the left vendor''s and an unrelated one are kept');
select is((select count(*) from catalog.vendor_members) || '|' || (select count(*) from catalog.vendor_agreement_acceptances), '1|1', 'their memberships and acceptances went by cascade');
select is(pg_temp.ev('2')::jsonb, '{"vendor_items_withdrawn": 0, "vendor_users_deleted": 1, "remaining": 0}'::jsonb, 'FR-69 the second call deletes the last vendor user');
select is(pg_temp.vstate(), '0|0|0|0|0', 'FR-69 after the run no vendor user, membership, acceptance or query log row remains and every vendor item is withdrawn');
select is((select count(*) from app.profiles where role = 'admin'), 2::bigint, 'FR-69 both admins remain');
select is((select count(*) from ops.invitations), 1::bigint, 'and only the unrelated invitation is left');
select is(pg_temp.ev('2')::jsonb, '{"vendor_items_withdrawn": 0, "vendor_users_deleted": 0, "remaining": 0}'::jsonb, 'FR-69 calling again changes nothing');
select is((select count(*) from catalog.vendors), 2::bigint, 'the vendor rows themselves are kept');
select is((select string_agg(target, ',' order by id) from ops.admin_audit_log where action = 'pilot.end_vendors'), '3:2:1,0:1:0,0:0:0', 'FR-69 one audit row per call, with counts only');
select is((select count(*) from ops.admin_audit_log where action = 'pilot.end_vendors' and admin_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), 3::bigint, 'by the calling admin');
select is((select count(*) from ops.admin_audit_log where target like '%@%'), 0::bigint, 'and no audit row holds an email address');
select is((select count(*) from auth.audit_log_entries where position('dddddddd-dddd-dddd-dddd-ddddddddddd' in lower(payload::text)) > 0), 0::bigint, 'and no Auth audit-log entry names a deleted vendor');

select * from finish();
rollback;
