-- WO-0110 (R7a fix loop 1) / LLD 5.3 step 2 and 5.7: complementary suppression measures the hidden remainder in DISTINCT users, and the query log gets only allowlisted values.
-- Synthetic and rolled back. Part 1 is the checker's counter-example (20 black Activewear owners, 5 other users who each own navy and red: 5 + 5 summed to 10, but only 5 distinct
-- users sat in the hidden cells, so 25 - 20 recovered them) and two neighbours. Part 2 is a seeded random population test, 30 populations with overlapping owners, checked by an
-- independent "parent minus visible children" count in distinct users from the rebuilt facts. Part 3 proves the check can fail. Part 4 is the log allowlist (invented name, email).
begin;
\ir helpers.inc
select plan(33);

create function pg_temp.uid(p_tag text, g int) returns uuid language sql immutable as $f$ select md5('wo0110:' || p_tag || ':' || g)::uuid $f$;
create function pg_temp.mk(p_tag text, p_n int) returns void language sql as $f$
  insert into auth.users (id, email) select pg_temp.uid(p_tag, g), pg_temp.uid(p_tag, g)::text || '@example.test' from generate_series(1, p_n) g;
  update app.profiles set country = 'IN', hemisphere = 'north', age_confirmed = true where id in (select pg_temp.uid(p_tag, g) from generate_series(1, p_n) g);
  insert into app.consent_records (user_id, notice_version) select pg_temp.uid(p_tag, g), '1' from generate_series(1, p_n) g;
  insert into app.document_acceptances (user_id, document, version) select pg_temp.uid(p_tag, g), d, '1' from generate_series(1, p_n) g, unnest(array['terms', 'privacy_policy']) d $f$;
-- one active Sports T-shirt (Activewear) for users p_from..p_to of a tag, in one colour
create function pg_temp.own(p_tag text, p_from int, p_to int, p_rgb int[]) returns void language sql as $f$
  insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin)
  select pg_temp.uid(p_tag, g), 'x', 'Activewear', 'Sports T-shirt', p_rgb[1], p_rgb[2], p_rgb[3], 'manual' from generate_series(p_from, p_to) g $f$;
create function pg_temp.clear() returns void language sql as $f$ delete from auth.users where email like '%@example.test' $f$;
create function pg_temp.attrs(c analytics.cube) returns jsonb language sql immutable as $f$
  select jsonb_strip_nulls(jsonb_build_object('d_category', c.d_category, 'd_colour_family', c.d_colour_family, 'd_fit', c.d_fit, 'd_brand', c.d_brand,
    'f_size', c.f_size, 'f_season', c.f_season, 'f_price_band', c.f_price_band, 'f_region', c.f_region, 'condition_band', c.condition_band)) $f$;
create function pg_temp.vals(p jsonb) returns text language sql stable as $f$
  select string_agg(c.users_rounded || '/' || c.events_rounded || '/' || c.users_floor, ',') from analytics.cube c where c.kind = 'owned' and pg_temp.attrs(c) = p $f$;
-- Independent recovery check in DISTINCT users. For every published parent and every attribute that splits it (children = same kind and period, parent attributes plus one), the
-- residual is the number of distinct users of the parent (read from the facts, one row per fact) with no fact in any visible child. A residual of 1 to 9 is a recoverable hidden count.
create function pg_temp.leaks(out pairs bigint, out leaks bigint) language sql stable as $f$
  with gt as (select user_hash u, kind, period, jsonb_strip_nulls(jsonb_build_object('d_category', category, 'd_colour_family', colour_family, 'd_fit', fit, 'd_brand', brand,
         'f_size', size, 'f_season', season, 'f_price_band', price_band, 'f_region', region, 'condition_band', condition_band)) a from analytics_private.facts),
  pub as (select kind, period, pg_temp.attrs(c) a from analytics.cube c),
  ps as (select p.kind, p.period, p.a pa, k.key x, array_agg(c.a ->> k.key) vs from pub p join pub c on c.kind = p.kind and c.period = p.period
         cross join lateral jsonb_object_keys(c.a) k(key) where c.a - k.key = p.a group by 1, 2, 3, 4),
  r as (select (select count(distinct g.u) from gt g where g.kind = ps.kind and g.period = ps.period and g.a @> ps.pa and not coalesce(g.a ->> ps.x = any (ps.vs), false)) n from ps)
  select count(*), count(*) filter (where n between 1 and 9) from r $f$;
