-- WO-0099 (R7a) / CC3: analytics.run_aggregation() (LLD 5.1 to 5.3, 11 "Aggregation", 13.2). One test per LLD 11 item, named after the FR it proves.
-- (The R7 spec calls this file 015_wo0099_aggregation; 015 is WO-0098's, so the next free number, 016, is used.)
-- Synthetic and rolled back. pg_temp.seg builds a named population (n eligible users, one active item each); pg_temp.clear removes every test user between
-- scenarios, so each scenario is one controlled cube. pg_temp.recov is the "parent minus visible children" check, written from the cube alone (no function shared).
begin;
\ir helpers.inc
select plan(58);

create function pg_temp.uid(p_tag text, g int) returns uuid language sql immutable as $f$ select md5('wo0099:' || p_tag || ':' || g)::uuid $f$;
-- n users in a named segment, each eligible and owning one active item (p_j: fit, brand, sys, size, cond; two = how many users own a second item)
create function pg_temp.seg(p_tag text, p_n int, p_sub text, p_rgb int[], p_j jsonb default '{}') returns void language plpgsql as $f$
begin
  insert into auth.users (id, email) select pg_temp.uid(p_tag, g), pg_temp.uid(p_tag, g)::text || '@example.test' from generate_series(1, p_n) g;
  update app.profiles set country = 'IN', hemisphere = 'north', age_confirmed = true where id in (select pg_temp.uid(p_tag, g) from generate_series(1, p_n) g);
  insert into app.consent_records (user_id, notice_version) select pg_temp.uid(p_tag, g), '1' from generate_series(1, p_n) g;
  insert into app.document_acceptances (user_id, document, version) select pg_temp.uid(p_tag, g), d, '1' from generate_series(1, p_n) g, unnest(array['terms', 'privacy_policy']) d;
  insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, fit, brand, size_system, size_value, condition)
    select pg_temp.uid(p_tag, g), 'x', c.category, c.code, p_rgb[1], p_rgb[2], p_rgb[3], 'manual', p_j->>'fit', p_j->>'brand', p_j->>'sys', p_j->>'size', (p_j->>'cond')::smallint
    from generate_series(1, p_n) g cross join lateral generate_series(1, case when g <= coalesce((p_j->>'two')::int, 0) then 2 else 1 end) k
    join catalog.lk_sub_type c on c.code = p_sub;
end $f$;
create function pg_temp.clear() returns void language sql as $f$ delete from auth.users where email like '%@example.test' $f$;
-- the non-null attributes of a cube row, as jsonb: {"d_category": "Tops", ...}
create function pg_temp.attrs(c analytics.cube) returns jsonb language sql immutable as $f$
  select jsonb_strip_nulls(jsonb_build_object('d_category', c.d_category, 'd_colour_family', c.d_colour_family, 'd_fit', c.d_fit, 'd_brand', c.d_brand,
    'f_size', c.f_size, 'f_season', c.f_season, 'f_price_band', c.f_price_band, 'f_region', c.f_region, 'condition_band', c.condition_band)) $f$;
-- 'users_rounded/events_rounded/users_floor' of the owned row with exactly these attributes, or null when there is none
create function pg_temp.vals(p jsonb) returns text language sql stable as $f$
  select string_agg(c.users_rounded || '/' || c.events_rounded || '/' || c.users_floor, ',') from analytics.cube c where c.kind = 'owned' and pg_temp.attrs(c) = p $f$;
-- Independent recovery check: for every published parent and every attribute that splits it, parent minus the sum of its visible children must not be 1 to 9.
create function pg_temp.recov() returns bigint language sql stable as $f$
  with r as (select c.kind, c.period, c.users_rounded u, pg_temp.attrs(c) a from analytics.cube c),
  rel as (select p.kind, p.period, p.a pa, p.u pu, k.key x, c.u cu from r p join r c on c.kind = p.kind and c.period = p.period
          cross join lateral jsonb_object_keys(c.a) k(key) where c.a - k.key = p.a)
  select count(*) from (select kind, period, pa, x, min(pu) pu, sum(cu) s from rel group by kind, period, pa, x) q where pu - s between 1 and 9 $f$;
create function pg_temp.digest() returns text language sql stable as $f$
  select md5(coalesce(string_agg((to_jsonb(c) - 'run_id')::text, ',' order by (to_jsonb(c) - 'run_id')::text), '')) from analytics.cube c $f$;
