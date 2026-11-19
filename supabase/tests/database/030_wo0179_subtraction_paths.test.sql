-- WO-0179 (R8b) / LLD 5.3 step 2, FR-82: the subtraction paths WO-0178 left open, each shown on a constructed case that FAILS on the WO-0178 rule and passes on the WO-0179 rule.
--   Part 1 (instruction 0, the trigger): WO-0178 hid a child also when the remainder was 0 and a child was hidden, so a category every user owns (Tops) disappeared as soon as two other
--           categories were hidden, although nobody sits outside it. Variant Z hides only on a remainder of 1 to min_group_size - 1 users, or when the hidden children together hold
--           fewer than min_group_size distinct users.
--   Part 2 (instruction 1, the cohort): coverage() published the cohort of ALL kinds, a number no published row of the owned kind partitions: 20 users own black Activewear, 3 only have a
--           wishlist entry, coverage 23 (shown 25) next to Activewear 20 reveals users with no owned item. Coverage is now the owned total (users with an owned item), the total row that step 2 protects.
--   Part 3 (instruction 2, the band events): with nobody outside the condition bands, a category's events minus its band events reveal unrated items owned by fewer than min_group_size users.
--   Part 4: the independent check (users AND residual events) can fail.
-- Synthetic and rolled back.
begin;
\ir helpers.inc
select plan(18);

create function pg_temp.uid(p_tag text, g int) returns uuid language sql immutable as $f$ select md5('wo0179:' || p_tag || ':' || g)::uuid $f$;
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
-- Independent check from the cube and the facts alone, in distinct users and in events. The parents are every published row AND the total of a kind and a period. For each parent and each
-- attribute that splits it (children = same kind and period, parent attributes plus one) the user residual is the number of distinct users of the parent with NO fact in any visible
-- child; the event residual is the set of facts of the parent outside every visible child (what parent events minus child events leaves), counted in the distinct users who own them.
-- A user residual or an event-owner count of 1 to 9 is a hidden count a reader can recover by subtraction.
create function pg_temp.leaks(out pairs bigint, out user_leaks bigint, out event_leaks bigint) language sql stable as $f$
  with gt as (select user_hash u, kind, period, jsonb_strip_nulls(jsonb_build_object('d_category', category, 'd_colour_family', colour_family, 'd_fit', fit, 'd_brand', brand,
         'f_size', size, 'f_season', season, 'f_price_band', price_band, 'f_region', region, 'condition_band', condition_band)) a from analytics_private.facts),
  pub as (select kind, period, pg_temp.attrs(c) a from analytics.cube c union select distinct kind, period, '{}'::jsonb from gt),
  ps as (select p.kind, p.period, p.a pa, k.key x, array_agg(c.a ->> k.key) vs from pub p join pub c on c.kind = p.kind and c.period = p.period
         cross join lateral jsonb_object_keys(c.a) k(key) where c.a - k.key = p.a group by 1, 2, 3, 4),
  r as (select (select count(distinct g.u) from gt g where g.kind = ps.kind and g.period = ps.period and g.a @> ps.pa
                and not exists (select 1 from gt h where h.u = g.u and h.kind = ps.kind and h.period = ps.period and h.a @> ps.pa and h.a ->> ps.x = any (ps.vs))) n,
               (select count(distinct g.u) from gt g where g.kind = ps.kind and g.period = ps.period and g.a @> ps.pa and not coalesce(g.a ->> ps.x = any (ps.vs), false)) e from ps)
  select count(*), count(*) filter (where n between 1 and 9), count(*) filter (where e between 1 and 9) from r $f$;
create function pg_temp.truth(out pairs bigint, out user_leaks bigint, out event_leaks bigint) language plpgsql as $f$
begin perform analytics_private.build_facts('wo0179-check'); select * into pairs, user_leaks, event_leaks from pg_temp.leaks(); truncate analytics_private.facts; end $f$;   -- a salt of its own: the run's facts are gone
create function pg_temp.run() returns text language plpgsql as $f$
declare v bigint := analytics.run_aggregation();
begin return (select status || '/' || coalesce(error_code, '-') from ops.aggregate_runs where id = v); end $f$;
-- one active item of sub type p_sub for users p_from..p_to of a tag, black
create function pg_temp.item(p_tag text, p_from int, p_to int, p_sub text) returns void language sql as $f$
  insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin)
  select pg_temp.uid(p_tag, g), 'x', c.category, c.code, 0, 0, 0, 'manual' from generate_series(p_from, p_to) g join catalog.lk_sub_type c on c.code = p_sub $f$;
