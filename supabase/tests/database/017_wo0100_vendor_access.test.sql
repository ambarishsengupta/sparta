-- WO-0100 (R7a) / CC4: vendor access, agreement, query log, rate limit, ownership mix, coverage and filter options (LLD 4.5, 4.9, 5.4, 5.7, 9.1, 10, 11).
-- (The R7 spec calls this file 016_wo0100_vendor_access; 015 and 016 are WO-0098 and WO-0099's, so the next free number, 017, is used.)
-- Synthetic and rolled back. Vendor users exist only here, made by SQL as postgres: u1 and u2 vendor A (accepted), u3 vendor B (not accepted), u4 two memberships (accepted),
-- u5 vendor role with no membership (accepted for A), u6 eligible consumer, u7 signed in with no profile row, u8 admin, u9 vendor B (accepted), u10 vendor role with nothing.
-- The cube is planted straight into analytics.cube (controlled rows, including rows a run would never publish); the last block feeds the real run.
begin;
\ir helpers.inc
select plan(177);

create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('00100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $f$;
create function pg_temp.va() returns uuid language sql immutable as $f$ select 'a1000000-0000-0000-0000-000000000001'::uuid $f$;
create function pg_temp.vb() returns uuid language sql immutable as $f$ select 'b1000000-0000-0000-0000-000000000002'::uuid $f$;
create function pg_temp.cur() returns date language sql stable as $f$ select date_trunc('month', now() at time zone 'UTC')::date $f$;
select pg_temp.mk_user(pg_temp.u(n)) from generate_series(1, 10) n;
update app.profiles set role = 'vendor' where id in (select pg_temp.u(n) from unnest(array[1, 2, 3, 4, 5, 9, 10]) n);
update app.profiles set role = 'admin' where id = pg_temp.u(8);
select pg_temp.make_eligible(pg_temp.u(6));
delete from app.profiles where id = pg_temp.u(7);
insert into catalog.vendors (id, name) values (pg_temp.va(), 'Zor Vane Outfitters'), (pg_temp.vb(), 'Quillon Threads');
insert into catalog.vendor_members (vendor_id, user_id) values (pg_temp.va(), pg_temp.u(1)), (pg_temp.va(), pg_temp.u(2)), (pg_temp.vb(), pg_temp.u(3)), (pg_temp.va(), pg_temp.u(4)), (pg_temp.vb(), pg_temp.u(4)), (pg_temp.vb(), pg_temp.u(9));
insert into catalog.vendor_agreement_acceptances (vendor_id, user_id, version) values (pg_temp.va(), pg_temp.u(1), '1'), (pg_temp.va(), pg_temp.u(2), '1'), (pg_temp.va(), pg_temp.u(4), '1'), (pg_temp.va(), pg_temp.u(5), '1'), (pg_temp.vb(), pg_temp.u(9), '1');
insert into ops.aggregate_runs (status, finished_at, users_included, items_included, rows_suppressed, duration_ms) values ('ok', now(), 47, 90, 12, 100);
-- columns: kind, period, category, colour_family, fit, brand, size, season, price_band, region, condition_band, users_rounded, users_floor (events_rounded = users_rounded)
insert into analytics.cube (run_id, kind, period, d_category, d_colour_family, d_fit, d_brand, f_size, f_season, f_price_band, f_region, condition_band, users_rounded, events_rounded, users_floor)
  select (select max(id) from ops.aggregate_runs), v.k, v.p, v.c, v.cf, v.fit, v.b, v.sz, v.se, v.pb, v.rg, v.cb, v.ur, v.ur, v.fl from (values
    ('owned', pg_temp.cur(), 'Tops', null, null, null, null, null, null, null, null, 40, 40), ('owned', pg_temp.cur(), 'Bottoms', null, null, null, null, null, null, null, null, 10, 10),
    ('owned', pg_temp.cur(), 'Shoes', null, null, null, null, null, null, null, null, 5, 5), ('owned', pg_temp.cur(), 'Outerwear', null, null, null, null, null, null, null, null, 10, 5),
    ('owned', pg_temp.cur() - interval '1 month', 'Accessories', null, null, null, null, null, null, null, null, 50, 50),
    ('owned', pg_temp.cur(), null, 'Blue', null, null, null, null, null, null, null, 25, 25), ('owned', pg_temp.cur(), null, null, 'Regular', null, null, null, null, null, null, 30, 30),
    ('owned', pg_temp.cur(), null, null, null, 'Aster Loom', null, null, null, null, null, 20, 20), ('owned', pg_temp.cur(), 'Tops', 'Blue', null, null, null, null, null, null, null, 15, 15),
    ('owned', pg_temp.cur(), 'Tops', null, 'Regular', null, null, null, null, null, null, 20, 20), ('owned', pg_temp.cur(), 'Tops', null, null, 'Aster Loom', null, null, null, null, null, 15, 15),
    ('owned', pg_temp.cur(), 'Tops', null, null, null, 'Letter:M', null, null, null, null, 20, 20), ('owned', pg_temp.cur(), 'Tops', null, null, null, 'Letter:S', null, null, null, null, 10, 5),
    ('owned', pg_temp.cur(), 'Tops', null, null, null, 'Letter:XXXL', null, null, null, null, 10, 5), ('owned', pg_temp.cur(), 'Tops', null, null, null, null, 'All year', null, null, null, 15, 15),
    ('owned', pg_temp.cur(), 'Tops', null, null, null, null, null, '25-50', null, null, 10, 10), ('owned', pg_temp.cur(), 'Tops', null, null, null, null, null, null, 'South Asia', null, 40, 40),
    ('owned', pg_temp.cur(), 'Bottoms', null, null, null, null, null, null, 'South Asia', null, 10, 10), ('owned', pg_temp.cur(), 'Tops', null, null, null, null, null, null, null, 'Good', 25, 25),
    ('wishlist', pg_temp.cur(), 'Tops', null, null, null, null, null, null, null, null, 10, 10), ('purchase', pg_temp.cur(), 'Tops', null, null, null, null, null, '100-200', null, null, 10, 10)
  ) v(k, p, c, cf, fit, b, sz, se, pb, rg, cb, ur, fl);

create function pg_temp.call(p_uid uuid, p_role text, p_sql text) returns text language sql as $f$ select case when r like 'err=%' then r else 'ok' end from (select pg_temp.val_as(p_uid, p_role, p_sql) r) q $f$;
create function pg_temp.mix(p_uid uuid, p_args text) returns text language sql as
  $f$ select pg_temp.val_as(p_uid, 'authenticated', format('select coalesce(string_agg(segment || ''='' || users_rounded, '','' order by segment), ''-'') from analytics.ownership_mix(%s)', p_args)) $f$;
create function pg_temp.nlog() returns bigint language sql stable as $f$ select count(*) from ops.vendor_query_log $f$;
create function pg_temp.burst(p_uid uuid, p_n int) returns int language plpgsql as $f$
begin   -- p_n real calls, as the signed-in user
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
  for i in 1..p_n loop perform count(*) from analytics.ownership_mix('category'); end loop;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return p_n;
end $f$;
create temp table fns (n text primary key, q text);
insert into fns values ('ownership_mix', 'select count(*) from analytics.ownership_mix(''category'')'), ('coverage', 'select count(*) from analytics.coverage()'), ('filter_options', 'select count(*) from analytics.filter_options()');
create temp table who (tag text primary key, uid uuid, rl text, want text);
insert into who values ('anon', null, 'anon', 'err=42501: permission denied for schema analytics'), ('consumer', pg_temp.u(6), 'authenticated', 'err=42501: forbidden'),
  ('no profile row', pg_temp.u(7), 'authenticated', 'err=42501: forbidden'), ('admin', pg_temp.u(8), 'authenticated', 'err=42501: forbidden'),
  ('vendor with no membership', pg_temp.u(5), 'authenticated', 'err=42501: forbidden'), ('vendor with two memberships', pg_temp.u(4), 'authenticated', 'err=42501: forbidden'),
  ('vendor without the agreement', pg_temp.u(3), 'authenticated', 'err=P0001: agreement_required'), ('vendor with nothing (agreement is checked before the log)', pg_temp.u(10), 'authenticated', 'err=P0001: agreement_required'),
  ('vendor with the agreement', pg_temp.u(1), 'authenticated', 'ok');
create temp table keep (k text primary key, v bigint);

-- ======== 1. vendor_members: own rows only, no write grant ===============================================================================
select is((select array_agg(policyname || ':' || cmd || ':' || roles::text order by policyname) from pg_policies where schemaname = 'catalog' and tablename = 'vendor_members'),
  array['vendor_members_own_select:SELECT:{authenticated}'], 'LLD 4.5: vendor_members has one policy, select for authenticated');
select is((select qual from pg_policies where policyname = 'vendor_members_own_select'), '(user_id = ( SELECT auth.uid() AS uid))', 'the policy is user_id = (select auth.uid())');
select ok(has_table_privilege('authenticated', 'catalog.vendor_members', 'select') and not has_any_column_privilege('authenticated', 'catalog.vendor_members', 'insert,update,references')
  and not has_table_privilege('authenticated', 'catalog.vendor_members', 'delete,truncate,trigger'), 'authenticated may select vendor_members and nothing else (no write grant)');
select ok(not has_any_column_privilege('anon', 'catalog.vendor_members', 'select,insert,update,references'), 'anon has no privilege on vendor_members');
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select count(*) || ''/'' || count(*) filter (where user_id = (select auth.uid())) from catalog.vendor_members'), '1/1', 'a vendor sees its own membership and no other (u2, u3, u4, u9 are invisible)');
select is(pg_temp.val_as(pg_temp.u(4), 'authenticated', 'select count(*) from catalog.vendor_members'), '2', 'a user with two memberships sees both of its own');
select is(pg_temp.val_as(pg_temp.u(6), 'authenticated', 'select count(*) from catalog.vendor_members'), '0', 'a consumer sees no membership row');
select is(pg_temp.run_as(pg_temp.u(1), 'authenticated', format('insert into catalog.vendor_members (vendor_id, user_id) values (%L, %L)', pg_temp.vb(), pg_temp.u(1))), 'err=42501', 'a vendor cannot add itself to another vendor');
select is(pg_temp.run_as(pg_temp.u(1), 'authenticated', 'delete from catalog.vendor_members'), 'err=42501', 'nor delete a membership');
select is(pg_temp.run_as(pg_temp.u(1), 'authenticated', 'update catalog.vendor_members set vendor_id = vendor_id'), 'err=42501', 'nor change one');
select is(pg_temp.run_as(null, 'anon', 'select 1 from catalog.vendor_members'), 'err=42501', 'anon cannot select memberships');

-- ======== 2. vendor_agreement_acceptances (LLD 4.9, 4.5) ==================================================================================
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'catalog' and table_name = 'vendor_agreement_acceptances'),
  array['vendor_id', 'user_id', 'version', 'accepted_at'], 'the acceptances table has exactly the LLD 4.9 columns');
