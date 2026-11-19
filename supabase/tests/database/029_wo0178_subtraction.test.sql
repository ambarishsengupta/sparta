-- WO-0178 (R8b) / LLD 5.3 step 2, FR-82: no hidden count can be recovered by subtracting from a parent, counted in DISTINCT USERS. The WO-0177 privacy review found two leaks in the rule of
-- WO-0099 and WO-0110, both shown here on the data of the review:
--   Leak 1: the remainder counted the users of the parent with ANY fact outside the visible children, so a user who also has a visible child was counted: the remainder looked larger than
--           what subtraction reveals. 13 users: u1-u10 own black Activewear, u1-u7 also red, u11-u13 only navy. Black is visible (10), red (7) and navy (3) are hidden; the parent (13, shown
--           as 15) minus black (10) leaves exactly the 3 users of the hidden navy cell. The remainder must be the users with NO fact in any visible child (3 here), so black is hidden too.
--   Leak 2: there was no all-null total row, so single-dimension sibling sets (a colour on its own, a fit, a brand) had no parent and were never protected, while the total is published
--           through coverage(). 20 black owners and 5 others who each own navy AND red: "Black 20" next to the total 25 reveals the 5. The total is now a parent in step 2 (never published).
-- Synthetic and rolled back. Part 1 and part 2 are the two examples (they fail on the rule before WO-0178), part 3 is a control that must not hide more than the rule needs, part 4 pins
-- what happens to the total row, part 5 proves the independent per-user check can fail.
begin;
\ir helpers.inc
select plan(26);

create function pg_temp.uid(p_tag text, g int) returns uuid language sql immutable as $f$ select md5('wo0178:' || p_tag || ':' || g)::uuid $f$;
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
-- Independent recovery check, in distinct users, written from the cube and the facts alone (no function of the run is shared). The parents are every published row AND the total of a kind
-- and a period (the all-null row; it is not a cube row, but coverage() publishes the cohort, which for these single-kind fixtures is that total). For each parent and each attribute that
-- splits it (children = same kind and period, parent attributes plus one) the residual is the number of distinct users of the parent with NO fact in any visible child of that set (the
-- parent minus the union of the visible children). A residual of 1 to 9 is a hidden count a reader can recover by subtraction.
create function pg_temp.leaks(out pairs bigint, out leaks bigint) language sql stable as $f$
  with gt as (select user_hash u, kind, period, jsonb_strip_nulls(jsonb_build_object('d_category', category, 'd_colour_family', colour_family, 'd_fit', fit, 'd_brand', brand,
         'f_size', size, 'f_season', season, 'f_price_band', price_band, 'f_region', region, 'condition_band', condition_band)) a from analytics_private.facts),
  pub as (select kind, period, pg_temp.attrs(c) a from analytics.cube c union select distinct kind, period, '{}'::jsonb from gt),
  ps as (select p.kind, p.period, p.a pa, k.key x, array_agg(c.a ->> k.key) vs from pub p join pub c on c.kind = p.kind and c.period = p.period
         cross join lateral jsonb_object_keys(c.a) k(key) where c.a - k.key = p.a group by 1, 2, 3, 4),
  r as (select (select count(distinct g.u) from gt g where g.kind = ps.kind and g.period = ps.period and g.a @> ps.pa
                and not exists (select 1 from gt h where h.u = g.u and h.kind = ps.kind and h.period = ps.period and h.a @> ps.pa and h.a ->> ps.x = any (ps.vs))) n from ps)
  select count(*), count(*) filter (where n between 1 and 9) from r $f$;
