-- WO-0102 (R7a) / CC6 (reduced scope of 2026-11-12): ops.reports, analytics.build_report (service_role only, payload of published rounded figures), analytics.reports() and
-- analytics.report(p_id) (reviewed rows only, behind the WO-0100 guard). (The R7 spec would call this file 018_...; 018 is WO-0101's, so the next free number, 019, is used.)
-- Synthetic and rolled back. u1 vendor A (agreement accepted), u2 vendor B (not accepted), u3 eligible consumer, u4 admin, u5 vendor with no membership. 40 eligible consumers own one
-- Tops item each (bands of 9, 10, 10 and 11 users); 20 have an open Tops entry created this month and 10 more one created last month; a real aggregation run feeds build_report.
-- A planted cube row under the threshold ('Hats') proves the payload never uses one. The seed script is checked by seed-demo-insights.test.ts and the idempotence shell check.
begin;
\ir helpers.inc
select plan(64);

create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('00102000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $f$;
create function pg_temp.g(n int) returns uuid language sql immutable as $f$ select md5('wo0102:' || n)::uuid $f$;
create function pg_temp.va() returns uuid language sql immutable as $f$ select 'a1020000-0000-0000-0000-000000000001'::uuid $f$;
create function pg_temp.vb() returns uuid language sql immutable as $f$ select 'b1020000-0000-0000-0000-000000000002'::uuid $f$;
create function pg_temp.mo(n int) returns date language sql stable as $f$ select (date_trunc('month', now() at time zone 'UTC') - make_interval(months => n))::date $f$;
select pg_temp.mk_user(pg_temp.u(n)) from generate_series(1, 5) n;
update app.profiles set role = 'vendor' where id in (pg_temp.u(1), pg_temp.u(2), pg_temp.u(5));
update app.profiles set role = 'admin' where id = pg_temp.u(4);
select pg_temp.make_eligible(pg_temp.u(3));
insert into catalog.vendors (id, name) values (pg_temp.va(), 'Zor Vane Outfitters'), (pg_temp.vb(), 'Quillon Threads');
insert into catalog.vendor_members (vendor_id, user_id) values (pg_temp.va(), pg_temp.u(1)), (pg_temp.vb(), pg_temp.u(2));
insert into catalog.vendor_agreement_acceptances (vendor_id, user_id, version) values (pg_temp.va(), pg_temp.u(1), '1'), (pg_temp.va(), pg_temp.u(5), '1');
insert into auth.users (id, email) select pg_temp.g(g), md5('wo0102:' || g) || '@example.test' from generate_series(1, 40) g;
update app.profiles set country = 'IN', hemisphere = 'north', age_confirmed = true where id in (select pg_temp.g(g) from generate_series(1, 40) g);
insert into app.consent_records (user_id, notice_version) select pg_temp.g(g), '1' from generate_series(1, 40) g;
insert into app.document_acceptances (user_id, document, version) select pg_temp.g(g), d, '1' from generate_series(1, 40) g, unnest(array['terms', 'privacy_policy']) d;
insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, condition)
  select pg_temp.g(g), 'x', 'Tops', 'T-shirt', 0, 0, 139, 'manual', case when g <= 9 then 5 when g <= 19 then 20 when g <= 29 then 40 else 70 end from generate_series(1, 40) g;
insert into app.wishlist_entries (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin) select pg_temp.g(g), 'w', 'Tops', 'T-shirt', 0, 0, 139, 'user' from generate_series(1, 20) g;
insert into app.wishlist_entries (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, created_at)
  select pg_temp.g(g), 'w', 'Tops', 'T-shirt', 0, 0, 139, 'user', pg_temp.mo(1)::timestamptz + interval '10 days 12 hours' from generate_series(21, 30) g;
select analytics.run_aggregation() as run_id \gset
-- rows a run would never publish: under the threshold (floor 5, rounded 10) for a category 'Hats' in this and last month
insert into analytics.cube (run_id, kind, period, d_category, d_colour_family, users_rounded, events_rounded, users_floor)
  select :run_id, v.k, v.p, 'Hats', 'Blue', 10, 10, 5 from (values ('owned', pg_temp.mo(0)), ('wishlist_open', pg_temp.mo(0)), ('wishlist', pg_temp.mo(0)), ('wishlist', pg_temp.mo(1))) v(k, p);
insert into analytics.cube (run_id, kind, period, d_category, users_rounded, events_rounded, users_floor)
  select :run_id, v.k, v.p, 'Hats', 10, 10, 5 from (values ('wishlist', pg_temp.mo(0)), ('wishlist', pg_temp.mo(1))) v(k, p);
create function pg_temp.call(p_uid uuid, p_role text, p_sql text) returns text language sql as $f$ select case when r like 'err=%' then r else 'ok' end from (select pg_temp.val_as(p_uid, p_role, p_sql) r) q $f$;
create function pg_temp.vv(p_sql text) returns text language sql as $f$ select pg_temp.val_as(pg_temp.u(1), 'authenticated', p_sql) $f$;
create function pg_temp.nlog() returns bigint language sql stable as $f$ select count(*) from ops.vendor_query_log $f$;
-- rows other tests (or a web test run) left in the table are not this file's business: test 15 compares the count taken here with the count after the refused calls and the first successful build_report call
create temp table nlog0 as select pg_temp.nlog() as n;

-- ======== 1. the table: columns, row level security, no client grant ===================================================================
select is((select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns where table_schema = 'ops' and table_name = 'reports'),
  'id,period,generated_at,reviewed_by,reviewed_at,payload', 'ops.reports has exactly the columns of LLD 5.5');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'ops.reports'::regclass), 'row level security is enabled and forced on ops.reports');