create function pg_temp.truth(out pairs bigint, out leaks bigint) language plpgsql as $f$
begin perform analytics_private.build_facts('wo0110-check'); select * into pairs, leaks from pg_temp.leaks(); end $f$;   -- a salt of its own: the run's facts are gone
create function pg_temp.run() returns text language plpgsql as $f$
declare v bigint := analytics.run_aggregation();
begin return (select status || '/' || coalesce(error_code, '-') from ops.aggregate_runs where id = v); end $f$;
create function pg_temp.kids(p_cat text) returns bigint language sql stable as $f$
  select count(*) from analytics.cube where kind = 'owned' and d_category = p_cat and d_colour_family is not null and d_fit is null and d_brand is null
    and f_size is null and f_season is null and f_price_band is null and f_region is null and condition_band is null $f$;
create function pg_temp.fam(p_tag text) returns text language sql stable as $f$ select colour_family from app.items where user_id = pg_temp.uid(p_tag, 1) limit 1 $f$;

-- ======== 1. the counter-example and two neighbours ==========================================================================================
-- (A) 20 users own black; 5 OTHER users each own navy AND red: navy 5, red 5 (sum 10), 5 distinct users. Black must be hidden too.
select pg_temp.mk('blk', 20); select pg_temp.own('blk', 1, 20, '{0,0,0}');
select pg_temp.mk('ov', 5); select pg_temp.own('ov', 1, 5, '{0,0,139}'); select pg_temp.own('ov', 1, 5, '{255,0,0}');
select is(pg_temp.run(), 'ok/-', 'A: the run finishes ok');
select isnt(pg_temp.fam('blk'), pg_temp.fam('ov'), 'A: black and navy are different colour families (the scenario is what it says)');
select is(pg_temp.vals('{"d_category":"Activewear"}'), '25/30/25', 'A: the Activewear parent (25 users, 30 items) stays published');
select is(pg_temp.kids('Activewear'), 0::bigint, 'A: no colour child is published: black (20) is hidden with navy (5) and red (5), because only 5 distinct users sit in the hidden cells');
select * from pg_temp.truth() \gset a_
select is(:a_leaks::bigint, 0::bigint, 'A: independent check in distinct users: no parent/attribute pair leaves a residual of 1 to 9 users');
select ok(:a_pairs > 0, 'A: and the check looked at published parent/attribute pairs (not vacuous)');
select pg_temp.clear();
-- (B) black 20, navy 6 and red 6 on DIFFERENT users: 12 distinct users in the hidden cells, so nothing more is hidden
select pg_temp.mk('blk', 20); select pg_temp.own('blk', 1, 20, '{0,0,0}');
select pg_temp.mk('nv', 6); select pg_temp.own('nv', 1, 6, '{0,0,139}');
select pg_temp.mk('rd', 6); select pg_temp.own('rd', 1, 6, '{255,0,0}');
select is(pg_temp.run(), 'ok/-', 'B: the run finishes ok');
select is(pg_temp.kids('Activewear'), 1::bigint, 'B: 12 distinct users sit in the two hidden cells (6 and 6, no overlap), so black stays the only published colour child');
select is(pg_temp.vals(format('{"d_category":"Activewear","d_colour_family":%s}', to_json(pg_temp.fam('blk')))::jsonb), '20/20/20', 'B: black is published as 20');
select * from pg_temp.truth() \gset b_
select is(:b_leaks::bigint, 0::bigint, 'B: no residual of 1 to 9 distinct users');
select pg_temp.clear();
-- (C) black 20; navy 6 and red 6 where 3 users own both: 9 distinct users, although 6 + 6 = 12. Black must be hidden (the old sum would have kept it, leaving 9 recoverable).
select pg_temp.mk('blk', 20); select pg_temp.own('blk', 1, 20, '{0,0,0}');
select pg_temp.mk('mx', 9); select pg_temp.own('mx', 1, 6, '{0,0,139}'); select pg_temp.own('mx', 1, 3, '{255,0,0}'); select pg_temp.own('mx', 7, 9, '{255,0,0}');
select is(pg_temp.run(), 'ok/-', 'C: the run finishes ok');
select is(pg_temp.kids('Activewear'), 0::bigint, 'C: navy 6 and red 6 hold 9 distinct users (under 10), so black (20) is hidden as well');
select * from pg_temp.truth() \gset c_
select is(:c_leaks::bigint, 0::bigint, 'C: no residual of 1 to 9 distinct users');
select pg_temp.clear();