create function pg_temp.truth(out pairs bigint, out leaks bigint) language plpgsql as $f$
begin perform analytics_private.build_facts('wo0178-check'); select * into pairs, leaks from pg_temp.leaks(); truncate analytics_private.facts; end $f$;   -- a salt of its own: the run's facts are gone
create function pg_temp.run() returns text language plpgsql as $f$
declare v bigint := analytics.run_aggregation();
begin return (select status || '/' || coalesce(error_code, '-') from ops.aggregate_runs where id = v); end $f$;
create function pg_temp.fam(p_tag text) returns text language sql stable as $f$ select colour_family from app.items where user_id = pg_temp.uid(p_tag, 1) limit 1 $f$;
-- the published rows with exactly this category and a colour (the colour children of a category), and the rows that carry a colour and nothing else
create function pg_temp.kids(p_cat text) returns bigint language sql stable as $f$
  select count(*) from analytics.cube c where c.kind = 'owned' and c.d_category = p_cat and c.d_colour_family is not null and num_nonnulls(c.d_fit, c.d_brand, c.f_size, c.f_season, c.f_price_band, c.f_region, c.condition_band) = 0 $f$;
create function pg_temp.colour_only() returns bigint language sql stable as $f$
  select count(*) from analytics.cube c where c.kind = 'owned' and c.d_colour_family is not null and num_nonnulls(c.d_category, c.d_fit, c.d_brand, c.f_size, c.f_season, c.f_price_band, c.f_region, c.condition_band) = 0 $f$;

-- ======== 1. leak 1: a user who also has a visible child must not count as "remainder" ===============================================================================
-- 13 users: u1-u10 black, u1-u7 also red, u11-u13 navy only. Black 10 (visible), red 7 and navy 3 (hidden). Users with a fact outside black: 10 (the old "any fact" count, enough to keep black);
-- users with NO fact in black: 3 (the navy-only users) = exactly what 15 - 10 reveals. Black has to be hidden.
select pg_temp.mk('p', 13); select pg_temp.own('p', 1, 10, '{0,0,0}'); select pg_temp.own('p', 1, 7, '{255,0,0}'); select pg_temp.own('p', 11, 13, '{0,0,139}');
select is(pg_temp.run(), 'ok/-', '1: the run finishes ok');
select is(pg_temp.vals('{"d_category":"Activewear"}'), '15/20/10', '1: the Activewear parent (13 users, 20 items) is published as 15');
select is(pg_temp.vals(format('{"d_category":"Activewear","d_colour_family":%s}', to_json(pg_temp.fam('p')))::jsonb), null, '1: Activewear x Black (10 users) is NOT published: only the 3 navy-only users sit outside it, 15 - 10 would recover them');
select is(pg_temp.kids('Activewear'), 0::bigint, '1: no colour child of Activewear is published (black, red and navy are all hidden)');
select * from pg_temp.truth() \gset l1_
select is(:l1_leaks::bigint, 0::bigint, '1: independent check, per user, parent minus the union of the visible children (the total and every published row as parents): no residual of 1 to 9 users');
select ok(:l1_pairs > 0, '1: and the check looked at parent/attribute pairs (not vacuous)');
select pg_temp.clear();

-- ======== 2. leak 2: single-dimension sets have no parent without the total =========================================================================================
-- WO-0110 example A: 20 users own black; 5 OTHER users each own navy AND red. Colour on its own: black 20 visible, navy 5 and red 5 hidden. Total 25 (published through coverage()):
-- 25 - 20 = 5 recovers the 5 users in the hidden cells. The total is a parent of the colour rows, so black must be hidden.
select pg_temp.mk('blk', 20); select pg_temp.own('blk', 1, 20, '{0,0,0}');
select pg_temp.mk('ov', 5); select pg_temp.own('ov', 1, 5, '{0,0,139}'); select pg_temp.own('ov', 1, 5, '{255,0,0}');
select is(pg_temp.run(), 'ok/-', '2: the run finishes ok');
select is(pg_temp.vals('{"d_category":"Activewear"}'), '25/30/25', '2: the Activewear row (25 users) stays published');
select is(pg_temp.vals(format('{"d_colour_family":%s}', to_json(pg_temp.fam('blk')))::jsonb), null, '2: the colour row "Black 20" on its own is NOT published: 25 - 20 would recover the 5 users in navy and red');
select is(pg_temp.colour_only(), 0::bigint, '2: no colour-only row is published at all (the whole set is hidden: the remainder outside the visible children was 5)');
select is((select users_rounded from analytics_private.q_coverage()), 25, '2: coverage() publishes the total of 25 users (so the total is a published parent)');
select * from pg_temp.truth() \gset l2_
select is(:l2_leaks::bigint, 0::bigint, '2: independent check, per user, with the total as a parent: no residual of 1 to 9 users');
select ok(:l2_pairs > 0, '2: and the check looked at parent/attribute pairs (not vacuous)');
select pg_temp.clear();