select is_empty($$ select r from unnest(array['anon', 'authenticated', 'service_role']) r where has_table_privilege(r, 'ops.reports', 'select,insert,update,delete,truncate,references,trigger')
  or has_any_column_privilege(r, 'ops.reports', 'select,insert,update') $$, 'anon, authenticated and service_role hold no privilege on ops.reports');
select is(pg_temp.run_as(pg_temp.u(4), 'service_role', 'select * from ops.reports'), 'err=42501', 'service_role can not read the table directly either (reports are read through the functions)');

-- ======== 2. build_report: service_role only ===========================================================================================
select ok((select prosecdef and provolatile = 'v' and proconfig = array['search_path=""'] from pg_proc where oid = 'analytics.build_report(date)'::regprocedure), 'build_report is security definer, volatile, search_path pinned');
select ok(has_function_privilege('service_role', 'analytics.build_report(date)', 'execute') and not has_function_privilege('authenticated', 'analytics.build_report(date)', 'execute')
  and not has_function_privilege('anon', 'analytics.build_report(date)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'analytics.build_report(date)'::regprocedure and a.grantee = 0), 'build_report is executable by service_role only (not public, anon or authenticated)');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p where p.pronamespace in ('analytics'::regnamespace, 'analytics_private'::regnamespace) and p.proname <> 'build_report'
  and has_function_privilege('service_role', p.oid, 'execute') $$, 'service_role can execute no other function in analytics or analytics_private');
select ok(has_schema_privilege('service_role', 'analytics', 'usage') and not has_schema_privilege('service_role', 'analytics_private', 'usage') and not has_schema_privilege('anon', 'analytics', 'usage'),
  'service_role has usage on analytics (and nothing on analytics_private); anon has none');
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select analytics.build_report(current_date)'), 'err=42501: permission denied for function build_report', 'a vendor can not call build_report');
select is(pg_temp.val_as(pg_temp.u(3), 'authenticated', 'select analytics.build_report(current_date)'), 'err=42501: permission denied for function build_report', 'a consumer can not call build_report');
select is(pg_temp.val_as(pg_temp.u(4), 'authenticated', 'select analytics.build_report(current_date)'), 'err=42501: permission denied for function build_report', 'an admin session (authenticated) can not call it either: only the server key');
select is(pg_temp.val_as(null, 'anon', 'select analytics.build_report(current_date)'), 'err=42501: permission denied for schema analytics', 'anon can not call build_report');
select is((select count(*) from ops.reports), 0::bigint, 'the refused calls wrote no report');
select is(pg_temp.val_as(null, 'service_role', 'select analytics.build_report(null)'), 'err=P0001: unsupported_period', 'a null period raises unsupported_period');

-- ======== 3. the payload ===============================================================================================================
select pg_temp.val_as(null, 'service_role', format('select analytics.build_report(%L)', pg_temp.mo(0) + 16)) as r1 \gset
select is(pg_temp.nlog() - (select n from nlog0), 0::bigint, 'build_report, refused or answered, runs no vendor checks and writes no query log row');
select is((select count(*) from ops.reports), 1::bigint, 'service_role built one report');
select is((select period from ops.reports where id = :'r1'::uuid), pg_temp.mo(0), 'the period is normalised to the first of the month');
select ok((select reviewed_at is null and reviewed_by is null from ops.reports where id = :'r1'::uuid), 'a new report is unreviewed');
select is((select string_agg(k, ',' order by k) from ops.reports r, jsonb_object_keys(r.payload) k where r.id = :'r1'::uuid),
  'condition_spectrum,coverage,cube_first_period,cube_last_period,gaps,period,rising_wishlist', 'the payload has exactly the seven keys');
select is((select payload -> 'coverage' ->> 'users_rounded' from ops.reports where id = :'r1'::uuid), '40', 'coverage: the rounded cohort of the run (40)');
select ok((select (payload -> 'coverage' ->> 'last_run_at')::timestamptz = (select finished_at from ops.aggregate_runs where id = :run_id) from ops.reports where id = :'r1'::uuid), 'coverage: the run time is the last ok run''s finish time');
select is((select payload ->> 'cube_first_period' || ' ' || (payload ->> 'cube_last_period') from ops.reports where id = :'r1'::uuid), pg_temp.mo(1)::text || ' ' || pg_temp.mo(0)::text,
  'the cube''s first and last period (last month, this month)');
select is((select payload -> 'gaps' -> 0 ->> 'segment' from ops.reports where id = :'r1'::uuid), 'Tops / ' || catalog.colour_family(0, 0, 139), 'gaps are on category x colour family');
select is((select (payload -> 'gaps' -> 0 ->> 'owner_users_rounded') || '/' || (payload -> 'gaps' -> 0 ->> 'wishlist_users_rounded') || '/' || (payload -> 'gaps' -> 0 ->> 'gap_score')
  from ops.reports where id = :'r1'::uuid), '40/30/0.8', 'the gap is wishlist_open users over owned users, both rounded (30 of 40 = 0.8); a user counts once');
select is((select jsonb_array_length(payload -> 'gaps') from ops.reports where id = :'r1'::uuid), 1, 'only the visible gap is listed (the planted Hats row under the threshold is not)');
select is((select payload -> 'rising_wishlist' from ops.reports where id = :'r1'::uuid), '[{"segment": "Tops", "increase": 10, "users_rounded": 20, "previous_users_rounded": 10}]'::jsonb,
  'rising wishlist: a category whose wishlist users rose from last month to the report month (10 to 20), both rows visible');
select is((select jsonb_array_length(payload -> 'condition_spectrum') from ops.reports where id = :'r1'::uuid), (select count(*)::int from catalog.lk_category where active), 'the condition spectrum covers every active category');
select is((select e -> 'bands' from ops.reports r, jsonb_array_elements(r.payload -> 'condition_spectrum') e where r.id = :'r1'::uuid and e ->> 'category' = 'Tops'),
  (select jsonb_agg(jsonb_build_object('band', s.band, 'share', s.share) order by s.n) from analytics_private.q_condition_spectrum('Tops') with ordinality s(band, share, n)),
  'the Tops bands are those of the guarded function (the 9-user band has a null share)');
select ok((select e -> 'bands' -> 0 ->> 'share' is null from ops.reports r, jsonb_array_elements(r.payload -> 'condition_spectrum') e where r.id = :'r1'::uuid and e ->> 'category' = 'Tops'), 'the hidden band (9 users) has a null share in the report');
select ok(not jsonb_path_exists((select payload from ops.reports where id = :'r1'::uuid), '$.gaps[*] ? (@.owner_users_rounded % 5 != 0 || @.wishlist_users_rounded % 5 != 0)')
  and not jsonb_path_exists((select payload from ops.reports where id = :'r1'::uuid), '$.rising_wishlist[*] ? (@.users_rounded % 5 != 0 || @.previous_users_rounded % 5 != 0 || @.increase % 5 != 0)')
  and not jsonb_path_exists((select payload from ops.reports where id = :'r1'::uuid), '$.condition_spectrum[*].bands[*] ? (@.share % 5 != 0)')
  and not jsonb_path_exists((select payload from ops.reports where id = :'r1'::uuid), '$.coverage ? (@.users_rounded % 5 != 0)'), 'every count in the payload is a multiple of 5 and every share a multiple of 5 points');
select ok((select payload::text !~ ('Hats|[0-9a-f]{64}|@|user_hash|' || (select string_agg(pg_temp.g(g)::text, '|') from generate_series(1, 40) g)) from ops.reports where id = :'r1'::uuid), 'the payload holds no planted row, no hash, no user id and no address');
select is(pg_temp.val_as(null, 'service_role', format('select analytics.build_report(%L)', pg_temp.mo(1))) ~ '^[0-9a-f-]{36}$', true, 'build_report returns the id of the new report (a second one, for last month)');
select is((select count(*) from ops.reports), 2::bigint, 'two reports now exist');

-- ======== 4. analytics.reports() and analytics.report(p_id): reviewed rows only, behind the guard =====================================
select r2 from (select id as r2 from ops.reports where id <> :'r1'::uuid) q \gset
update ops.reports set reviewed_by = pg_temp.u(4), reviewed_at = now() where id = :'r1'::uuid;
select is((select count(*) from ops.reports where reviewed_at is null), 1::bigint, 'one report is reviewed and one is not');
create temp table w2 as select p.oid, p.proname::text n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('reports', 'report');
select is_empty($$ select n from w2 where not (select prosecdef from pg_proc where oid = w2.oid) or (select provolatile from pg_proc where oid = w2.oid) <> 'v'
  or (select proconfig from pg_proc where oid = w2.oid) is distinct from array['search_path=""'] $$, 'both wrappers are security definer, volatile, search_path pinned');
select is_empty($$ select n from w2 where not has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('anon', oid, 'execute') or has_function_privilege('service_role', oid, 'execute')
  or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = w2.oid and a.grantee = 0) $$, 'both are executable by authenticated only');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'analytics_private'::regnamespace and p.proname in ('q_reports', 'q_report')
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
       or exists (select 1 from pg_proc q, aclexplode(q.proacl) a where q.oid = p.oid and a.grantee = 0)) $$, 'the two internal functions are executable by no client role');