create function pg_temp.rate(p_tag text, p_from int, p_to int) returns void language sql as $f$
  update app.items set condition = 5 where user_id in (select pg_temp.uid(p_tag, g) from generate_series(p_from, p_to) g) $f$;
create function pg_temp.cov() returns text language sql stable as $f$ select coalesce(users_rounded::text, 'null') from analytics_private.q_coverage() $f$;

-- ======== 1. the trigger: a remainder of 0 does not hide a child =====================================================================================================
-- 30 users own a black T-shirt (Tops, visible). u1-u6 also own a Watch (Accessories) and u7-u12 Sneakers (Footwear): both hidden (6 users each). Nobody sits outside Tops (remainder 0) and
-- the hidden categories hold 12 distinct users together, so nothing is recoverable: Tops stays. The WO-0178 rule hid Tops ("a remainder of 0 also hides when a child is hidden").
select pg_temp.mk('t', 30); select pg_temp.item('t', 1, 30, 'T-shirt'); select pg_temp.item('t', 1, 6, 'Watch'); select pg_temp.item('t', 7, 12, 'Sneakers');
select is(pg_temp.run(), 'ok/-', '1: the run finishes ok');
select is(pg_temp.vals('{"d_category":"Tops"}'), '30/30/30', '1: Tops (30 users, everyone owns it) stays published: remainder 0, hidden categories hold 12 users together');
select is(pg_temp.vals('{"d_category":"Accessories"}') || pg_temp.vals('{"d_category":"Footwear"}'), null, '1: the two categories of 6 users stay hidden');
select * from pg_temp.truth() \gset z1_
select is(:z1_user_leaks::bigint + :z1_event_leaks::bigint, 0::bigint, '1: independent check, users and events: no residual of 1 to 9');
select ok(:z1_pairs > 0, '1: and the check looked at parent/attribute pairs (not vacuous)');
select pg_temp.clear();
-- control: the hidden categories hold only 8 distinct users together (4 + 4): Tops minus nothing leaves 8 events owned by 8 users, so Tops must be hidden (both rules do it)
select pg_temp.mk('t', 30); select pg_temp.item('t', 1, 30, 'T-shirt'); select pg_temp.item('t', 1, 4, 'Watch'); select pg_temp.item('t', 5, 8, 'Sneakers');
select pg_temp.run() as r \gset z2_
select is(pg_temp.vals('{"d_category":"Tops"}'), null, '1 control: hidden categories of 4 + 4 users: total events minus Tops events would reveal 8 items of 8 users, so Tops is hidden');
select * from pg_temp.truth() \gset z3_
select is(:z3_user_leaks::bigint + :z3_event_leaks::bigint, 0::bigint, '1 control: no residual of 1 to 9');
select pg_temp.clear();

-- ======== 2. the cohort: coverage is the owned total ===================================================================================================================
-- 20 users own black Activewear, 3 only have an open wishlist entry. The cohort is 23 (coverage 25); the owned rows say Activewear 20: 25 - 20 would show users with no owned item.
select pg_temp.mk('b', 20); select pg_temp.own('b', 1, 20, '{0,0,0}'); select pg_temp.mk('w', 3);
insert into app.wishlist_entries (user_id, name, category, sub_type, colour_r, colour_g, colour_b, status, origin)
  select pg_temp.uid('w', g), 'w', 'Activewear', 'Sports T-shirt', 0, 0, 0, 'open', 'user' from generate_series(1, 3) g;
select is(pg_temp.run(), 'ok/-', '2: the run finishes ok');
select is(pg_temp.vals('{"d_category":"Activewear"}'), '20/20/20', '2: Activewear is published as 20 users');
select is(pg_temp.cov(), '20', '2: coverage() is the 20 users with an owned item, not the cohort of 23 (shown 25)');
select is((select users_included::text from ops.aggregate_runs order by id desc limit 1), '20', '2: the run row holds the owned total (users with an owned item) that coverage reads');
select pg_temp.clear();
-- 12 users with a wishlist entry only: the cohort would be 32 (35), the owned total stays 20
select pg_temp.mk('b', 20); select pg_temp.own('b', 1, 20, '{0,0,0}'); select pg_temp.mk('w', 12);
insert into app.wishlist_entries (user_id, name, category, sub_type, colour_r, colour_g, colour_b, status, origin)
  select pg_temp.uid('w', g), 'w', 'Activewear', 'Sports T-shirt', 0, 0, 0, 'open', 'user' from generate_series(1, 12) g;