-- ======== 3. the rule must not hide more than it needs ==============================================================================================================
-- Black 20, navy 6 and red 6 on DIFFERENT users: 12 users have no fact in black, enough (10): black stays visible on its own and under Activewear, for both parents.
select pg_temp.mk('blk', 20); select pg_temp.own('blk', 1, 20, '{0,0,0}');
select pg_temp.mk('nv', 6); select pg_temp.own('nv', 1, 6, '{0,0,139}');
select pg_temp.mk('rd', 6); select pg_temp.own('rd', 1, 6, '{255,0,0}');
select is(pg_temp.run(), 'ok/-', '3: the run finishes ok');
select is(pg_temp.vals(format('{"d_colour_family":%s}', to_json(pg_temp.fam('blk')))::jsonb), '20/20/20', '3: Black 20 on its own stays published: 12 users sit outside it');
select is(pg_temp.vals(format('{"d_category":"Activewear","d_colour_family":%s}', to_json(pg_temp.fam('blk')))::jsonb), '20/20/20', '3: Activewear x Black 20 stays published');
select * from pg_temp.truth() \gset l3_
select is(:l3_leaks::bigint, 0::bigint, '3: no residual of 1 to 9 users');
select pg_temp.clear();
-- ======== 4. the total row is a working row only =====================================================================================================================
select pg_temp.mk('blk', 20); select pg_temp.own('blk', 1, 20, '{0,0,0}');
select pg_temp.mk('ov', 5); select pg_temp.own('ov', 1, 5, '{0,0,139}'); select pg_temp.own('ov', 1, 5, '{255,0,0}');
select pg_temp.run() as id \gset t4_
select is((select count(*) from analytics.cube c where pg_temp.attrs(c) = '{}'), 0::bigint, '4: the all-null total row is never published');
select is((select count(*) from analytics_private.cube_stage) + (select count(*) from analytics_private.facts) + (select count(*) from analytics_private.supp_cell), 0::bigint, '4: staging, facts and working tables are empty after the run');
select pg_temp.clear();
-- 9 users: every group is under 10 and so is the total. 35 groups are suppressed; the total row is not counted in rows_suppressed
select pg_temp.mk('n9', 9); select pg_temp.own('n9', 1, 9, '{0,0,139}');
select analytics.run_aggregation() as id \gset t9_
select is((select status || '/' || users_included || '/' || rows_suppressed from ops.aggregate_runs where id = :t9_id), 'ok/9/35', '4: 9 users: 35 groups suppressed, the working total row is not counted in rows_suppressed');
select is((select count(*) from analytics.cube), 0::bigint, '4: and nothing is published');
select pg_temp.clear();
-- ======== 4b. the condition bands do not cover their category (unrated items have no band row) ======================================================================
-- 20 users own a rated Activewear item (band "Brand new", visible), 7 own only an unrated one. No band is hidden, but category (27, shown as 25) minus the band (20) leaves the 7 unrated users.
-- The per-user check of test 020 flagged this on 6 of its 30 seeded populations. With 12 unrated users (a remainder of 12) the band stays.
select pg_temp.mk('cr', 20); select pg_temp.own('cr', 1, 20, '{0,0,0}');
update app.items set condition = 5 where user_id in (select pg_temp.uid('cr', g) from generate_series(1, 20) g);
select pg_temp.mk('cu', 7); select pg_temp.own('cu', 1, 7, '{0,0,0}');
select pg_temp.run() as r \gset c1_
select is((select count(*) from analytics.cube where condition_band is not null), 0::bigint, '4b: 20 rated + 7 unrated users: the band (20) is hidden, 27 - 20 would reveal the 7 users with no rated item');
select pg_temp.clear();
select pg_temp.mk('cr', 20); select pg_temp.own('cr', 1, 20, '{0,0,0}');
update app.items set condition = 5 where user_id in (select pg_temp.uid('cr', g) from generate_series(1, 20) g);
select pg_temp.mk('cu', 12); select pg_temp.own('cu', 1, 12, '{0,0,0}');
select pg_temp.run() as r \gset c2_
select is((select string_agg(condition_band || ':' || users_rounded, ',') from analytics.cube where condition_band is not null), 'Brand new:20', '4b: 20 rated + 12 unrated users: 12 users sit outside the band, so it stays published');
select pg_temp.clear();

