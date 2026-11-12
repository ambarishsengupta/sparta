-- WO-0101 (R7a) / CC5: analytics.trend, analytics.gaps and analytics.condition_spectrum (LLD 5.4; FR-73 to FR-77, FR-81).
-- (The R7 spec calls this file 017_wo0101_trends_gaps_spectrum; 017 is WO-0100's, so the next free number, 018, is used.)
-- Synthetic and rolled back. Vendor users exist only here, made by SQL as postgres: u1 and u2 vendor A (accepted), u3 vendor B (not accepted), u4 two memberships (accepted),
-- u5 vendor role with no membership, u6 eligible consumer, u7 signed in with no profile row, u8 admin, u9 vendor B (accepted), u10 vendor role with nothing.
-- The cube is planted straight into analytics.cube, one population per rule (owner row missing or hidden, both hidden, owner zero (planted), stale owner period, tie, a 9-user band,
-- one visible band, two visible bands, rows a run would never publish); the last block feeds the real run (open entries in two months, unlock entries, a 9-user band).
begin;
\ir helpers.inc
select plan(132);

create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('00101000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $f$;
create function pg_temp.va() returns uuid language sql immutable as $f$ select 'a1010000-0000-0000-0000-000000000001'::uuid $f$;
create function pg_temp.vb() returns uuid language sql immutable as $f$ select 'b1010000-0000-0000-0000-000000000002'::uuid $f$;
create function pg_temp.mo(n int) returns date language sql stable as $f$ select (date_trunc('month', now() at time zone 'UTC') - make_interval(months => n))::date $f$;
select pg_temp.mk_user(pg_temp.u(n)) from generate_series(1, 10) n;
update app.profiles set role = 'vendor' where id in (select pg_temp.u(n) from unnest(array[1, 2, 3, 4, 5, 9, 10]) n);
update app.profiles set role = 'admin' where id = pg_temp.u(8);
select pg_temp.make_eligible(pg_temp.u(6));
delete from app.profiles where id = pg_temp.u(7);
insert into catalog.vendors (id, name) values (pg_temp.va(), 'Zor Vane Outfitters'), (pg_temp.vb(), 'Quillon Threads');
insert into catalog.vendor_members (vendor_id, user_id) values (pg_temp.va(), pg_temp.u(1)), (pg_temp.va(), pg_temp.u(2)), (pg_temp.vb(), pg_temp.u(3)), (pg_temp.va(), pg_temp.u(4)), (pg_temp.vb(), pg_temp.u(4)), (pg_temp.vb(), pg_temp.u(9));
insert into catalog.vendor_agreement_acceptances (vendor_id, user_id, version) values (pg_temp.va(), pg_temp.u(1), '1'), (pg_temp.va(), pg_temp.u(2), '1'), (pg_temp.va(), pg_temp.u(4), '1'), (pg_temp.va(), pg_temp.u(5), '1'), (pg_temp.vb(), pg_temp.u(9), '1');
insert into ops.aggregate_runs (status, finished_at, users_included, items_included, rows_suppressed, duration_ms) values ('ok', now(), 47, 90, 12, 100);
-- a run can never publish a zero count (check constraint, LLD 5.3 step 4); the constraint is dropped inside this rolled-back test so that a hand-planted zero owner row can prove the defence
alter table analytics.cube drop constraint cube_users_rounded_check;
-- columns: kind, months back, category, colour_family, fit, brand, size, season, price_band, region, condition_band, users_rounded, events_rounded, users_floor
insert into analytics.cube (run_id, kind, period, d_category, d_colour_family, d_fit, d_brand, f_size, f_season, f_price_band, f_region, condition_band, users_rounded, events_rounded, users_floor)
  select (select max(id) from ops.aggregate_runs), v.k, pg_temp.mo(v.m), v.c, v.cf, v.fit, v.b, v.sz, v.se, v.pb, v.rg, v.cb, v.ur, v.er, v.fl from (values
    -- gaps: Tops 15 over 40 (a wishlist row of another kind, 20, and an older owner row, 400 and wishlist row, 30, must not be used); Bags ties Tops at 0.4; Coats 3.0; Socks 0.1
    ('owned', 0, 'Tops', null, null, null, null, null, null, null, null, 40, 40, 40), ('wishlist_open', 0, 'Tops', null, null, null, null, null, null, null, null, 15, 15, 15),
    ('owned', 1, 'Tops', null, null, null, null, null, null, null, null, 400, 400, 400), ('wishlist_open', 1, 'Tops', null, null, null, null, null, null, null, null, 30, 30, 30), ('owned', 0, 'Bags', null, null, null, null, null, null, null, null, 25, 25, 25),
    ('wishlist_open', 0, 'Bags', null, null, null, null, null, null, null, null, 10, 10, 10), ('owned', 0, 'Coats', null, null, null, null, null, null, null, null, 10, 10, 10),
    ('wishlist_open', 0, 'Coats', null, null, null, null, null, null, null, null, 30, 30, 30), ('owned', 0, 'Socks', null, null, null, null, null, null, null, null, 100, 100, 100),
    ('wishlist_open', 0, 'Socks', null, null, null, null, null, null, null, null, 10, 10, 10),
    -- owner row missing (Bottoms), hidden with floor 5 (Footwear), zero (Other), of last month only (Belts): wishlist row visible
    ('wishlist_open', 0, 'Bottoms', null, null, null, null, null, null, null, null, 20, 20, 20), ('owned', 0, 'Footwear', null, null, null, null, null, null, null, null, 10, 10, 5),
    ('wishlist_open', 0, 'Footwear', null, null, null, null, null, null, null, null, 10, 10, 10), ('owned', 0, 'Other', null, null, null, null, null, null, null, null, 0, 5, 10),
    ('wishlist_open', 0, 'Other', null, null, null, null, null, null, null, null, 10, 10, 10), ('owned', 1, 'Belts', null, null, null, null, null, null, null, null, 20, 20, 20),
    ('wishlist_open', 0, 'Belts', null, null, null, null, null, null, null, null, 10, 10, 10),
    -- wishlist row hidden, owner visible (Outerwear); both hidden (Accessories)
    ('owned', 0, 'Outerwear', null, null, null, null, null, null, null, null, 10, 10, 10), ('wishlist_open', 0, 'Outerwear', null, null, null, null, null, null, null, null, 10, 10, 5),
    ('owned', 0, 'Accessories', null, null, null, null, null, null, null, null, 10, 10, 5), ('wishlist_open', 0, 'Accessories', null, null, null, null, null, null, null, null, 10, 10, 5),
    -- gaps with a size filter
    ('owned', 0, 'Tops', null, null, null, 'Letter:M', null, null, null, null, 20, 20, 20), ('wishlist_open', 0, 'Tops', null, null, null, 'Letter:M', null, null, null, null, 10, 10, 10),
    -- trends: users and events differ; a month whose floor is 5 is hidden
    ('wishlist', 0, 'Tops', null, null, null, null, null, null, null, null, 20, 25, 20), ('wishlist', 1, 'Tops', null, null, null, null, null, null, null, null, 15, 20, 15),
    ('wishlist', 2, 'Tops', null, null, null, null, null, null, null, null, 10, 10, 5), ('wishlist', 0, 'Bottoms', null, null, null, null, null, null, null, null, 10, 15, 10),
    ('wishlist', 0, null, null, null, 'Aster Loom', null, null, null, null, null, 10, 10, 10), ('purchase', 0, 'Tops', null, null, null, null, null, null, null, null, 20, 30, 20),
    ('purchase', 1, 'Tops', null, null, null, null, null, null, null, null, 15, 15, 15), ('purchase', 0, 'Bottoms', null, null, null, null, null, null, null, null, 10, 15, 10),
    ('purchase', 0, 'Tops', null, null, null, null, null, '100-200', null, null, 10, 10, 10),
    -- condition spectrum: Tops has a 9-user band (rounded to 10, floor 5, events 100), an Unrated row, and rows with a colour or a size that a run would never give a band
    ('owned', 0, 'Tops', null, null, null, null, null, null, null, 'Brand new', 10, 100, 5), ('owned', 0, 'Tops', null, null, null, null, null, null, null, 'Like new', 10, 10, 10),
    ('owned', 0, 'Tops', null, null, null, null, null, null, null, 'Good', 15, 20, 15), ('owned', 0, 'Tops', null, null, null, null, null, null, null, 'Worn', 10, 15, 10),
    ('owned', 0, 'Tops', null, null, null, null, null, null, null, 'Unrated', 20, 200, 20), ('owned', 0, 'Tops', 'Blue', null, null, null, null, null, null, 'Good', 10, 50, 10),
    ('owned', 0, 'Tops', null, null, null, 'Letter:M', null, null, null, 'Good', 10, 50, 10),
    -- Bottoms: one visible band (and a stale month); Footwear: exactly two visible bands
    ('owned', 0, 'Bottoms', null, null, null, null, null, null, null, 'Good', 10, 10, 10), ('owned', 1, 'Bottoms', null, null, null, null, null, null, null, 'Worn', 10, 10, 10),
    ('owned', 0, 'Footwear', null, null, null, null, null, null, null, 'Good', 10, 10, 10), ('owned', 0, 'Footwear', null, null, null, null, null, null, null, 'Worn', 10, 10, 10)
  ) v(k, m, c, cf, fit, b, sz, se, pb, rg, cb, ur, er, fl);

create function pg_temp.call(p_uid uuid, p_role text, p_sql text) returns text language sql as $f$ select case when r like 'err=%' then r else 'ok' end from (select pg_temp.val_as(p_uid, p_role, p_sql) r) q $f$;
create function pg_temp.vv(p_sql text) returns text language sql as $f$ select pg_temp.val_as(pg_temp.u(1), 'authenticated', p_sql) $f$;
-- the results as one string each, in the order the function returned them
create function pg_temp.gp(p_args text) returns text language sql as $f$ select pg_temp.vv(format(
  'select coalesce(string_agg(segment || '':'' || coalesce(owner_users_rounded::text, ''-'') || ''/'' || wishlist_users_rounded || ''/'' || coalesce(gap_score::text, ''null'') || ''/'' || coalesce(label, ''-''), '' | '' order by n), ''-'')
   from analytics.gaps(%s) with ordinality t(segment, owner_users_rounded, wishlist_users_rounded, gap_score, label, n)', p_args)) $f$;
create function pg_temp.tr(p_args text) returns text language sql as $f$ select pg_temp.vv(format(
  'select coalesce(string_agg(period || '' '' || segment || '' '' || coalesce(users_rounded::text, ''-'') || ''/'' || coalesce(events_rounded::text, ''-''), '' | '' order by n), ''-'')
   from analytics.trend(%s) with ordinality t(period, segment, users_rounded, events_rounded, n)', p_args)) $f$;
create function pg_temp.sp(p_cat text) returns text language sql as $f$ select pg_temp.vv(format(
  'select string_agg(band || ''='' || coalesce(share::text, ''null''), '','' order by n) from analytics.condition_spectrum(%L) with ordinality t(band, share, n)', p_cat)) $f$;
create function pg_temp.nlog() returns bigint language sql stable as $f$ select count(*) from ops.vendor_query_log $f$;
create temp table fns (n text primary key, q text);
insert into fns values ('trend', 'select count(*) from analytics.trend(''wishlist'', ''category'')'), ('gaps', 'select count(*) from analytics.gaps(''category'')'), ('condition_spectrum', 'select count(*) from analytics.condition_spectrum(''Tops'')');
create temp table who (tag text primary key, uid uuid, rl text, want text);
insert into who values ('anon', null, 'anon', 'err=42501: permission denied for schema analytics'), ('consumer', pg_temp.u(6), 'authenticated', 'err=42501: forbidden'),
  ('no profile row', pg_temp.u(7), 'authenticated', 'err=42501: forbidden'), ('admin', pg_temp.u(8), 'authenticated', 'err=42501: forbidden'),
  ('vendor with no membership', pg_temp.u(5), 'authenticated', 'err=42501: forbidden'), ('vendor with two memberships', pg_temp.u(4), 'authenticated', 'err=42501: forbidden'),
  ('vendor without the agreement', pg_temp.u(3), 'authenticated', 'err=P0001: agreement_required'), ('vendor with nothing (agreement is checked before the log)', pg_temp.u(10), 'authenticated', 'err=P0001: agreement_required'),
  ('vendor with the agreement', pg_temp.u(1), 'authenticated', 'ok');

-- ======== 1. shape and grants: the three wrappers are thin, guarded and locked down ======================================================
create temp table w3 as select p.oid, p.proname::text n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('trend', 'gaps', 'condition_spectrum');
select is((select count(*) from w3), 3::bigint, 'the three wrappers exist in schema analytics');
select is_empty($$ select n from w3 where not (select prosecdef from pg_proc where oid = w3.oid) $$, 'all three are security definer');
select is_empty($$ select n from w3 where (select provolatile from pg_proc where oid = w3.oid) <> 'v' $$, 'all three are volatile (each writes the log)');
select is_empty($$ select n from w3 where (select proconfig from pg_proc where oid = w3.oid) is distinct from array['search_path=""'] $$, 'all three pin search_path');
select is_empty($$ select n from w3 where not has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('anon', oid, 'execute') or has_function_privilege('service_role', oid, 'execute')
  or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = w3.oid and a.grantee = 0) $$, 'executable by authenticated only (not public, anon or service_role)');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'analytics_private'::regnamespace and p.proname in ('q_cube_slice', 'q_trend', 'q_gaps', 'q_condition_spectrum')
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
       or exists (select 1 from pg_proc q, aclexplode(q.proacl) a where q.oid = p.oid and a.grantee = 0)) $$, 'the four internal functions are executable by no client role');
select is_empty($$ select n from w3 where (select prosrc from pg_proc where oid = w3.oid) !~ ('analytics_private\.vendor_guard\(''' || n || '''') $$, 'each wrapper calls analytics_private.vendor_guard with its own name');
select is_empty($$ select p.proname from pg_proc p where p.pronamespace in ('analytics'::regnamespace, 'analytics_private'::regnamespace) and p.proname in ('trend', 'gaps', 'condition_spectrum', 'q_cube_slice', 'q_trend', 'q_gaps', 'q_condition_spectrum')
  and p.prosrc ~* '(current_role|log_and_limit|vendor_agreement_acceptances|maintenance|auth\.uid)' $$, 'no second copy of the role, agreement, maintenance or limit checks: none of the new functions holds one');
select is_empty($$ select p.proname from pg_proc p where p.pronamespace = 'analytics_private'::regnamespace and p.proname in ('q_cube_slice', 'q_trend', 'q_gaps', 'q_condition_spectrum') and p.prosrc ~* '(execute\s+(format|''|"))' $$, 'no dynamic SQL in the internal functions');
select is_empty($$ select p.proname from pg_proc p where p.pronamespace = 'analytics_private'::regnamespace and p.proname in ('q_cube_slice', 'q_trend', 'q_gaps', 'q_condition_spectrum') and p.prosrc ~* '(cube_stage|facts|users\s*,|\musers\M\s+from|c\.users\M|c\.events\M)' $$, 'the internal functions never read the staging table, the facts or a raw count');
select is((select pg_get_function_result('analytics.trend(text, text, text, text, text)'::regprocedure)), 'TABLE(period date, segment text, users_rounded integer, events_rounded integer)', 'trend returns a month, a segment and rounded counts only');
select is((select pg_get_function_result('analytics.gaps(text, text, text, integer)'::regprocedure)), 'TABLE(segment text, owner_users_rounded integer, wishlist_users_rounded integer, gap_score numeric, label text)', 'gaps returns a segment, two rounded counts, a score and a label only');
select is((select pg_get_function_result('analytics.condition_spectrum(text)'::regprocedure)), 'TABLE(band text, share integer)', 'condition_spectrum returns a band and a share only');
select is((select pg_get_function_arguments('analytics.trend(text, text, text, text, text)'::regprocedure)), 'p_kind text, p_dim text, p_period_unit text DEFAULT ''month''::text, p_filter_dim text DEFAULT NULL::text, p_filter_value text DEFAULT NULL::text', 'trend takes p_kind, p_dim, p_period_unit (default month), p_filter_dim and p_filter_value');
select is((select pg_get_function_arguments('analytics.gaps(text, text, text, integer)'::regprocedure)), 'p_dim text, p_filter_dim text DEFAULT NULL::text, p_filter_value text DEFAULT NULL::text, p_top_n integer DEFAULT 20', 'gaps takes p_dim, p_filter_dim, p_filter_value and p_top_n (default 20)');

-- ======== 2. the shared guard: every caller x every function; refused calls leave no log row ==============================================
delete from ops.vendor_query_log;
select is(pg_temp.call(w.uid, w.rl, f.q), w.want, w.tag || ': ' || f.n) from who w cross join fns f order by w.tag, f.n;
select is(pg_temp.nlog(), 3::bigint, 'only the three answered calls (u1) wrote a log row; the 24 refused calls wrote none');
update ops.settings set value = '2' where key = 'current_vendor_agreement_version';
select is(pg_temp.call(pg_temp.u(1), 'authenticated', f.q), 'err=P0001: agreement_required', 'a new agreement version refuses a vendor who accepted only the old one: ' || f.n) from fns f order by f.n;
update ops.settings set value = '1' where key = 'current_vendor_agreement_version';
delete from ops.vendor_query_log;
update ops.settings set value = 'on' where key = 'maintenance';
select is(pg_temp.call(pg_temp.u(1), 'authenticated', f.q), 'err=P0001: maintenance', 'maintenance on: ' || f.n) from fns f order by f.n;
select is(pg_temp.call(pg_temp.u(6), 'authenticated', 'select count(*) from analytics.gaps(''category'')'), 'err=42501: forbidden', 'maintenance on: a consumer still gets forbidden (role first)');
select is(pg_temp.nlog(), 0::bigint, 'maintenance wrote no log row');
update ops.settings set value = 'off' where key = 'maintenance';

-- ======== 3. gaps: one rule per segment (FR-75, FR-81) ===================================================================================
select is(pg_temp.gp($$'category'$$), 'Coats:10/30/3.0/- | Bags:25/10/0.4/- | Tops:40/15/0.4/- | Socks:100/10/0.1/- | Belts:-/10/null/no visible ownership | Bottoms:-/20/null/no visible ownership | Footwear:-/10/null/no visible ownership | Other:0/10/null/no visible ownership',
  'gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by score descending, ties by name (Bags before Tops), null scores last by name; Outerwear (wishlist row hidden) and Accessories (both hidden) are absent');
select is(pg_temp.gp($$'category', null, null, 3$$), 'Coats:10/30/3.0/- | Bags:25/10/0.4/- | Tops:40/15/0.4/-', 'p_top_n 3 keeps the three best (the limit is applied after the ranking)');
select is(pg_temp.gp($$'category', null, null, 1$$), 'Coats:10/30/3.0/-', 'p_top_n 1 is accepted');
select is(pg_temp.vv('select count(*) from analytics.gaps(''category'', null, null, 50)'), '8', 'p_top_n 50 is accepted');
select is(pg_temp.vv('select count(*) from analytics.gaps(''category'')'), '8', 'the default p_top_n (20) returns all eight segments');
select is(pg_temp.gp($$'category', 'size', 'Letter:M'$$), 'Tops:20/10/0.5/-', 'FR-77: a size filter reads the filtered rows of both kinds (Tops 10 over 20 = 0.5)');
select is(pg_temp.gp($$'category', 'season', 'All year'$$), '-', 'a filter with no visible rows returns nothing');
select is(pg_temp.gp($$'colour_family'$$), '-', 'a dimension with no rows returns nothing');
select is(pg_temp.vv('select count(*) from analytics.gaps(''category'') where segment in (''Outerwear'', ''Accessories'')'), '0', 'a segment whose wishlist row is hidden is never listed (not even as no visible ownership)');
select is(pg_temp.vv('select count(*) from analytics.gaps(''category'') where label is not null and (gap_score is not null or segment in (''Tops'', ''Bags'', ''Coats'', ''Socks''))'), '0', 'no visible ownership always has a null score, and a visible owner never has the label');
select is(pg_temp.vv('select count(*) from analytics.gaps(''category'') where segment = ''Footwear'' and owner_users_rounded is not null'), '0', 'a hidden owner row (floor 5, rounded 10) is not returned as an owner count');

-- ======== 4. trend: kinds, months, hidden months, filters (FR-73, FR-74) ================================================================
select is(pg_temp.tr($$'wishlist', 'category'$$), pg_temp.mo(1)::text || ' Tops 15/- | ' || pg_temp.mo(0)::text || ' Bottoms 10/- | ' || pg_temp.mo(0)::text || ' Tops 20/-',
  'FR-74: the wishlist trend returns users_rounded (not events) by month and segment; the month with a floor of 5 is absent; wishlist_open rows are not mixed in');
select is(pg_temp.tr($$'purchase', 'category'$$), pg_temp.mo(1)::text || ' Tops -/15 | ' || pg_temp.mo(0)::text || ' Bottoms -/15 | ' || pg_temp.mo(0)::text || ' Tops -/30', 'FR-73: the purchase trend returns events_rounded (not users) by month and segment');
select is(pg_temp.tr($$'purchase', 'category', 'month', 'price_band', '100-200'$$), pg_temp.mo(0)::text || ' Tops -/10', 'FR-77: the purchase trend honours one filter');
select is(pg_temp.tr($$'wishlist', 'brand'$$), pg_temp.mo(0)::text || ' Aster Loom 10/-', 'the wishlist trend by brand');
select is(pg_temp.tr($$'wishlist', 'category', 'month', 'size', 'Letter:M'$$), '-', 'a filter with no row returns nothing');
select is(pg_temp.tr($$'purchase', 'category', p_period_unit => 'month'$$), pg_temp.mo(1)::text || ' Tops -/15 | ' || pg_temp.mo(0)::text || ' Bottoms -/15 | ' || pg_temp.mo(0)::text || ' Tops -/30', 'p_period_unit month is accepted by name');
select is(pg_temp.vv('select count(*) from analytics.trend(''wishlist'', ''category'')'), '3', 'the period unit defaults to month');
select is(pg_temp.vv('select count(*) from analytics.trend(''purchase'', ''category'') where users_rounded is not null'), '0', 'a purchase trend never returns a user count');
select is(pg_temp.vv('select count(*) from analytics.trend(''wishlist'', ''category'') where events_rounded is not null'), '0', 'a wishlist trend never returns an event count');

-- ======== 5. invalid input: fixed codes, no log row, no hint to a consumer ================================================================
delete from ops.vendor_query_log;
create temp table bad (n int, f text, a text, want text);
insert into bad values
  (1, 'trend', $$'sales', 'category'$$, 'invalid_dimension'), (2, 'trend', $$null, 'category'$$, 'invalid_dimension'), (3, 'trend', $$'owned', 'category'$$, 'invalid_dimension'),
  (4, 'trend', $$'wishlist_open', 'category'$$, 'invalid_dimension'), (5, 'trend', $$'wishlist', 'category', 'week'$$, 'unsupported_period'), (6, 'trend', $$'wishlist', 'category', 'Month'$$, 'unsupported_period'),
  (7, 'trend', $$'wishlist', 'category', null$$, 'unsupported_period'), (8, 'trend', $$'purchase', 'category', 'day'$$, 'unsupported_period'), (9, 'trend', $$'purchase', 'category', ''$$, 'unsupported_period'),
  (10, 'trend', $$'wishlist', 'colour'$$, 'invalid_dimension'), (11, 'trend', $$'wishlist', 'category', 'month', 'bogus', 'x'$$, 'invalid_dimension'), (12, 'trend', $$'wishlist', 'category', 'month', 'size'$$, 'invalid_dimension'),
  (13, 'trend', $$'wishlist', 'category', 'month', null, 'x'$$, 'invalid_dimension'), (14, 'trend', $$'wishlist', 'category', 'month', 'size', repeat('x', 101)$$, 'invalid_dimension'),
  (15, 'trend', $$'purchase', 'category; drop table analytics.cube'$$, 'invalid_dimension'), (16, 'trend', $$'purchase', 'user_hash'$$, 'invalid_dimension'),
  (17, 'gaps', $$'category', null, null, 0$$, 'invalid_top_n'), (18, 'gaps', $$'category', null, null, 51$$, 'invalid_top_n'), (19, 'gaps', $$'category', null, null, -1$$, 'invalid_top_n'),
  (20, 'gaps', $$'category', null, null, null$$, 'invalid_top_n'), (21, 'gaps', $$'colour'$$, 'invalid_dimension'), (22, 'gaps', $$'category', 'size'$$, 'invalid_dimension'),
  (23, 'gaps', $$'category; drop table analytics.cube'$$, 'invalid_dimension'), (24, 'gaps', $$'category', 'Size', 'x'$$, 'invalid_dimension'), (25, 'gaps', $$'category', 'size', repeat('x', 101)$$, 'invalid_dimension'),
  (26, 'condition_spectrum', $$repeat('x', 101)$$, 'invalid_dimension');
select is(pg_temp.vv('select count(*) from analytics.' || f || '(' || a || ')'), 'err=P0001: ' || want, want || ' for ' || f || '(' || a || ')') from bad order by n;
select is(pg_temp.nlog(), 0::bigint, 'a call refused for its input writes no log row');
select is(pg_temp.val_as(pg_temp.u(6), 'authenticated', 'select count(*) from analytics.trend(''sales'', ''category'', ''week'')'), 'err=42501: forbidden', 'a consumer gets forbidden, not a hint about the inputs');
select is_empty($$ select d || '/' || coalesce(f, '-') from (values ('category'), ('colour_family'), ('fit'), ('brand'), ('category_colour_family'), ('category_fit'), ('category_brand')) d(d)
  cross join (values (null), ('size'), ('season'), ('price_band'), ('region')) f(f)
  where pg_temp.call(pg_temp.u(1), 'authenticated', format('select count(*) from analytics.trend(%L, %L, ''month'', %L, %L)', 'wishlist', d, f, case f when 'size' then 'Letter:M' when 'season' then 'All year' when 'price_band' then '25-50' when 'region' then 'South Asia' end)) <> 'ok'
     or pg_temp.call(pg_temp.u(1), 'authenticated', format('select count(*) from analytics.gaps(%L, %L, %L)', d, f, case f when 'size' then 'Letter:M' when 'season' then 'All year' when 'price_band' then '25-50' when 'region' then 'South Asia' end)) <> 'ok' $$, 'all seven dimensions and all four filters are accepted by trend and by gaps (with an allowlisted value each; WO-0110)');
delete from ops.vendor_query_log;

-- ======== 6. condition spectrum: bands, shares, visible bands only (FR-76, LLD 5.4) ======================================================
select is(pg_temp.sp('Tops'), 'Brand new=null,Like new=20,Good=45,Worn=35,Falling apart=null',
  'a 40-user category with a 9-user band: that band (rounded to 10, floor 5, 100 events) comes back with a null share; the shares are events over the visible bands only (10, 20, 15 of 45), to the nearest 5 points (20, 45, 35); Unrated, a colour row and a size row are left out');
select is(pg_temp.sp('Bottoms'), 'Brand new=null,Like new=null,Good=null,Worn=null,Falling apart=null', 'a category with one visible band (and a stale month) gives every band a null share');
select is(pg_temp.sp('Footwear'), 'Brand new=null,Like new=null,Good=50,Worn=50,Falling apart=null', 'exactly two visible bands are enough: 50 and 50');
select is(pg_temp.sp('Accessories'), 'Brand new=null,Like new=null,Good=null,Worn=null,Falling apart=null', 'a category with no band rows returns every band with a null share (never 0)');
select is(pg_temp.sp('Nope'), 'err=P0001: invalid_dimension', 'an unknown category is refused with invalid_dimension (WO-0110: not a lk_category code, so it is never logged)');
select is(pg_temp.vv('select count(*) from analytics.condition_spectrum(null)'), '5', 'a null category returns the five bands, all null');
select is((select string_agg(code, ',' order by sort) from catalog.lk_condition_band), 'Brand new,Like new,Good,Worn,Falling apart', 'the bands of lk_condition_band are the five the spectrum returns');
select is(pg_temp.vv('select count(*) from analytics.condition_spectrum(''Tops'') where share % 5 <> 0'), '0', 'every share is a multiple of 5 points');

-- ======== 7. the threshold is read at call time, and the planted-row defence ==============================================================
update ops.settings set value = '50' where key = 'min_group_size';
select is(pg_temp.gp($$'category'$$), '-', 'with min_group_size 50 no gap is returned');
select is(pg_temp.tr($$'purchase', 'category'$$), '-', 'nor a trend row');
select is(pg_temp.sp('Tops'), 'Brand new=null,Like new=null,Good=null,Worn=null,Falling apart=null', 'nor a band share');
update ops.settings set value = '10' where key = 'min_group_size';
delete from analytics.cube where users_floor >= 10;
select is((select count(*) from analytics.cube), 6::bigint, 'only rows under the threshold are left in the cube (planted, rounded values of 10 or more)');
select is(pg_temp.gp($$'category'$$) || pg_temp.tr($$'wishlist', 'category'$$) || pg_temp.tr($$'purchase', 'category'$$) || pg_temp.sp('Tops'),
  '-' || '-' || '-' || 'Brand new=null,Like new=null,Good=null,Worn=null,Falling apart=null', 'LLD 5.4 defence in depth: no function returns or uses a row inserted straight into the cube under the threshold');

-- ======== 8. log contents, the rate limit (one shared limiter) ===========================================================================
delete from ops.vendor_query_log;
select pg_temp.vv('select count(*) from analytics.trend(''wishlist'', ''category'')') as r \gset
select pg_temp.vv('select count(*) from analytics.gaps(''category'', null, null, 3)') as r \gset
select pg_temp.vv('select count(*) from analytics.condition_spectrum(''Tops'')') as r \gset
select is((select array_agg(fn order by id) from ops.vendor_query_log), array['trend', 'gaps', 'condition_spectrum'], 'each call logs its function name');
select is((select params from ops.vendor_query_log where fn = 'trend'), '{"dim": "category", "kind": "wishlist", "filter_dim": null, "filter_value": null, "period_unit": "month"}'::jsonb, 'trend logs its parameters');
select is((select params from ops.vendor_query_log where fn = 'gaps'), '{"dim": "category", "top_n": 3, "filter_dim": null, "filter_value": null}'::jsonb, 'gaps logs its parameters');
select is((select params from ops.vendor_query_log where fn = 'condition_spectrum'), '{"category": "Tops"}'::jsonb, 'condition_spectrum logs its parameter');
select is((select count(*) from ops.vendor_query_log where vendor_id = pg_temp.va() and user_id = pg_temp.u(1)), 3::bigint, 'the rows hold the vendor and the user');
delete from ops.vendor_query_log;
insert into ops.vendor_query_log (vendor_id, user_id, fn, params) select pg_temp.va(), pg_temp.u(1), 'gaps', '{}' from generate_series(1, 200);
select is(pg_temp.call(pg_temp.u(1), 'authenticated', f.q), 'err=P0001: rate_limited', 'FR-88: with 200 calls in the hour the next call raises rate_limited: ' || f.n) from fns f order by f.n;
select is(pg_temp.call(pg_temp.u(2), 'authenticated', 'select count(*) from analytics.gaps(''category'')'), 'err=P0001: rate_limited', 'the limit counts both users of the vendor together');
select is(pg_temp.nlog(), 200::bigint, 'the refused calls wrote no log row');
select is(pg_temp.call(pg_temp.u(9), 'authenticated', 'select count(*) from analytics.trend(''wishlist'', ''category'')'), 'ok', 'another vendor is not affected');
update ops.vendor_query_log set called_at = now() - interval '61 minutes' where id = (select min(id) from ops.vendor_query_log where vendor_id = pg_temp.va());
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.trend(''wishlist'', ''category'')'), 'ok', 'a row older than one hour is not counted: the call is answered');
select is(pg_temp.call(pg_temp.u(1), 'authenticated', 'select count(*) from analytics.gaps(''category'')'), 'err=P0001: rate_limited', 'and the window is full again');

-- ======== 9. the real run: open entries in two months, unlock entries, a 9-user band (73 synthetic users) ==============================
-- g 1 to 40 own one Tops item each (condition bands of 9, 10, 10 and 11 users); g 1 to 13 also have two open Tops entries, created one and two months back (none this month);
-- g 41 to 52 own a Bottoms item and have one entry from Wardrobe unlock (Bottoms); g 53 to 61 own Footwear (9 users); g 62 to 73 have an open Footwear entry and an archived Footwear item (no active item, so no owner).
delete from ops.vendor_query_log;
delete from analytics.cube;
create function pg_temp.g(n int) returns uuid language sql immutable as $f$ select md5('wo0101:' || n)::uuid $f$;
insert into auth.users (id, email) select pg_temp.g(g), md5('wo0101:' || g) || '@example.test' from generate_series(1, 73) g;
update app.profiles set country = 'IN', hemisphere = 'north', age_confirmed = true where id in (select pg_temp.g(g) from generate_series(1, 73) g);
insert into app.consent_records (user_id, notice_version) select pg_temp.g(g), '1' from generate_series(1, 73) g;
insert into app.document_acceptances (user_id, document, version) select pg_temp.g(g), d, '1' from generate_series(1, 73) g, unnest(array['terms', 'privacy_policy']) d;
insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, condition)
  select pg_temp.g(g), 'x', c, s, 0, 0, 139, 'manual', case when g <= 40 then case when g <= 9 then 5 when g <= 19 then 20 when g <= 29 then 40 else 70 end end
  from generate_series(1, 61) g, lateral (select case when g <= 40 then 'Tops' when g <= 52 then 'Bottoms' else 'Footwear' end c, case when g <= 40 then 'T-shirt' when g <= 52 then 'Jeans' else 'Sneakers' end s) q;
insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, status) select pg_temp.g(g), 'x', 'Footwear', 'Sneakers', 0, 0, 139, 'manual', 'archived' from generate_series(62, 73) g;
insert into app.wishlist_entries (user_id, name, category, sub_type, origin, created_at)
  select pg_temp.g(g), 'w', 'Tops', 'T-shirt', 'user', t from generate_series(1, 13) g, unnest(array[pg_temp.mo(1)::timestamptz + interval '10 days 12 hours', pg_temp.mo(2)::timestamptz + interval '10 days 12 hours']) t;
insert into app.wishlist_entries (user_id, name, category, sub_type, origin) select pg_temp.g(g), 'w', 'Bottoms', 'Jeans', 'unlock' from generate_series(41, 52) g;
insert into app.wishlist_entries (user_id, name, category, sub_type, origin) select pg_temp.g(g), 'w', 'Footwear', 'Sneakers', 'user' from generate_series(62, 73) g;
select analytics.run_aggregation() as run_id \gset
select is((select status from ops.aggregate_runs where id = :run_id), 'ok', 'the aggregation run finished ok');
select is(pg_temp.gp($$'category'$$), 'Tops:40/15/0.4/- | Footwear:-/10/null/no visible ownership',
  'FR-81: 13 users with two open entries each (in two months) count once (15 of 40 rounded, 0.4, not 25); the 9-user owner row is hidden so Footwear has no visible ownership; 12 unlock entries create no Bottoms gap');
select is(pg_temp.tr($$'wishlist', 'category'$$), pg_temp.mo(2)::text || ' Tops 15/- | ' || pg_temp.mo(1)::text || ' Tops 15/- | ' || pg_temp.mo(0)::text || ' Footwear 10/-',
  'FR-74: the wishlist trend counts the user once in each month of its entries (none this month), and the unlock entries add no Bottoms row');
select is(pg_temp.vv('select share::text from analytics.condition_spectrum(''Tops'') where band = ''Brand new'''), null, 'LLD 5.4: the 9-user band of a 40-user category has a null share after a real run');
select is(pg_temp.vv('select count(*) from analytics.condition_spectrum(''Tops'') where share is not null'), '2', 'the complementary rule hid one more band, so two bands are visible');
select is(pg_temp.vv('select count(*) from analytics.condition_spectrum(''Tops'') where share is not null and share % 5 = 0'), '2', 'and their shares are multiples of 5 points');

select * from finish();
rollback;