select is((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'catalog.vendor_agreement_acceptances'::regclass and contype = 'p'), 'PRIMARY KEY (vendor_id, user_id, version)', 'keyed by vendor, user and version');
select is((select string_agg(confrelid::regclass || ':' || confdeltype::text, ',' order by confrelid::regclass::text) from pg_constraint where conrelid = 'catalog.vendor_agreement_acceptances'::regclass and contype = 'f'),
  'app.profiles:c,catalog.vendors:c', 'both keys cascade (deletion is by cascade)');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'catalog.vendor_agreement_acceptances'::regclass), 'RLS is enabled and forced');
select ok(has_table_privilege('authenticated', 'catalog.vendor_agreement_acceptances', 'select') and not has_any_column_privilege('authenticated', 'catalog.vendor_agreement_acceptances', 'update,references')
  and not has_table_privilege('authenticated', 'catalog.vendor_agreement_acceptances', 'delete,truncate,trigger') and not has_table_privilege('authenticated', 'catalog.vendor_agreement_acceptances', 'insert'),
  'authenticated: select, no table-level insert, no update, no delete');
select is((select string_agg(c, ',' order by c) from unnest(array['vendor_id', 'user_id', 'version', 'accepted_at']) c where has_column_privilege('authenticated', 'catalog.vendor_agreement_acceptances', c, 'insert')),
  'user_id,vendor_id,version', 'insert is granted on vendor_id, user_id and version only (accepted_at can not be chosen)');