create function pg_temp.run() returns bigint language sql as $f$ select analytics.run_aggregation() $f$;
create function pg_temp.st(p_id bigint) returns text language sql stable as
  $f$ select status || '/' || coalesce(error_code, '-') || '/' || coalesce(users_included::text, '-') || '/' || coalesce(items_included::text, '-') || '/' || coalesce(rows_suppressed::text, '-')
      from ops.aggregate_runs where id = p_id $f$;
create temp table colour (n text primary key, rgb int[]);
insert into colour values ('navy', '{0,0,139}'), ('blue', '{21,96,189}'), ('maroon', '{128,0,32}'), ('grey', '{192,192,192}'), ('black', '{0,0,0}'), ('red', '{255,0,0}');
create function pg_temp.col(n text) returns int[] language sql stable as $f$ select rgb from colour where colour.n = $1 $f$;
create temp table keep (v text);

-- ---- 1. the function: shape, grants, schedule ---------------------------------------------------------------------------------------------
select has_function('analytics', 'run_aggregation', array[]::text[], 'analytics.run_aggregation() exists and takes no argument (no caller input)');
select is((select p.prorettype::regtype::text from pg_proc p where p.oid = 'analytics.run_aggregation()'::regprocedure), 'bigint', 'it returns bigint (the run id)');
select is((select p.prosecdef from pg_proc p where p.oid = 'analytics.run_aggregation()'::regprocedure), true, 'it is security definer');
select is((select p.proconfig from pg_proc p where p.oid = 'analytics.run_aggregation()'::regprocedure), array['search_path=""'], 'it pins search_path to the empty path');
select is((select p.proowner from pg_proc p where p.oid = 'analytics.run_aggregation()'::regprocedure), (select p.proowner from pg_proc p where p.oid = 'analytics_private.build_facts(text)'::regprocedure),
  'it is owned by the migration role, the owner of build_facts');
select is_empty($$ select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'analytics.run_aggregation()'::regprocedure and a.grantee = 0 $$, 'execute on run_aggregation is revoked from public');
select ok(not has_function_privilege('anon', 'analytics.run_aggregation()', 'execute') and not has_function_privilege('authenticated', 'analytics.run_aggregation()', 'execute')
  and not has_function_privilege('service_role', 'analytics.run_aggregation()', 'execute'), 'execute on run_aggregation is revoked from anon, authenticated and service_role');
select is_empty($$ select r from (values ('anon'), ('authenticated'), ('service_role')) v(r) where pg_temp.run_as(pg_temp.uid('x', 1), r, 'select analytics.run_aggregation()') is distinct from 'err=42501' $$,
  'no client role can call run_aggregation (42501)');
select is((select schedule || '|' || command || '|' || active from cron.job where jobname = 'sparta-run-aggregation'), '30 20 * * *|select analytics.run_aggregation()|true',
  'LLD 5.1: the pg_cron job sparta-run-aggregation runs daily at 20:30 UTC');
select is((select count(*) from cron.job where jobname = 'sparta-run-aggregation'), 1::bigint, 'there is exactly one such job');
select is_empty($$ select column_name from information_schema.columns where table_schema = 'analytics' and table_name = 'cube' and column_name in ('users', 'events') $$,
  'LLD 5.2: users and events are not columns of analytics.cube');

-- ---- 2. a second run while the lock is held (LLD 5.1 step 1). Another session takes the lock before this transaction ever does. -----------------
create extension if not exists dblink schema extensions;
select extensions.dblink_connect('other', format('host=%s dbname=postgres user=postgres password=postgres', host(inet_server_addr())));   -- the local stack's own default login, over TCP
select is((select x from extensions.dblink('other', 'select pg_try_advisory_lock(7099001)::text') as t(x text)), 'true', 'another session holds the aggregation lock (this one has not run yet)');
select throws_ok($$ select analytics.run_aggregation() $$, '55P03', 'aggregation_running', 'a second concurrent run is refused with aggregation_running while the advisory lock is held');
select is((select count(*) from ops.aggregate_runs), 0::bigint, 'the refused run wrote no run row');
select extensions.dblink_disconnect('other');