-- ======== 2. seeded random populations with overlapping owners ==============================================================================
-- Each population: 30 to 89 eligible users, 1 to 3 items each, three sub types, five colours, fit, size and condition picked with a skew so the tail cells are small and many
-- users own several items (overlap). setseed makes every population the same on every run. After the run the facts are rebuilt with a salt of the test's own and counted in distinct users.
create temp table rr (seed int primary key, users int, status text, hidden int, pairs bigint, leaks bigint);
create function pg_temp.pop(p_seed int) returns void language plpgsql as $f$
declare n int;
begin
  perform setseed(p_seed / 100.0);
  n := 30 + floor(random() * 60)::int;
  perform pg_temp.mk('r', n);
  with raw as (
    select g, (array['T-shirt', 'Jeans', 'Sneakers'])[1 + floor(power(random(), 1.7) * 3)::int] sub,
           (array['{0,0,0}', '{0,0,139}', '{255,0,0}', '{192,192,192}', '{0,128,0}'])[1 + floor(power(random(), 2.2) * 5)::int]::int[] rgb,
           (array['Slim', 'Regular', null])[1 + floor(power(random(), 1.5) * 3)::int] fit, (array['S', 'M', 'L', null])[1 + floor(power(random(), 1.5) * 4)::int] sz,
           (array[null, 15, 45, 70, 95])[1 + floor(power(random(), 1.3) * 5)::int] cond
    from generate_series(1, n) g cross join lateral generate_series(1, 1 + floor(random() * 3)::int) k)
  insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, fit, size_system, size_value, condition)
    select pg_temp.uid('r', r.g), 'x', c.category, c.code, r.rgb[1], r.rgb[2], r.rgb[3], 'manual', r.fit, case when r.sz is not null then 'Letter' end, r.sz, r.cond::smallint
    from raw r join catalog.lk_sub_type c on c.code = r.sub;
end $f$;
select pg_temp.clear();
do $d$ begin
  for s in 1..30 loop
    perform pg_temp.pop(s);
    insert into rr (seed, users, status, hidden) select s, (select count(*) from auth.users where email like '%@example.test'), pg_temp.run(), (select rows_suppressed from ops.aggregate_runs order by id desc limit 1);
    update rr set pairs = t.pairs, leaks = t.leaks from pg_temp.truth() t where seed = s;
    perform pg_temp.clear();
  end loop;
end $d$;
select is((select count(*) from rr), 30::bigint, 'random: 30 seeded populations were built and run');
select is((select count(*) from rr where status <> 'ok/-'), 0::bigint, 'random: every run finished ok');
select ok((select min(users) >= 30 and max(users) <= 89 from rr), 'random: populations hold 30 to 89 users');
select ok((select count(*) from rr where hidden > 0) >= 25, 'random: complementary suppression had work to do in at least 25 populations (rows hidden in the run)');
select ok((select min(pairs) > 0 from rr), 'random: every population published parent/attribute pairs for the check to read');
select is((select sum(leaks)::bigint from rr), 0::bigint, 'random: across 30 populations no parent minus visible children leaves a hidden count of 1 to 9 distinct users');

-- ======== 3. the recovery check can fail ====================================================================================================
-- A hand-made cube that publishes the parent (25) and black (20) and hides the five users in navy and red: the check must report that one pair.
delete from analytics.cube;
truncate analytics_private.facts;
insert into analytics_private.facts (user_hash, kind, period, category, sub_type, colour_family, fit, brand, size, season, price_band, condition_band, region)
  select md5('h' || g) || md5('i' || g), 'owned', date '2026-11-01', 'Activewear', 'Sports T-shirt', case when g <= 20 then 'Black' else 'Navy' end, 'Unknown', 'Unknown', 'Unknown', 'All year', 'Unknown', 'Unrated', 'South Asia'
  from generate_series(1, 25) g;
insert into analytics.cube (run_id, kind, period, d_category, d_colour_family, users_rounded, events_rounded, users_floor)
  select r.id, 'owned', date '2026-11-01', 'Activewear', v.cf, v.n, v.n, v.n from (select max(id) id from ops.aggregate_runs) r, (values (null, 25), ('Black', 20)) v(cf, n);
