-- WO-0112 (R7b): a vendor member reads its own vendor's id and name and nothing else (grant on (id, name), policy for members of that vendor only). Synthetic and rolled back.
-- u1 member of vendor A, u2 member of vendor B, u3 consumer, u4 vendor with no membership.
begin;
\ir helpers.inc
select plan(12);

create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('01120000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $f$;
create function pg_temp.va() returns uuid language sql immutable as $f$ select 'a1120000-0000-0000-0000-000000000001'::uuid $f$;
create function pg_temp.vb() returns uuid language sql immutable as $f$ select 'b1120000-0000-0000-0000-000000000002'::uuid $f$;
select pg_temp.mk_user(pg_temp.u(n)) from generate_series(1, 4) n;
update app.profiles set role = 'vendor' where id in (pg_temp.u(1), pg_temp.u(2), pg_temp.u(4));
insert into catalog.vendors (id, name) values (pg_temp.va(), 'Zor Vane Outfitters'), (pg_temp.vb(), 'Quillon Threads');
insert into catalog.vendor_members (vendor_id, user_id) values (pg_temp.va(), pg_temp.u(1)), (pg_temp.vb(), pg_temp.u(2));

select is((select array_agg(policyname || ':' || cmd || ':' || roles::text order by policyname) from pg_policies where schemaname = 'catalog' and tablename = 'vendors'),
  array['vendors_member_select:SELECT:{authenticated}'], 'catalog.vendors has one policy: select for authenticated');
select is((select string_agg(c, ',' order by c) from unnest(array['id', 'name', 'created_at']) c where has_column_privilege('authenticated', 'catalog.vendors', c, 'select')), 'id,name', 'authenticated may select id and name only');
select ok(not has_any_column_privilege('authenticated', 'catalog.vendors', 'insert,update,references') and not has_table_privilege('authenticated', 'catalog.vendors', 'delete,truncate,trigger'), 'authenticated has no write grant on catalog.vendors');
select ok(not has_any_column_privilege('anon', 'catalog.vendors', 'select,insert,update,references'), 'anon has no privilege on catalog.vendors');
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select id || '':'' || name from catalog.vendors'), pg_temp.va() || ':Zor Vane Outfitters', 'member A reads its own vendor id and name');
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select count(*) from catalog.vendors'), '1', 'and sees no other vendor (B is invisible)');
select is(pg_temp.val_as(pg_temp.u(2), 'authenticated', 'select name from catalog.vendors'), 'Quillon Threads', 'member B reads its own vendor');
select is(pg_temp.run_as(pg_temp.u(3), 'authenticated', 'select id, name from catalog.vendors'), 'rows=0', 'a consumer sees no vendor');
select is(pg_temp.run_as(pg_temp.u(4), 'authenticated', 'select id, name from catalog.vendors'), 'rows=0', 'a vendor with no membership sees no vendor');
select is(pg_temp.run_as(pg_temp.u(1), 'authenticated', 'select created_at from catalog.vendors'), 'err=42501', 'created_at is unreadable even for a member');
select is(pg_temp.run_as(pg_temp.u(1), 'authenticated', 'select * from catalog.vendors'), 'err=42501', 'select * is refused (it names created_at)');
select is(pg_temp.run_as(pg_temp.u(1), 'authenticated', 'update catalog.vendors set name = ''x'''), 'err=42501', 'a member can not rename its vendor');

select * from finish();
rollback;