-- ---- 3. FR-80: a segment of 9 never appears, one of 10 does ---------------------------------------------------------------------------------
select pg_temp.seg('n9', 9, 'T-shirt', pg_temp.col('navy'));
select pg_temp.run() as id \gset t9_
select is((select count(*) from analytics.cube), 0::bigint, 'FR-80 suppresses segment of 9: nothing about 9 users is published');
select is(pg_temp.st(:t9_id), 'ok/-/9/9/35', 'FR-86 the run row of 9 users: ok, 9 users, 9 items, all 35 groups suppressed');
select pg_temp.clear();
select pg_temp.seg('n10', 10, 'T-shirt', pg_temp.col('navy'));
select pg_temp.run() as id \gset t10_
select is(pg_temp.vals('{"d_category":"Tops"}'), '10/10/10', 'FR-80 shows segment of 10: users_rounded 10');
select is((select count(*) || '/' || count(*) filter (where users_rounded = 10 and users_floor = 10) from analytics.cube), '35/35', 'all 35 groups of 10 users are published at 10');
select is(pg_temp.st(:t10_id), 'ok/-/10/10/0', 'FR-86 the run row of 10 users: nothing suppressed');
select pg_temp.clear();

-- ---- 4. the big scenario S1: cells, rounding, Unknown, invariants --------------------------------------------------------------------------
select pg_temp.seg('s1navy', 40, 'T-shirt', pg_temp.col('navy'));
select pg_temp.seg('s1blue', 10, 'T-shirt', pg_temp.col('blue'));
select pg_temp.seg('s1mar', 7, 'T-shirt', pg_temp.col('maroon'));
select pg_temp.seg('s1bot', 10, 'Jeans', pg_temp.col('black'));
select pg_temp.seg('s1out', 9, 'Jacket', pg_temp.col('grey'));
select pg_temp.seg('s1foot', 13, 'Sneakers', pg_temp.col('red'), '{"two":5}');
select pg_temp.seg('s1acc', 12, 'Watch', pg_temp.col('black'));
select pg_temp.seg('s1act', 12, 'Track pants', pg_temp.col('blue'));     -- Blue also in Activewear: Tops x Blue is hidden by suppression itself, not by its size
select pg_temp.run() as id \gset s1_
select is(pg_temp.vals('{"d_category":"Outerwear"}'), null, 'FR-80 a category of 9 users is not published');
select is(coalesce(pg_temp.vals('{"d_category":"Bottoms"}'), 'hidden'), 'hidden',
  'WO-0178 (was: published as 10/10/10): the total is a parent of the categories, Outerwear (9) is hidden, so the smallest visible category, Bottoms (exactly 10), is hidden with it; a segment of exactly 10 is published in the single-segment run above');
select is(pg_temp.vals('{"d_category":"Accessories"}') || ' ' || pg_temp.vals('{"d_category":"Footwear"}'), '10/10/10 15/20/10',
  'FR-82 rounds to the nearest 5: 12 users and 12 events give 10, 13 users and 18 events give 15 and 20 (users_floor stays 10)');
select is_empty($$ select 1 from analytics.cube where users_rounded % 5 <> 0 or events_rounded % 5 <> 0 $$, 'FR-82 every published users_rounded and events_rounded is a multiple of 5');
select is_empty($$ select 1 from analytics.cube where users_rounded <= 0 or events_rounded <= 0 $$, 'LLD 5.3 step 4: no published value is 0');
select is_empty($$ select 1 from analytics.cube where users_floor < 10 or users_floor % 5 <> 0 or users_floor > users_rounded $$, 'LLD 5.3 step 3: users_floor >= min_group_size on every published row');
select is(pg_temp.vals('{"d_category":"Tops","d_colour_family":"Navy"}'), '40/40/40', 'complementary suppression leaves the big cell (Tops x Navy 40) visible');
select is(pg_temp.vals('{"d_category":"Tops","d_colour_family":"Maroon"}') || pg_temp.vals('{"d_category":"Tops","d_colour_family":"Blue"}'), null,
  'LLD 5.3 step 2: one hidden sibling (Tops x Maroon, 7) hides the smallest visible sibling (Tops x Blue, 10)');