-- ======== 5. the independent check can fail ============================================================================================================================
-- Hand-made facts: 20 black and 5 navy users, all Activewear. A cube that publishes the total-level colour row Black 20 (and Activewear 25) leaves 5 users: both the (Activewear, colour) pair
-- and the (total, colour) pair must report it.
delete from analytics.cube;
truncate analytics_private.facts;
insert into analytics_private.facts (user_hash, kind, period, category, sub_type, colour_family, fit, brand, size, season, price_band, condition_band, region)
  select md5('h' || g) || md5('i' || g), 'owned', date '2026-11-01', 'Activewear', 'Sports T-shirt', case when g <= 20 then 'Black' else 'Navy' end, 'Unknown', 'Unknown', 'Unknown', 'All year', 'Unknown', 'Unrated', 'South Asia'
  from generate_series(1, 25) g;
insert into analytics.cube (run_id, kind, period, d_category, d_colour_family, users_rounded, events_rounded, users_floor)
  select r.id, 'owned', date '2026-11-01', v.cat, v.cf, v.n, v.n, v.n from (select max(id) id from ops.aggregate_runs) r, (values ('Activewear', null, 25), ('Activewear', 'Black', 20)) v(cat, cf, n);
select is((select pairs || '/' || leaks from pg_temp.leaks()), '2/1', '5 canary: a published Activewear 25 with a visible Black 20 leaves 5 users: one leaking pair (the total over the category row is clean)');
insert into analytics.cube (run_id, kind, period, d_colour_family, users_rounded, events_rounded, users_floor)
  select r.id, 'owned', date '2026-11-01', 'Black', 20, 20, 20 from (select max(id) id from ops.aggregate_runs) r;
select is((select pairs || '/' || leaks from pg_temp.leaks()), '4/2', '5 canary: adding the colour-only row Black 20 leaves the 5 navy users under the TOTAL as well: the check reports a second leaking pair (and a clean pair, Black over Activewear x Black)');
-- the per-user count differs from the per-fact count: a user with a fact in black AND a hidden colour is not "outside" black
truncate analytics_private.facts;
insert into analytics_private.facts (user_hash, kind, period, category, sub_type, colour_family, fit, brand, size, season, price_band, condition_band, region)
  select md5('h' || g) || md5('i' || g), 'owned', date '2026-11-01', 'Activewear', 'Sports T-shirt', c, 'Unknown', 'Unknown', 'Unknown', 'All year', 'Unknown', 'Unrated', 'South Asia'
  from generate_series(1, 20) g cross join unnest(array['Black', 'Navy']) c;
select is((select leaks from pg_temp.leaks()), 0::bigint, '5 canary: when every user of the parent also has a fact in the visible child, nothing is left outside it (the old per-fact count would have said 20 facts)');
delete from analytics.cube;
truncate analytics_private.facts;

select * from finish();
rollback;