select is_empty($$ select n from w2 where (select prosrc from pg_proc where oid = w2.oid) !~ ('analytics_private\.vendor_guard\(''' || n || '''') $$, 'each wrapper calls the guard with its own name');
select is((select pg_get_function_result('analytics.reports()'::regprocedure)), 'TABLE(id uuid, period date, reviewed_at timestamp with time zone)', 'reports() returns id, period and review time only (not who reviewed)');
select is((select pg_get_function_result('analytics.report(uuid)'::regprocedure)), 'TABLE(id uuid, period date, reviewed_at timestamp with time zone, payload jsonb)', 'report() returns id, period, review time and payload only');
select is(pg_temp.vv('select string_agg(id::text, '','') from analytics.reports()'), :'r1', 'a vendor lists the reviewed report only');
select is(pg_temp.vv(format('select (select payload from analytics.report(%L))::text', :'r1')), (select payload::text from ops.reports where id = :'r1'::uuid), 'a vendor reads the reviewed report: its stored payload');
select is(pg_temp.vv(format('select count(*) from analytics.report(%L)', :'r2')), '0', 'an unreviewed report is not returned');
select is(pg_temp.vv(format('select count(*) from analytics.report(%L)', gen_random_uuid())), '0', 'a missing id returns the same: nothing');
select is(pg_temp.vv('select count(*) from analytics.report(null)'), '0', 'a null id returns nothing');
update ops.reports set reviewed_at = now() where id = :'r2'::uuid;
select is(pg_temp.vv('select count(*) from analytics.reports()'), '2', 'once reviewed the second report is listed too');
select is(pg_temp.vv('select string_agg(period::text, '','' order by n) from analytics.reports() with ordinality t(id, period, reviewed_at, n)'), pg_temp.mo(0)::text || ',' || pg_temp.mo(1)::text, 'newest period first');
update ops.reports set reviewed_at = null where id = :'r2'::uuid;

-- the guard: every caller x both functions; refused calls leave no log row
delete from ops.vendor_query_log;
create temp table fns (n text primary key, q text);
insert into fns values ('reports', 'select count(*) from analytics.reports()'), ('report', format('select count(*) from analytics.report(%L)', :'r1'));
create temp table who (tag text primary key, uid uuid, rl text, want text);
insert into who values ('anon', null, 'anon', 'err=42501: permission denied for schema analytics'), ('consumer', pg_temp.u(3), 'authenticated', 'err=42501: forbidden'), ('admin', pg_temp.u(4), 'authenticated', 'err=42501: forbidden'),
  ('vendor with no membership', pg_temp.u(5), 'authenticated', 'err=42501: forbidden'), ('vendor without the agreement', pg_temp.u(2), 'authenticated', 'err=P0001: agreement_required'), ('vendor with the agreement', pg_temp.u(1), 'authenticated', 'ok');
select is(pg_temp.call(w.uid, w.rl, f.q), w.want, w.tag || ': ' || f.n) from who w cross join fns f order by w.tag, f.n;
select is(pg_temp.nlog(), 2::bigint, 'only the two answered calls wrote a log row');
select is((select array_agg(fn order by id) from ops.vendor_query_log), array['report', 'reports'], 'each call logs its function name');
select is((select params from ops.vendor_query_log where fn = 'report'), jsonb_build_object('id', :'r1'), 'report logs the id it was asked for');
update ops.settings set value = 'on' where key = 'maintenance';
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.reports()'), 'err=P0001: maintenance', 'maintenance on refuses reports()');
update ops.settings set value = 'off' where key = 'maintenance';
insert into ops.vendor_query_log (vendor_id, user_id, fn, params) select pg_temp.va(), pg_temp.u(1), 'gaps', '{}' from generate_series(1, 198);
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.reports()'), 'err=P0001: rate_limited', 'the shared limit applies: with 200 calls in the hour the next one raises rate_limited');

select * from finish();
rollback;