select is(coalesce(pg_temp.vals('{"d_category":"Activewear","d_colour_family":"Blue"}'), 'hidden') || ' ' || pg_temp.vals('{"d_category":"Activewear"}'), 'hidden 10/10/10',
  'LLD 5.3 step 2 repeats until nothing new is hidden: Tops x Blue (hidden by suppression, 10 users) is the one hidden child of Blue, so Activewear x Blue is hidden in a later pass');
select is(pg_temp.recov(), 0::bigint, 'LLD 5.3 step 2: no parent minus visible children over the published cube leaves a difference of 1 to 9');
select is_empty($$ select 1 from analytics.cube where num_nonnulls(f_size, f_season, f_price_band, f_region) > 1 $$, 'FR-77 at most one filter column is non-null in any row');
select is((select count(*) from analytics.cube c where pg_temp.attrs(c) = '{}'), 0::bigint, 'no published row is an "all of everything" row');
select is((select array_agg(pg_temp.vals(a) order by i) from unnest(array['{"d_fit":"Unknown"}', '{"d_category":"Footwear","d_fit":"Unknown"}', '{"d_category":"Footwear"}', '{"d_brand":"Unknown"}',
  '{"d_category":"Footwear","f_size":"Unknown"}', '{"d_category":"Footwear","f_price_band":"Unknown"}', '{"d_category":"Footwear","f_season":"All year"}']::jsonb[]) with ordinality t(a, i)),
  array['115/120/110', '15/20/10', '15/20/10', '115/120/110', '15/20/10', '15/20/10', '15/20/10'],
  'items with no fit, brand, size or price are counted under Unknown beside, never merged with, the null (all) row');
select is((select count(*) from analytics.cube where condition_band is not null), 0::bigint, 'unrated items give no condition row (no band "Unrated" is published)');
select is((select count(*) from analytics_private.cube_stage) + (select count(*) from analytics_private.facts), 0::bigint, 'LLD 5.3 step 5: cube_stage and facts are empty after the run');
select is(pg_temp.st(:s1_id), 'ok/-/113/118/' || (select rows_suppressed from ops.aggregate_runs where id = :s1_id), 'FR-86 the run row: ok, 113 users, 118 items');
select ok((select rows_suppressed > 0 and finished_at >= started_at and duration_ms >= 0 from ops.aggregate_runs where id = :s1_id), 'FR-86 the run row has start, end, duration and rows suppressed');
select is((select count(distinct run_id) || '/' || min(run_id) from analytics.cube), '1/' || :s1_id, 'every published row carries the run id the function returned');
insert into keep select pg_temp.digest();
-- FR-63, FR-64: users who left the pilot or never consented, and a vendor, would turn Maroon (7) into 20 users; nothing changes
select pg_temp.seg('s1del', 4, 'T-shirt', pg_temp.col('maroon'));
select pg_temp.seg('s1nc', 4, 'T-shirt', pg_temp.col('maroon'));
select pg_temp.seg('s1ven', 5, 'T-shirt', pg_temp.col('maroon'));
update app.profiles set deleting = true where id in (select pg_temp.uid('s1del', g) from generate_series(1, 4) g);
delete from app.consent_records where user_id in (select pg_temp.uid('s1nc', g) from generate_series(1, 4) g);
update app.profiles set role = 'vendor' where id in (select pg_temp.uid('s1ven', g) from generate_series(1, 5) g);
select pg_temp.run() as id \gset s1b_
select is(pg_temp.digest(), (select v from keep), 'FR-63 FR-64 deleting, unconsented and vendor users change no output');
select is((select count(distinct run_id) || '/' || min(run_id) from analytics.cube), '1/' || :s1b_id, 'the new run replaced the cube (one run id, the new one)');
-- LLD 13.2: a failing run records error with a fixed code and the previous cube stays
update ops.settings set value = '7' where key = 'min_group_size';
select pg_temp.run() as id \gset s1e_
select is(pg_temp.st(:s1e_id), 'error/invalid_min_group_size/-/-/-', 'LLD 13.2 a run with min_group_size 7 records status error with the fixed code invalid_min_group_size');
select is(pg_temp.digest() || (select min(run_id) from analytics.cube), (select v from keep) || :s1b_id, 'the failed run leaves the previous cube unchanged');
select is((select count(*) from analytics_private.cube_stage) + (select count(*) from analytics_private.facts), 0::bigint, 'the failed run leaves no staging or fact rows');
select is((select finished_at is not null from ops.aggregate_runs where id = :s1e_id), true, 'the error row is finished');
update ops.settings set value = '10' where key = 'min_group_size';
alter table analytics.cube add constraint wo0099_force_error check (users_rounded < 0) not valid;     -- an unforeseen failure while publishing
select pg_temp.run() as id \gset s1g_
alter table analytics.cube drop constraint wo0099_force_error;
select is(pg_temp.st(:s1g_id) || ' ' || (pg_temp.digest() = (select v from keep)), 'error/run_failed/-/-/- true', 'LLD 13.2 any other failure records the fixed code run_failed (never the message) and keeps the previous cube');
update ops.settings set value = '0' where key = 'min_group_size';
select pg_temp.run() as id \gset s1z_
update ops.settings set value = 'ten' where key = 'min_group_size';
select pg_temp.run() as id \gset s1t_
select is(pg_temp.st(:s1z_id) || ' ' || pg_temp.st(:s1t_id), 'error/invalid_min_group_size/-/-/- error/invalid_min_group_size/-/-/-', 'a zero or a non-numeric min_group_size is refused the same way');
update ops.settings set value = '15' where key = 'min_group_size';
select pg_temp.run() as id \gset s1f_
select is(pg_temp.st(:s1f_id) like 'ok/%' and not exists (select 1 from analytics.cube where users_floor < 15), true, 'BR-26 a multiple of 5 other than 10 (15) is accepted and applied');
update ops.settings set value = '10' where key = 'min_group_size';
select pg_temp.clear();