select ok(not has_any_column_privilege('anon', 'catalog.vendor_agreement_acceptances', 'select,insert,update,references') and not has_any_column_privilege('service_role', 'catalog.vendor_agreement_acceptances', 'select,insert,update,references')
  and not has_table_privilege('service_role', 'catalog.vendor_agreement_acceptances', 'delete,truncate'), 'anon and service_role hold nothing on it');
select is((select array_agg(policyname || ':' || cmd order by policyname) from pg_policies where schemaname = 'catalog' and tablename = 'vendor_agreement_acceptances'),
  array['vendor_acceptances_own_insert:INSERT', 'vendor_acceptances_own_select:SELECT'], 'exactly an insert and a select policy, no update or delete policy');
create function pg_temp.accept(p_uid uuid, p_vendor uuid, p_ver text) returns text language sql as
  $f$ select pg_temp.run_as(p_uid, 'authenticated', format('insert into catalog.vendor_agreement_acceptances (vendor_id, user_id, version) values (%L, %L, %L)', p_vendor, p_uid, p_ver)) $f$;
select is(pg_temp.accept(pg_temp.u(3), pg_temp.va(), '1'), 'err=42501', 'a member of vendor B cannot accept for vendor A');
select is(pg_temp.run_as(pg_temp.u(3), 'authenticated', format('insert into catalog.vendor_agreement_acceptances (vendor_id, user_id, version) values (%L, %L, ''1'')', pg_temp.vb(), pg_temp.u(1))), 'err=42501', 'nor accept in the name of another user');
select is(pg_temp.accept(pg_temp.u(3), pg_temp.vb(), '0'), 'err=42501', 'an old version is refused');
select is(pg_temp.accept(pg_temp.u(3), pg_temp.vb(), '2'), 'err=42501', 'a version that is not the current one is refused');
select is(pg_temp.accept(pg_temp.u(6), pg_temp.va(), '1'), 'err=42501', 'a consumer (no membership) is refused');
select is(pg_temp.run_as(pg_temp.u(3), 'authenticated', format('insert into catalog.vendor_agreement_acceptances (vendor_id, user_id, version, accepted_at) values (%L, %L, ''1'', now())', pg_temp.vb(), pg_temp.u(3))), 'err=42501', 'choosing accepted_at is refused (no column grant)');
select is((select count(*) from catalog.vendor_agreement_acceptances where user_id = pg_temp.u(3)), 0::bigint, 'none of the refused inserts left a row');
select is(pg_temp.accept(pg_temp.u(3), pg_temp.vb(), '1'), 'rows=1', 'the member of vendor B accepts for its own vendor at the current version');
select is(pg_temp.accept(pg_temp.u(3), pg_temp.vb(), '1'), 'err=23505', 'a second identical acceptance is a duplicate');
select is(pg_temp.run_as(pg_temp.u(3), 'authenticated', 'update catalog.vendor_agreement_acceptances set version = ''9'''), 'err=42501', 'no update');
select is(pg_temp.run_as(pg_temp.u(3), 'authenticated', 'delete from catalog.vendor_agreement_acceptances'), 'err=42501', 'no delete');
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select count(*) || ''/'' || min(version) from catalog.vendor_agreement_acceptances'), '1/1', 'a vendor selects its own acceptance row only (not u2, u4, u5, u9)');
select is(pg_temp.val_as(pg_temp.u(6), 'authenticated', 'select count(*) from catalog.vendor_agreement_acceptances'), '0', 'a consumer sees none');
delete from catalog.vendor_agreement_acceptances where user_id = pg_temp.u(3);