select is((select pairs || '/' || leaks from pg_temp.leaks()), '1/1', 'canary: a published parent of 25 with a visible black of 20 leaves 5 distinct users, and the check reports that leak');
delete from analytics.cube;
truncate analytics_private.facts;

-- ======== 4. the query log holds only allowlisted values (LLD 5.7) ============================================================================
create function pg_temp.vu() returns uuid language sql immutable as $f$ select '00110000-0000-0000-0000-000000000001'::uuid $f$;
create function pg_temp.cu() returns uuid language sql immutable as $f$ select '00110000-0000-0000-0000-000000000002'::uuid $f$;
select pg_temp.mk_user(pg_temp.vu()); select pg_temp.mk_user(pg_temp.cu());
update app.profiles set role = 'vendor' where id = pg_temp.vu();
insert into catalog.vendors (id, name) values ('a1100000-0000-0000-0000-000000000001', 'Wo Ten Outfitters');
insert into catalog.vendor_members (vendor_id, user_id) values ('a1100000-0000-0000-0000-000000000001', pg_temp.vu());
insert into catalog.vendor_agreement_acceptances (vendor_id, user_id, version) values ('a1100000-0000-0000-0000-000000000001', pg_temp.vu(), '1');
insert into ops.aggregate_runs (status, finished_at, users_included, items_included, rows_suppressed, duration_ms) values ('ok', now(), 47, 90, 12, 100);
delete from ops.vendor_query_log;
create function pg_temp.v(p_sql text) returns text language sql as $f$ select pg_temp.val_as(pg_temp.vu(), 'authenticated', p_sql) $f$;
select is(pg_temp.v($$select count(*) from analytics.ownership_mix('category', 'size', 'Jane Roe')$$), 'err=P0001: invalid_dimension', 'log: an invented name as a size filter value is refused');
select is(pg_temp.v($$select count(*) from analytics.ownership_mix('category', 'region', 'jane.roe@example.test')$$), 'err=P0001: invalid_dimension', 'log: an email as a region filter value is refused');
select is(pg_temp.v($$select count(*) from analytics.trend('wishlist', 'category', 'month', 'season', 'Jane Roe')$$), 'err=P0001: invalid_dimension', 'log: an invented name as a trend filter value is refused');
select is(pg_temp.v($$select count(*) from analytics.gaps('category', 'price_band', 'jane.roe@example.test')$$), 'err=P0001: invalid_dimension', 'log: an email as a gaps filter value is refused');
select is(pg_temp.v($$select count(*) from analytics.condition_spectrum('Jane Roe')$$), 'err=P0001: invalid_dimension', 'log: an invented name as a category is refused');
select is(pg_temp.v($$select count(*) from analytics.condition_spectrum('jane.roe@example.test')$$), 'err=P0001: invalid_dimension', 'log: an email as a category is refused');
select is(pg_temp.v($$select count(*) from analytics.ownership_mix('category', 'season', 'Letter:M')$$), 'err=P0001: invalid_dimension', 'log: a value from another filter list (a size for a season filter) is refused');
select is(pg_temp.v($$select count(*) from analytics.ownership_mix('category', null, 'Letter:M')$$), 'err=P0001: invalid_dimension', 'log: a filter value with no filter name is refused');
select is((select count(*) from ops.vendor_query_log), 0::bigint, 'log: the eight refused calls left no log row');
select is(pg_temp.val_as(pg_temp.cu(), 'authenticated', $$select count(*) from analytics.ownership_mix('category', 'size', 'Jane Roe')$$), 'err=42501: forbidden', 'log: the role check still comes first: a consumer with a bad value gets forbidden');
select is_empty($$ select 1 from (values ('size', 'Letter:M'), ('size', 'Other'), ('size', 'Unknown'), ('season', 'Summer'), ('season', 'All year'), ('season', 'Multi-season'), ('price_band', '200+'),
  ('price_band', 'Unknown'), ('region', 'South Asia'), ('region', 'Unknown')) v(f, x)
  where pg_temp.v(format('select count(*) from analytics.ownership_mix(''category'', %L, %L)', v.f, v.x)) like 'err=%' $$, 'log: the values the cube can hold are accepted for every filter');
select is(pg_temp.v($$select count(*) from analytics.condition_spectrum('Tops')$$) like 'err=%', false, 'log: an allowlisted category is accepted');
select is((select count(*) from ops.vendor_query_log where params::text ~* 'jane|@'), 0::bigint, 'log: no row holds the invented name or the email');

select * from finish();
rollback;