-- ---- 5. complementary suppression: two hidden siblings under 10 together hide a third; 10 together do not ---------------------------------------
select pg_temp.seg('s3navy', 40, 'T-shirt', pg_temp.col('navy'));
select pg_temp.seg('s3blue', 11, 'T-shirt', pg_temp.col('blue'));
select pg_temp.seg('s3mar', 3, 'T-shirt', pg_temp.col('maroon'));
select pg_temp.seg('s3grey', 3, 'T-shirt', pg_temp.col('grey'));
select pg_temp.run();
select is(pg_temp.vals('{"d_category":"Tops","d_colour_family":"Blue"}') || pg_temp.vals('{"d_category":"Tops","d_colour_family":"Maroon"}') || pg_temp.vals('{"d_category":"Tops","d_colour_family":"Grey"}'), null,
  'LLD 5.3 step 2: two hidden siblings with 6 users together (under 10) also hide the smallest visible sibling');
select is(pg_temp.vals('{"d_category":"Tops","d_colour_family":"Navy"}') || ' ' || pg_temp.recov(), '40/40/40 0', 'the other visible sibling stays and nothing is recoverable by subtraction');
select pg_temp.clear();
select pg_temp.seg('s4navy', 40, 'T-shirt', pg_temp.col('navy'));
select pg_temp.seg('s4blue', 11, 'T-shirt', pg_temp.col('blue'));
select pg_temp.seg('s4mar', 5, 'T-shirt', pg_temp.col('maroon'));
select pg_temp.seg('s4grey', 5, 'T-shirt', pg_temp.col('grey'));
select pg_temp.run();
select is(pg_temp.vals('{"d_category":"Tops","d_colour_family":"Blue"}') || ' ' || coalesce(pg_temp.vals('{"d_category":"Tops","d_colour_family":"Maroon"}'), '-') || ' ' || pg_temp.recov(), '10/10/10 - 0',
  'two hidden siblings with 10 users together hide no third sibling (Blue stays visible, Maroon stays hidden)');
select pg_temp.clear();

-- a cell hidden by suppression (Tops x Blue, 21 users) is not itself a parent that hides more: its visible size cell (12) stays
select pg_temp.seg('s8navy', 40, 'T-shirt', pg_temp.col('navy'));
select pg_temp.seg('s8bs', 12, 'T-shirt', pg_temp.col('blue'), '{"sys":"Letter","size":"S"}');
select pg_temp.seg('s8bm', 9, 'T-shirt', pg_temp.col('blue'), '{"sys":"Letter","size":"M"}');
select pg_temp.seg('s8mar', 7, 'T-shirt', pg_temp.col('maroon'));
select pg_temp.run();
select is(coalesce(pg_temp.vals('{"d_category":"Tops","d_colour_family":"Blue"}'), 'hidden') || ' ' || pg_temp.vals('{"d_category":"Tops","d_colour_family":"Blue","f_size":"Letter:S"}') || ' ' || pg_temp.recov(), 'hidden 10/10/10 0',
  'LLD 5.3 step 2 looks only at unmarked parents: Tops x Blue is hidden, so its single hidden size (9) hides nothing more');