-- ======== 3. the log table and its writer ===================================================================================================
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'ops' and table_name = 'vendor_query_log'),
  array['id', 'vendor_id', 'user_id', 'fn', 'params', 'called_at'], 'ops.vendor_query_log has the LLD 5.7 columns');
select ok(exists (select 1 from pg_indexes where schemaname = 'ops' and tablename = 'vendor_query_log' and indexdef ~ '\(vendor_id, called_at\)'), 'index on (vendor_id, called_at)');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'ops.vendor_query_log'::regclass), 'RLS is enabled and forced on the log');
select ok(not has_any_column_privilege(r, 'ops.vendor_query_log', 'select,insert,update,references') and not has_table_privilege(r, 'ops.vendor_query_log', 'delete,truncate,trigger'),
  r || ' has no privilege on ops.vendor_query_log') from unnest(array['anon', 'authenticated', 'service_role']) r;
select ok(not has_sequence_privilege(r, 'ops.vendor_query_log_id_seq', 'usage,select,update'), r || ' has no privilege on the log sequence') from unnest(array['anon', 'authenticated']) r;
select is(pg_temp.run_as(pg_temp.u(1), 'authenticated', 'select 1 from ops.vendor_query_log'), 'err=42501', 'a vendor cannot read the log');
select is(pg_temp.run_as(pg_temp.u(1), 'authenticated', format('insert into ops.vendor_query_log (vendor_id, user_id, fn) values (%L, %L, ''x'')', pg_temp.va(), pg_temp.u(1))), 'err=42501', 'nor write a row');
select ok(not has_function_privilege(r, 'analytics.log_and_limit(text, jsonb)', 'execute'), 'analytics.log_and_limit is executable by no ' || r) from unnest(array['public', 'anon', 'authenticated', 'service_role']) r;
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select analytics.log_and_limit(''x'', ''{}'')'), 'err=42501: permission denied for function log_and_limit', 'a vendor calling log_and_limit directly gets 42501');
select is((select prosecdef from pg_proc where oid = 'analytics.log_and_limit(text, jsonb)'::regprocedure), true, 'log_and_limit is security definer');
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.cube'), 'err=42501: permission denied for table cube', 'a vendor cannot read analytics.cube directly');
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select count(*) from analytics_private.q_ownership_mix(''category'', null, null)'), 'err=42501: permission denied for schema analytics_private', 'nor reach the internal functions');

-- ======== 4. the functions: shape and grants ================================================================================================
create temp table w3 as select p.oid, p.proname::text n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('ownership_mix', 'coverage', 'filter_options');
select is((select count(*) from w3), 3::bigint, 'the three wrappers exist in schema analytics');
select is_empty($$ select n from w3 where not (select prosecdef from pg_proc where oid = w3.oid) $$, 'all three are security definer');
select is_empty($$ select n from w3 where (select provolatile from pg_proc where oid = w3.oid) <> 'v' $$, 'all three are volatile (each writes the log)');
select is_empty($$ select n from w3 where (select proconfig from pg_proc where oid = w3.oid) is distinct from array['search_path=""'] $$, 'all three pin search_path');
select is_empty($$ select n from w3 where not has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('anon', oid, 'execute') or has_function_privilege('service_role', oid, 'execute')
  or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = w3.oid and a.grantee = 0) $$, 'executable by authenticated only (not public, anon or service_role)');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p where p.pronamespace in ('analytics'::regnamespace, 'analytics_private'::regnamespace) and p.oid not in (select oid from w3)
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
       or exists (select 1 from pg_proc q, aclexplode(q.proacl) a where q.oid = p.oid and a.grantee = 0)) $$, 'every other function in analytics and analytics_private is executable by no client role');