select pg_temp.run() as r \gset c2_
select is(pg_temp.cov(), '20', '2: with 12 wishlist-only users coverage is still the owned total (20), never the cohort (35)');
select pg_temp.clear();

-- ======== 3. the band events ===========================================================================================================================================
-- 20 users own a rated Activewear item (band Brand new), and u1-u3 also own an UNRATED one: nobody is outside the band (remainder 0) but the category has 23 events and the band 20: the
-- difference is 3 unrated items owned by 3 users. The band is hidden. With 12 such users the band stays.
select pg_temp.mk('cr', 20); select pg_temp.own('cr', 1, 20, '{0,0,0}'); select pg_temp.rate('cr', 1, 20); select pg_temp.own('cr', 1, 3, '{0,0,0}');
select pg_temp.run() as r \gset b1_
select is((select count(*) from analytics.cube where condition_band is not null), 0::bigint, '3: 20 rated users, 3 of them with an unrated item too: the band is hidden (the 3 unrated items would be recoverable from the events)');
select * from pg_temp.truth() \gset b2_
select is(:b2_user_leaks::bigint + :b2_event_leaks::bigint, 0::bigint, '3: independent check, users and events: no residual of 1 to 9');
select pg_temp.clear();
select pg_temp.mk('cr', 20); select pg_temp.own('cr', 1, 20, '{0,0,0}'); select pg_temp.rate('cr', 1, 20); select pg_temp.own('cr', 1, 12, '{0,0,0}');
select pg_temp.run() as r \gset b3_
select is((select string_agg(condition_band || ':' || users_rounded, ',') from analytics.cube where condition_band is not null), 'Brand new:20', '3: 12 users with an unrated item too: the band stays published');
select * from pg_temp.truth() \gset b4_
select is(:b4_user_leaks::bigint + :b4_event_leaks::bigint, 0::bigint, '3: and nothing is recoverable');
select pg_temp.clear();

-- ======== 4. the independent check can fail ============================================================================================================================
delete from analytics.cube;
truncate analytics_private.facts;
-- hand-made facts: 20 users with a rated item, u1-u3 with an unrated one too; a cube that publishes Activewear and the band leaves 3 unrated items owned by 3 users
insert into analytics_private.facts (user_hash, kind, period, category, sub_type, colour_family, fit, brand, size, season, price_band, condition_band, region)
  select md5('h' || g) || md5('i' || g), 'owned', date '2026-11-01', 'Activewear', 'Sports T-shirt', 'Black', 'Unknown', 'Unknown', 'Unknown', 'All year', 'Unknown', case when n = 1 then 'Brand new' else 'Unrated' end, 'South Asia'
  from generate_series(1, 20) g cross join generate_series(1, 2) n where n = 1 or g <= 3;
insert into analytics.cube (run_id, kind, period, d_category, d_colour_family, condition_band, users_rounded, events_rounded, users_floor)
  select r.id, 'owned', date '2026-11-01', 'Activewear', null, null, 20, 25, 20 from (select max(id) id from ops.aggregate_runs) r;
insert into analytics.cube (run_id, kind, period, d_category, condition_band, users_rounded, events_rounded, users_floor)
  select r.id, 'owned', date '2026-11-01', 'Activewear', 'Brand new', 20, 20, 20 from (select max(id) id from ops.aggregate_runs) r;
select is((select user_leaks || '/' || event_leaks from pg_temp.leaks()), '0/1', '4 canary: the band over its category leaves no user outside but 3 unrated items owned by 3 users: one event leak');
select is((select pairs from pg_temp.leaks()), 2::bigint, '4 canary: and the check looked at 2 parent/attribute pairs (the total by category, the category by band)');
delete from analytics.cube;
truncate analytics_private.facts;

select * from finish();
rollback;