select pg_temp.clear();

-- ---- 6. filter children: a hidden size cell hides the smallest visible size of the same category -------------------------------------------
select pg_temp.seg('s6s', 40, 'T-shirt', pg_temp.col('navy'), '{"sys":"Letter","size":"S"}');
select pg_temp.seg('s6m', 10, 'T-shirt', pg_temp.col('navy'), '{"sys":"Letter","size":"M"}');
select pg_temp.seg('s6l', 7, 'T-shirt', pg_temp.col('navy'), '{"sys":"Letter","size":"L"}');
select pg_temp.run();
select is(pg_temp.vals('{"d_category":"Tops","f_size":"Letter:S"}') || ' ' || coalesce(pg_temp.vals('{"d_category":"Tops","f_size":"Letter:M"}'), '-') || ' ' || coalesce(pg_temp.vals('{"d_category":"Tops","f_size":"Letter:L"}'), '-'),
  '40/40/40 - -', 'LLD 5.3 step 2: a hidden size (7) hides the smallest visible size (10) of the same category: the filter values are children');
select is(pg_temp.recov(), 0::bigint, 'nothing is recoverable from the category total over its size cells');
select pg_temp.clear();

-- ---- 7. condition bands are the children of their category -------------------------------------------------------------------------------
select pg_temp.seg('s5a', 40, 'T-shirt', pg_temp.col('navy'), '{"cond":5}');
select pg_temp.seg('s5b', 10, 'T-shirt', pg_temp.col('navy'), '{"cond":20}');
select pg_temp.seg('s5c', 7, 'T-shirt', pg_temp.col('navy'), '{"cond":40}');
select pg_temp.run();
select is((select array_agg(condition_band || ':' || users_rounded order by condition_band) from analytics.cube where condition_band is not null), array['Brand new:40'],
  'LLD 5.2 and 5.3 step 2: the bands of a category are its children: a hidden band (Good, 7) hides the smallest visible band (Like new, 10)');
select is(pg_temp.recov(), 0::bigint, 'the category total minus its visible bands leaves no difference of 1 to 9');
select is((select count(*) from analytics.cube where condition_band is not null and (d_category is null or num_nonnulls(d_colour_family, d_fit, d_brand, f_size, f_season, f_price_band, f_region) > 0)), 0::bigint,
  'a condition row has a category and nothing else');
select pg_temp.clear();
select pg_temp.seg('s5u', 12, 'T-shirt', pg_temp.col('navy'), '{"cond":5}');
select pg_temp.seg('s5v', 12, 'T-shirt', pg_temp.col('navy'));
select pg_temp.run();
select is(pg_temp.vals('{"d_category":"Tops","condition_band":"Brand new"}') || ' ' || pg_temp.vals('{"d_category":"Tops"}'), '10/10/10 25/25/20', 'unrated items are left out of the bands but counted in the category (12 rated, 24 in all)');
select pg_temp.clear();

-- ---- 8. FR-80 with the BR-26 shipped value of 50 ------------------------------------------------------------------------------------------
update ops.settings set value = '50' where key = 'min_group_size';
-- WO-0178: the total is a parent of the categories, so a hidden category (45) would hide the smallest visible one (50) beside it; the two segments are therefore run one after the other
create temp table keep7 (v text);
select pg_temp.seg('s7t', 45, 'T-shirt', pg_temp.col('navy'));
select pg_temp.run();
insert into keep7 select coalesce(pg_temp.vals('{"d_category":"Tops"}'), 'hidden');
select pg_temp.clear();
select pg_temp.seg('s7b', 50, 'Jeans', pg_temp.col('black'));
select pg_temp.run();
select is((select v from keep7) || ' ' || pg_temp.vals('{"d_category":"Bottoms"}'), 'hidden 50/50/50', 'BR-26 with min_group_size 50 a segment of 45 users is hidden and one of 50 is shown');
select is_empty($$ select 1 from analytics.cube where users_floor < 50 $$, 'every published row has at least 50 users');

select * from finish();
rollback;