select is((select pg_get_function_result('analytics.ownership_mix(text, text, text)'::regprocedure)), 'TABLE(segment text, users_rounded integer)', 'ownership_mix returns a segment and a rounded count only');
select is((select pg_get_function_result('analytics.coverage()'::regprocedure)), 'TABLE(users_rounded integer, last_run_at timestamp with time zone)', 'coverage returns a rounded count and the run time only');
select is((select pg_get_function_result('analytics.filter_options()'::regprocedure)), 'TABLE(filter_dim text, filter_value text)', 'filter_options returns names and values only');
select is((select pg_get_function_arguments('analytics.ownership_mix(text, text, text)'::regprocedure)), 'p_dim text, p_filter_dim text DEFAULT NULL::text, p_filter_value text DEFAULT NULL::text', 'ownership_mix takes p_dim, p_filter_dim and p_filter_value');
select is_empty($$ select p.proname from pg_proc p where p.pronamespace = 'analytics_private'::regnamespace and p.proname in ('vendor_guard', 'q_ownership_mix', 'q_coverage', 'q_filter_options', 'build_facts')
  and p.prosrc ~* '(execute\s+(format|''|"))' $$, 'no dynamic SQL in the guard or the internal functions');
select is((select prosrc ~ 'is distinct from ''vendor''' from pg_proc where oid = 'analytics_private.vendor_guard(text, jsonb)'::regprocedure), true, 'the guard checks the role with is distinct from (a null role is refused)');

-- ======== 5. the role matrix: every caller x every function, and refused calls leave no log row =============================================
delete from ops.vendor_query_log;
select is(pg_temp.call(w.uid, w.rl, f.q), w.want, w.tag || ': ' || f.n) from who w cross join fns f order by w.tag, f.n;
select is(pg_temp.nlog(), 3::bigint, 'only the three answered calls (u1) wrote a log row; the 24 refused calls wrote none');
select is((select count(*) from ops.vendor_query_log where user_id <> pg_temp.u(1)), 0::bigint, 'no refused caller has a log row');

-- ======== 6. agreement version, maintenance and the order of the checks ======================================================================
update ops.settings set value = '2' where key = 'current_vendor_agreement_version';
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.coverage()'), 'err=P0001: agreement_required', 'a new agreement version refuses a vendor who accepted only the old one (not any version)');
select is(pg_temp.accept(pg_temp.u(1), pg_temp.va(), '1'), 'err=42501', 'and the old version can no longer be accepted');
select is(pg_temp.accept(pg_temp.u(1), pg_temp.va(), '2'), 'rows=1', 'the vendor accepts the new version');
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.coverage()'), 'ok', 'and is answered');
select is(pg_temp.call(pg_temp.u(2), 'authenticated', 'select count(*) from analytics.coverage()'), 'err=P0001: agreement_required', 'a colleague who has not accepted it is still refused');
update ops.settings set value = '1' where key = 'current_vendor_agreement_version';
delete from catalog.vendor_agreement_acceptances where version = '2';
delete from ops.settings where key = 'current_vendor_agreement_version';
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.coverage()'), 'err=P0001: agreement_required', 'a missing agreement setting refuses the call (null never matches)');
insert into ops.settings (key, value) values ('current_vendor_agreement_version', '1');
delete from ops.vendor_query_log;
update ops.settings set value = 'on' where key = 'maintenance';
select is(pg_temp.call(pg_temp.u(1), 'authenticated', f.q), 'err=P0001: maintenance', 'maintenance on: ' || f.n) from fns f order by f.n;
select is(pg_temp.call(pg_temp.u(6), 'authenticated', 'select count(*) from analytics.coverage()'), 'err=42501: forbidden', 'maintenance on: a consumer still gets forbidden (role is checked first)');
select is(pg_temp.call(pg_temp.u(3), 'authenticated', 'select count(*) from analytics.coverage()'), 'err=P0001: agreement_required', 'maintenance on: a vendor without the agreement gets agreement_required (agreement before maintenance)');
select is(pg_temp.nlog(), 0::bigint, 'maintenance wrote no log row');
update ops.settings set value = 'maybe' where key = 'maintenance';
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.coverage()'), 'err=P0001: maintenance', 'any value but off refuses (fail closed)');
update ops.settings set value = 'off' where key = 'maintenance';
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.coverage()'), 'ok', 'maintenance off: answered again');

-- ======== 7. ownership_mix: dimensions, filters, thresholds, planted rows ===================================================================
select is(pg_temp.mix(pg_temp.u(1), $$'category'$$), 'Bottoms=10,Tops=40', 'FR-72: category mix (Shoes with users_floor 5, Outerwear rounded to 10 from a floor of 5 and last month''s Accessories are not returned)');
select is(pg_temp.mix(pg_temp.u(1), $$'colour_family'$$), 'Blue=25', 'colour_family mix');
select is(pg_temp.mix(pg_temp.u(1), $$'fit'$$), 'Regular=30', 'fit mix');
select is(pg_temp.mix(pg_temp.u(1), $$'brand'$$), 'Aster Loom=20', 'brand mix');
select is(pg_temp.mix(pg_temp.u(1), $$'category_colour_family'$$), 'Tops / Blue=15', 'category_colour_family mix');
select is(pg_temp.mix(pg_temp.u(1), $$'category_fit'$$), 'Tops / Regular=20', 'category_fit mix');
select is(pg_temp.mix(pg_temp.u(1), $$'category_brand'$$), 'Tops / Aster Loom=15', 'category_brand mix');
select is(pg_temp.mix(pg_temp.u(1), $$'category', 'size', 'Letter:M'$$), 'Tops=20', 'FR-77: size filter (Bottoms is visible without the filter and absent with it)');
select is(pg_temp.mix(pg_temp.u(1), $$'category', 'region', 'South Asia'$$), 'Bottoms=10,Tops=40', 'region filter');
select is(pg_temp.mix(pg_temp.u(1), $$'category', 'season', 'All year'$$), 'Tops=15', 'season filter');
select is(pg_temp.mix(pg_temp.u(1), $$'category', 'price_band', '25-50'$$), 'Tops=10', 'price_band filter');
select is(pg_temp.mix(pg_temp.u(1), $$'category', 'size', 'Letter:S'$$), '-', 'a filter value whose only row has users_floor 5 returns nothing');
select is(pg_temp.mix(pg_temp.u(1), $$'colour_family', 'size', 'Letter:M'$$), '-', 'a combination with no row returns nothing');
select is(pg_temp.mix(pg_temp.u(1), $$'category', 'size', 'Letter:M''; drop table analytics.cube; --'$$), '-', 'a value with a quote and a semicolon is just a value that matches nothing');
select ok((select count(*) from analytics.cube) > 0, 'and the cube is still there');
select is(pg_temp.mix(pg_temp.u(1), $$'category', 'size', ''$$), '-', 'an empty value matches nothing');
select is_empty($$ select d || '/' || coalesce(f, '-') from (values ('category'), ('colour_family'), ('fit'), ('brand'), ('category_colour_family'), ('category_fit'), ('category_brand')) d(d)
  cross join (values (null), ('size'), ('season'), ('price_band'), ('region')) f(f)
  where pg_temp.call(pg_temp.u(1), 'authenticated', format('select count(*) from analytics.ownership_mix(%L, %L, %L)', d, f, case when f is null then null else 'x' end)) <> 'ok' $$, 'all seven dimensions and all four filters are accepted');
delete from ops.vendor_query_log;
create temp table bad (n int, a text);
insert into bad values (1, $$'colour'$$), (2, $$'category; drop table analytics.cube'$$), (3, $$'Category'$$), (4, $$''$$), (5, 'null'), (6, $$'user_hash'$$), (7, $$'category', 'bogus', 'x'$$),
  (8, $$'category', 'size'$$), (9, $$'category', null, 'x'$$), (10, $$'category', 'Size', 'x'$$), (11, $$'category', 'size or 1=1', 'x'$$), (12, $$'category', 'category', 'x'$$),
  (13, $$'category', 'size', repeat('x', 101)$$), (14, $$'category', 'd_category', 'Tops'$$);
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.ownership_mix(' || a || ')'), 'err=P0001: invalid_dimension', 'invalid_dimension for ownership_mix(' || a || ')') from bad order by n;
select is(pg_temp.nlog(), 0::bigint, 'a call refused with invalid_dimension writes no log row');
select is(pg_temp.val_as(pg_temp.u(6), 'authenticated', 'select count(*) from analytics.ownership_mix(''colour'')'), 'err=42501: forbidden', 'a consumer gets forbidden, not invalid_dimension (no hint about the whitelist)');

-- ======== 8. coverage and filter_options ======================================================================================================
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select users_rounded from analytics.coverage()'), '45', 'coverage: 47 users of the last good run, rounded to 45');
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select last_run_at::text from analytics.coverage()'), (select finished_at::text from ops.aggregate_runs where status = 'ok' order by id desc limit 1), 'coverage: the run time is the last good run');
insert into ops.aggregate_runs (status, error_code, finished_at, users_included) values ('error', 'run_failed', now() + interval '1 minute', 1000);
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select users_rounded from analytics.coverage()'), '45', 'a later failed run does not change coverage');
create function pg_temp.cov(p_users int) returns text language plpgsql as $f$ begin
  update ops.aggregate_runs set users_included = p_users where status = 'ok';
  return coalesce(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select coalesce(users_rounded::text, ''null'') from analytics.coverage()'), 'none'); end $f$;
select is(pg_temp.cov(9), 'null', 'coverage: 9 users (rounds up to 10) is under the minimum and is not shown');
select is(pg_temp.cov(10), '10', 'coverage: 10 users is shown as 10');
select is(pg_temp.cov(13), '15', 'coverage: 13 users rounds to 15');
select is(pg_temp.cov(47), '45', 'back to 47 users, 45');
create function pg_temp.fopt(p_uid uuid) returns text language sql as
  $f$ select pg_temp.val_as(p_uid, 'authenticated', 'select coalesce(string_agg(filter_dim || '':'' || filter_value, '','' order by filter_dim, filter_value), ''-'') from analytics.filter_options()') $f$;
select is(pg_temp.fopt(pg_temp.u(1)), 'price_band:100-200,price_band:25-50,region:South Asia,season:All year,size:Letter:M',
  'FR-77: filter_options lists the values with a visible row (any kind), and not Letter:S or Letter:XXXL (users_floor 5)');

-- ======== 9. the threshold is read at call time (BR-26) and the planted-row defence ===========================================================
update ops.settings set value = '50' where key = 'min_group_size';
select is(pg_temp.mix(pg_temp.u(1), $$'category'$$), '-', 'with min_group_size 50 the 40-user category is not returned');
select is(pg_temp.fopt(pg_temp.u(1)), '-', 'nor any filter option');
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select coalesce(users_rounded::text, ''null'') from analytics.coverage()'), 'null', 'nor a cohort of 47');
update ops.settings set value = '10' where key = 'min_group_size';
delete from analytics.cube where users_floor >= 10;
select is(pg_temp.mix(pg_temp.u(1), $$'category'$$), '-', 'LLD 5.4 defence in depth: with only rows inserted straight into the cube under the threshold (floor 5, rounded 5 or 10), no function returns one');
select is(pg_temp.fopt(pg_temp.u(1)), '-', 'filter_options returns none of them either');
select is((select count(*) from analytics.cube), 4::bigint, 'the planted rows are still in the cube (they were not removed, only never returned)');

-- ======== 10. log contents ====================================================================================================================
delete from ops.vendor_query_log;
select pg_temp.call(pg_temp.u(1), 'authenticated', $$select count(*) from analytics.ownership_mix('category', 'size', 'Letter:M')$$) as r \gset
select pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.coverage()') as r \gset
select pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.filter_options()') as r \gset
select pg_temp.call(pg_temp.u(2), 'authenticated', $$select count(*) from analytics.ownership_mix('fit', 'size', $q$x'; drop table analytics.cube; --$q$)$$) as r \gset
select is(pg_temp.nlog(), 4::bigint, 'four answered calls, four log rows');
select is((select vendor_id::text || '/' || user_id::text || '/' || params::text from ops.vendor_query_log where fn = 'ownership_mix' and user_id = pg_temp.u(1))::text,
  pg_temp.va()::text || '/' || pg_temp.u(1)::text || '/' || '{"dim": "category", "filter_dim": "size", "filter_value": "Letter:M"}', 'a row holds the vendor, the user, the function and the parameters');
select is((select params from ops.vendor_query_log where fn = 'coverage'), '{}'::jsonb, 'coverage logs empty parameters');
select is((select params from ops.vendor_query_log where fn = 'filter_options'), '{}'::jsonb, 'filter_options logs empty parameters');
select is((select vendor_id::text || '/' || user_id::text || '/' || (params->>'filter_value') from ops.vendor_query_log where user_id = pg_temp.u(2)), pg_temp.va()::text || '/' || pg_temp.u(2)::text || '/' || 'x''; drop table analytics.cube; --',
  'a colleague''s call is logged under the same vendor with the value kept as plain text');
select is_empty($$ select 1 from ops.vendor_query_log l, jsonb_object_keys(l.params) k where k not in ('dim', 'filter_dim', 'filter_value') $$, 'parameters hold dimension names and filter values only');
select ok((select bool_and(called_at > now() - interval '1 minute' and called_at <= now()) from ops.vendor_query_log), 'called_at is the call time');

-- a vendor's calls are counted one at a time: another session holding that vendor's advisory lock makes the call wait (a lock timeout here), another vendor is not held up.
-- Vendor B's lock is used because this transaction has not called as vendor B yet (an advisory xact lock is held until the end of the transaction).
-- (dblink and the stack's default local login, as in 016; the session that holds the lock is closed again at once)
create extension if not exists dblink schema extensions;
select extensions.dblink_connect('lk', format('host=%s dbname=postgres user=postgres password=postgres', coalesce(host(inet_server_addr()), '127.0.0.1')));
select is((select x from extensions.dblink('lk', format('select pg_try_advisory_lock(hashtextextended(''vendor_query_log:%s'', 0))::text', pg_temp.vb())) as t(x text)), 'true', 'another session holds the advisory lock of vendor B');
set local lock_timeout = '300ms';
select is(pg_temp.call(pg_temp.u(9), 'authenticated', 'select count(*) from analytics.coverage()'), 'err=55P03: canceling statement due to lock timeout', 'FR-88: while another session holds the vendor''s lock the call waits (lock timeout)');
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.coverage()'), 'ok', 'another vendor is not held up');
reset lock_timeout;
select extensions.dblink_disconnect('lk');
delete from ops.settings where key = 'maintenance';
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.coverage()'), 'err=P0001: maintenance', 'a missing maintenance setting refuses the call (fail closed)');
insert into ops.settings (key, value) values ('maintenance', 'off');

-- ======== 11. the rate limit: 200 answered calls of one vendor (two users together), the 201st is refused ===================================
delete from ops.vendor_query_log;
select pg_temp.burst(pg_temp.u(1), 100) + pg_temp.burst(pg_temp.u(2), 100) as calls \gset
select is(:calls, 200, '200 calls were answered (100 by u1 and 100 by u2)');
select is((select count(*) || '/' || count(distinct user_id) from ops.vendor_query_log where vendor_id = pg_temp.va()), '200/2', 'FR-88: 200 log rows, two users, one vendor');
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.ownership_mix(''category'')'), 'err=P0001: rate_limited', 'the 201st call (u1) raises rate_limited');
select is(pg_temp.call(pg_temp.u(2), 'authenticated', 'select count(*) from analytics.coverage()'), 'err=P0001: rate_limited', 'the limit counts both users together, and covers coverage');
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.filter_options()'), 'err=P0001: rate_limited', 'and filter_options (one shared guard)');
select is(pg_temp.nlog(), 200::bigint, 'the refused calls wrote no log row');
select is(pg_temp.call(pg_temp.u(9), 'authenticated', 'select count(*) from analytics.coverage()'), 'ok', 'another vendor is not affected');
update ops.vendor_query_log set called_at = now() - interval '59 minutes' where id = (select min(id) from ops.vendor_query_log);
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.coverage()'), 'err=P0001: rate_limited', 'a row 59 minutes old still counts');
update ops.vendor_query_log set called_at = now() - interval '61 minutes' where id = (select min(id) from ops.vendor_query_log where vendor_id = pg_temp.va());
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.coverage()'), 'ok', 'a row older than one hour is not counted: the call is answered');
select is(pg_temp.call(pg_temp.u(2), 'authenticated', 'select count(*) from analytics.coverage()'), 'err=P0001: rate_limited', 'and the window is full again');

-- ======== 12. the real run feeds the functions =================================================================================================
delete from ops.vendor_query_log;
delete from analytics.cube;
insert into auth.users (id, email) select md5('wo0100:' || g)::uuid, md5('wo0100:' || g) || '@example.test' from generate_series(1, 19) g;
update app.profiles set country = 'IN', hemisphere = 'north', age_confirmed = true where id in (select md5('wo0100:' || g)::uuid from generate_series(1, 19) g);
insert into app.consent_records (user_id, notice_version) select md5('wo0100:' || g)::uuid, '1' from generate_series(1, 19) g;
insert into app.document_acceptances (user_id, document, version) select md5('wo0100:' || g)::uuid, d, '1' from generate_series(1, 19) g, unnest(array['terms', 'privacy_policy']) d;
insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin)
  select md5('wo0100:' || g)::uuid, 'x', case when g <= 10 then 'Tops' else 'Bottoms' end, case when g <= 10 then 'Polo' else 'Jeans' end, 0, 0, 139, 'manual' from generate_series(1, 19) g;
select analytics.run_aggregation() as run_id \gset
select is((select status from ops.aggregate_runs where id = :run_id), 'ok', 'the aggregation run finished ok');
select is(pg_temp.mix(pg_temp.u(1), $$'category'$$), 'Tops=10', 'FR-80: a segment of 10 users is returned and a segment of 9 is not');
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select users_rounded from analytics.coverage()'), '20', 'coverage after the run: 19 users, 20');
select is(pg_temp.mix(pg_temp.u(6), $$'category'$$), 'err=42501: forbidden', 'a consumer is refused after the run too');

select * from finish();
rollback;
