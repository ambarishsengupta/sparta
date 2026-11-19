-- WO-0177 (R8b): analytics.run_aggregation() was rewritten set-based so that it finishes at pilot scale; its OUTPUT must not change. This test runs the REFERENCE (a verbatim private copy of the
-- function body of migration 20261115100000, WO-0128, kept only here in pg_temp and gone at rollback) and the function in the database on the SAME data, one after the other, and asserts that
-- the published cubes are identical row for row (every column: attributes, users_rounded, events_rounded, users_floor) and that the run rows agree (status, error code, users, items, rows suppressed).
-- Data: every suppression case of the WO-0099 test (016) and the WO-0110 test (020), re-built here, their 30 seeded random populations, and two seeded random fixtures of thousands of facts across
-- categories, colours, fits, brands, sizes, seasons, price bands, regions and periods (owned, wishlist, open wishlist and purchase facts), each run at several minimum group sizes.
-- A skipped or vacuous comparison cannot pass: each fixture asserts how many facts, cube rows and complementary suppressions it holds. Synthetic and rolled back.
begin;
\ir helpers.inc
select plan(37);

-- ---- the reference: the function body before WO-0177, verbatim, under another name (pg_temp.ref_run_aggregation) --------------------------------------------------------------------------
create function pg_temp.ref_run_aggregation() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  c_lock constant bigint := 7099001;                         -- advisory lock key of the aggregation run
  v_dims constant text[] := array['category', 'colour_family', 'fit', 'brand', 'category, colour_family', 'category, fit', 'category, brand'];
  v_filters constant text[] := array['', 'size', 'season', 'price_band', 'region'];
  v_attrs constant text[] := array['d_category', 'd_colour_family', 'd_fit', 'd_brand', 'f_size', 'f_season', 'f_price_band', 'f_region', 'condition_band'];
  v_start timestamptz := clock_timestamp();
  v_run bigint; v_salt text; v_min int; v_users int; v_items int; v_supp int; v_pass int := 0; v_new int; v_n int; v_marks tid[]; v_pick tid[];
  v_sets text; v_on text; v_fm text; v_code text; a text; y text;
begin
  if not pg_try_advisory_xact_lock(c_lock) then
    raise exception 'aggregation_running' using errcode = '55P03';
  end if;
  insert into ops.aggregate_runs (started_at) values (v_start) returning id into v_run;
  begin
    select case when s.value ~ '^[0-9]{1,9}$' then s.value::int end into v_min from ops.settings s where s.key = 'min_group_size';
    if v_min is null or v_min <= 0 or v_min % 5 <> 0 then raise exception 'invalid_min_group_size'; end if;

    v_salt := encode(extensions.gen_random_bytes(16), 'hex');   -- in memory only, never stored
    perform analytics_private.build_facts(v_salt);               -- a separate statement: build_facts truncates facts
    select count(distinct f.user_hash), count(*) filter (where f.kind = 'owned') into v_users, v_items from analytics_private.facts f;

    -- LLD 5.2: seven dimension groups x five filter choices, then the condition spectrum (owned and rated only)
    truncate analytics_private.cube_stage;
    select string_agg('(' || concat_ws(', ', d, nullif(f, '')) || ')', ', ') into v_sets from unnest(v_dims) d cross join unnest(v_filters) f;
    execute 'insert into analytics_private.cube_stage (kind, period, d_category, d_colour_family, d_fit, d_brand, f_size, f_season, f_price_band, f_region, users, events) '
      || 'select kind, period, category, colour_family, fit, brand, size, season, price_band, region, count(distinct user_hash), count(*) '
      || 'from analytics_private.facts group by kind, period, grouping sets (' || v_sets || ')';
    insert into analytics_private.cube_stage (kind, period, d_category, condition_band, users, events)
      select 'owned', f.period, f.category, f.condition_band, count(distinct f.user_hash), count(*)
      from analytics_private.facts f where f.kind = 'owned' and f.condition_band <> 'Unrated' group by f.period, f.category, f.condition_band;

    -- LLD 5.3 step 1: mark rows under the minimum group size
    select coalesce(array_agg(s.ctid), '{}'::tid[]) into v_marks from analytics_private.cube_stage s where s.users < v_min;

    -- LLD 5.3 step 2: complementary suppression. A child of a row has the same kind and period and the row's attributes plus exactly one more (a filter
    -- value, a finer dimension group or a condition band); each added attribute gives its own set of siblings. Repeat until no row is newly marked.
    loop
      v_pass := v_pass + 1;
      if v_pass > 1000 then raise exception 'suppression_did_not_converge'; end if;
      v_new := 0;
      foreach a in array v_attrs loop
        v_on := 'p.kind = c.kind and p.period = c.period';
        v_fm := '';                                              -- the parent's own attributes, tested on the facts (fact column = name without d_ or f_)
        foreach y in array v_attrs loop
          if y <> a then
            v_on := v_on || format(' and coalesce(p.%1$s, chr(1)) = coalesce(c.%1$s, chr(1))', y);
            v_fm := v_fm || format(' and (p.%1$s is null or f.%2$s = p.%1$s)', y, regexp_replace(y, '^[df]_', ''));
          end if;
        end loop;
        execute format($q$
          with sib as (
            select p.ctid as pt, c.ctid as ct, c.%1$s as cv, c.users, (m.t is not null) as hid
            from analytics_private.cube_stage p
            join analytics_private.cube_stage c on c.%1$s is not null and p.%1$s is null and %2$s
            left join unnest($1) m(t) on m.t = c.ctid
            where not exists (select 1 from unnest($1) pm(t) where pm.t = p.ctid)
          ), grp as (
            select pt, count(*) filter (where hid) as nh, coalesce(array_agg(cv) filter (where not hid), '{}') as vis
            from sib group by pt having count(*) filter (where hid) >= 1
          ), need as (                                           -- remainder = distinct users of the parent outside every visible child of this set
            select g.pt from grp g where g.nh = 1 or (
              select count(distinct f.user_hash) from analytics_private.facts f join analytics_private.cube_stage p on p.ctid = g.pt
              where f.kind = p.kind and f.period = p.period %4$s and not (f.%5$s = any (g.vis))) < %3$s
          ), pick as (
            select distinct on (s.pt) s.ct from sib s join need n on n.pt = s.pt where not s.hid order by s.pt, s.users, s.ct
          )
          select array_agg(distinct ct) from pick $q$, a, v_on, v_min, v_fm, regexp_replace(a, '^[df]_', '')) into v_pick using v_marks;
        v_n := coalesce(cardinality(v_pick), 0);                 -- a pick is never already marked, so these are all new marks
        v_marks := v_marks || coalesce(v_pick, '{}'::tid[]);
        v_new := v_new + v_n;
      end loop;
      exit when v_new = 0;
    end loop;
    v_supp := cardinality(v_marks);
    delete from analytics_private.cube_stage s using unnest(v_marks) m(t) where m.t = s.ctid;

    -- LLD 5.3 steps 3 and 4: round to the nearest 5, keep users_floor, and count the rows that round to 0 as suppressed
    select v_supp + count(*) filter (where round(s.users / 5.0) * 5 = 0 or round(s.events / 5.0) * 5 = 0) into v_supp from analytics_private.cube_stage s;
    -- LLD 5.3 step 5: replace the published cube, then empty the staging and fact tables
    delete from analytics.cube;
    insert into analytics.cube (run_id, kind, period, d_category, d_colour_family, d_fit, d_brand, f_size, f_season, f_price_band, f_region, condition_band,
                                users_rounded, events_rounded, users_floor)
      select v_run, s.kind, s.period, s.d_category, s.d_colour_family, s.d_fit, s.d_brand, s.f_size, s.f_season, s.f_price_band, s.f_region, s.condition_band,
             (round(s.users / 5.0) * 5)::int, (round(s.events / 5.0) * 5)::int, (floor(s.users / 5.0) * 5)::int
      from analytics_private.cube_stage s
      where round(s.users / 5.0) * 5 > 0 and round(s.events / 5.0) * 5 > 0;
    truncate analytics_private.cube_stage;
    truncate analytics_private.facts;
    update ops.aggregate_runs set status = 'ok', finished_at = clock_timestamp(), users_included = v_users, items_included = v_items, rows_suppressed = v_supp,
      duration_ms = (extract(epoch from clock_timestamp() - v_start) * 1000)::int where id = v_run;
  exception when others then
    -- the subtransaction is rolled back: the previous cube and the fact tables are as they were. Only a fixed code is kept, never the message text.
    v_code := case when sqlerrm in ('invalid_min_group_size', 'suppression_did_not_converge', 'invalid_salt') then sqlerrm else 'run_failed' end;
    truncate analytics_private.cube_stage;
    truncate analytics_private.facts;
    update ops.aggregate_runs set status = 'error', error_code = v_code, finished_at = clock_timestamp(),
      duration_ms = (extract(epoch from clock_timestamp() - v_start) * 1000)::int where id = v_run;
  end;
  return v_run;
end $$;

-- ---- helpers -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
create temp table refc as select kind, period, d_category, d_colour_family, d_fit, d_brand, f_size, f_season, f_price_band, f_region, condition_band, users_rounded, events_rounded, users_floor from analytics.cube with no data;
create temp table newc (like refc);
create temp table eqlog (n serial, label text, status text, cube_rows bigint, suppressed int, complementary bigint);
create function pg_temp.uid(p_tag text, g int) returns uuid language sql immutable as $f$ select md5('wo0177:' || p_tag || ':' || g)::uuid $f$;
create function pg_temp.clear() returns void language sql as $f$ delete from auth.users where email like '%@example.test' $f$;
-- n eligible users of a tag (consent, terms and privacy accepted, age confirmed, country IN)
create function pg_temp.mk(p_tag text, p_n int) returns void language sql as $f$
  insert into auth.users (id, email) select pg_temp.uid(p_tag, g), pg_temp.uid(p_tag, g)::text || '@example.test' from generate_series(1, p_n) g;
  update app.profiles set country = 'IN', hemisphere = 'north', age_confirmed = true where id in (select pg_temp.uid(p_tag, g) from generate_series(1, p_n) g);
  insert into app.consent_records (user_id, notice_version) select pg_temp.uid(p_tag, g), '1' from generate_series(1, p_n) g;
  insert into app.document_acceptances (user_id, document, version) select pg_temp.uid(p_tag, g), d, '1' from generate_series(1, p_n) g, unnest(array['terms', 'privacy_policy']) d $f$;
-- WO-0099 test: a named segment, n users with one active item each (p_j: fit, brand, sys, size, cond; two = how many users own a second item)
create function pg_temp.seg(p_tag text, p_n int, p_sub text, p_rgb int[], p_j jsonb default '{}') returns void language plpgsql as $f$
begin
  perform pg_temp.mk(p_tag, p_n);
  insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, fit, brand, size_system, size_value, condition)
    select pg_temp.uid(p_tag, g), 'x', c.category, c.code, p_rgb[1], p_rgb[2], p_rgb[3], 'manual', p_j->>'fit', p_j->>'brand', p_j->>'sys', p_j->>'size', (p_j->>'cond')::smallint
    from generate_series(1, p_n) g cross join lateral generate_series(1, case when g <= coalesce((p_j->>'two')::int, 0) then 2 else 1 end) k
    join catalog.lk_sub_type c on c.code = p_sub;
end $f$;
-- WO-0110 test: one active Sports T-shirt (Activewear) for users p_from..p_to of a tag, in one colour
create function pg_temp.own(p_tag text, p_from int, p_to int, p_rgb int[]) returns void language sql as $f$
  insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin)
  select pg_temp.uid(p_tag, g), 'x', 'Activewear', 'Sports T-shirt', p_rgb[1], p_rgb[2], p_rgb[3], 'manual' from generate_series(p_from, p_to) g $f$;
create temp table colour (n text primary key, rgb int[]);
insert into colour values ('navy', '{0,0,139}'), ('blue', '{21,96,189}'), ('maroon', '{128,0,32}'), ('grey', '{192,192,192}'), ('black', '{0,0,0}'), ('red', '{255,0,0}');
create function pg_temp.col(n text) returns int[] language sql stable as $f$ select rgb from colour where colour.n = $1 $f$;
-- the cells under the minimum before any complementary suppression: the same grouping sets as the run (LLD 5.2), read from freshly built facts
create function pg_temp.initial_marks(p_min int) returns bigint language plpgsql as $f$
declare v_sets text; n bigint;
begin
  perform analytics_private.build_facts('wo0177-count');
  select string_agg('(' || concat_ws(', ', d, nullif(f, '')) || ')', ', ') into v_sets
    from unnest(array['category', 'colour_family', 'fit', 'brand', 'category, colour_family', 'category, fit', 'category, brand']) d cross join unnest(array['', 'size', 'season', 'price_band', 'region']) f;
  execute 'select count(*) from (select count(distinct user_hash) u from analytics_private.facts group by kind, period, grouping sets (' || v_sets || ')) q where u < ' || p_min into n;
  n := n + (select count(*) from (select count(distinct user_hash) u from analytics_private.facts where kind = 'owned' and condition_band <> 'Unrated' group by period, category, condition_band) q where u < p_min);
  truncate analytics_private.facts;
  return n;
end $f$;
-- Run the reference, keep its cube, run the function in the database on the same data, keep that cube; 'same' only when the cubes are equal as multisets of whole rows and the run rows agree.
create function pg_temp.same(p_label text) returns text language plpgsql as $f$
declare r bigint; n bigint; sr text; sn text; a bigint; b bigint; v_min int; v_init bigint; v_rows bigint; v_supp int;
begin
  select value::int into v_min from ops.settings where key = 'min_group_size' and value ~ '^[0-9]+$';
  v_init := case when v_min > 0 then pg_temp.initial_marks(v_min) end;
  r := pg_temp.ref_run_aggregation();
  delete from pg_temp.refc;
  insert into pg_temp.refc select kind, period, d_category, d_colour_family, d_fit, d_brand, f_size, f_season, f_price_band, f_region, condition_band, users_rounded, events_rounded, users_floor from analytics.cube;
  select status || '/' || coalesce(error_code, '-') || '/' || coalesce(users_included::text, '-') || '/' || coalesce(items_included::text, '-') || '/' || coalesce(rows_suppressed::text, '-'), rows_suppressed
    into sr, v_supp from ops.aggregate_runs where id = r;
  n := analytics.run_aggregation();
  delete from pg_temp.newc;
  insert into pg_temp.newc select kind, period, d_category, d_colour_family, d_fit, d_brand, f_size, f_season, f_price_band, f_region, condition_band, users_rounded, events_rounded, users_floor from analytics.cube;
  select status || '/' || coalesce(error_code, '-') || '/' || coalesce(users_included::text, '-') || '/' || coalesce(items_included::text, '-') || '/' || coalesce(rows_suppressed::text, '-')
    into sn from ops.aggregate_runs where id = n;
  select count(*) into a from (select * from pg_temp.refc except all select * from pg_temp.newc) q;
  select count(*) into b from (select * from pg_temp.newc except all select * from pg_temp.refc) q;
  select count(*) into v_rows from pg_temp.refc;
  insert into pg_temp.eqlog (label, status, cube_rows, suppressed, complementary) values (p_label, sr, v_rows, v_supp, v_supp - v_init);
  return case when a = 0 and b = 0 and sr = sn then 'same' else format('DIFFERENT: %s rows only in the reference, %s only in the new cube; run rows %s vs %s', a, b, sr, sn) end;
end $f$;
create function pg_temp.set_min(p int) returns void language sql as $f$ update ops.settings set value = p::text where key = 'min_group_size' $f$;

-- ======== 1. the WO-0099 cases (016): 9 and 10 users, the big scenario S1 and its neighbours, every minimum group size, failures ====================================================
select pg_temp.seg('n9', 9, 'T-shirt', pg_temp.col('navy'));
select is(pg_temp.same('016 segment of 9'), 'same', 'FR-80 segment of 9: the cubes are identical (nothing published)');
select pg_temp.clear();
select pg_temp.seg('n10', 10, 'T-shirt', pg_temp.col('navy'));
select is(pg_temp.same('016 segment of 10'), 'same', 'FR-80 segment of 10: the cubes are identical (35 groups published)');
select pg_temp.clear();
select pg_temp.seg('s1navy', 40, 'T-shirt', pg_temp.col('navy'));
select pg_temp.seg('s1blue', 10, 'T-shirt', pg_temp.col('blue'));
select pg_temp.seg('s1mar', 7, 'T-shirt', pg_temp.col('maroon'));
select pg_temp.seg('s1bot', 10, 'Jeans', pg_temp.col('black'));
select pg_temp.seg('s1out', 9, 'Jacket', pg_temp.col('grey'));
select pg_temp.seg('s1foot', 13, 'Sneakers', pg_temp.col('red'), '{"two":5}');
select pg_temp.seg('s1acc', 12, 'Watch', pg_temp.col('black'));
select pg_temp.seg('s1act', 12, 'Track pants', pg_temp.col('blue'));
select is(pg_temp.same('016 scenario S1'), 'same', 'S1 (cells, rounding, Unknown, chained suppression): the cubes are identical');
select pg_temp.seg('s1del', 4, 'T-shirt', pg_temp.col('maroon'));
select pg_temp.seg('s1nc', 4, 'T-shirt', pg_temp.col('maroon'));
select pg_temp.seg('s1ven', 5, 'T-shirt', pg_temp.col('maroon'));
update app.profiles set deleting = true where id in (select pg_temp.uid('s1del', g) from generate_series(1, 4) g);
delete from app.consent_records where user_id in (select pg_temp.uid('s1nc', g) from generate_series(1, 4) g);
update app.profiles set role = 'vendor' where id in (select pg_temp.uid('s1ven', g) from generate_series(1, 5) g);
select is(pg_temp.same('016 S1 with deleting, unconsented and vendor users'), 'same', 'S1 with users who left, never consented, and a vendor: the cubes are identical');
select pg_temp.set_min(7);
select is(pg_temp.same('016 min_group_size 7 (error)'), 'same', 'min_group_size 7: both end in error/invalid_min_group_size, the same run row');
select pg_temp.set_min(0);
select is(pg_temp.same('016 min_group_size 0 (error)'), 'same', 'min_group_size 0: both end in the same error');
select pg_temp.set_min(15);
select is(pg_temp.same('016 min_group_size 15'), 'same', 'min_group_size 15: the cubes are identical');
select pg_temp.set_min(50);
select is(pg_temp.same('016 S1 at min_group_size 50'), 'same', 'S1 at min_group_size 50 (BR-26 shipped value): the cubes are identical');
select pg_temp.set_min(5);
select is(pg_temp.same('016 S1 at min_group_size 5'), 'same', 'S1 at min_group_size 5: the cubes are identical');
select pg_temp.set_min(10);
select pg_temp.clear();
select pg_temp.seg('s3navy', 40, 'T-shirt', pg_temp.col('navy'));
select pg_temp.seg('s3blue', 11, 'T-shirt', pg_temp.col('blue'));
select pg_temp.seg('s3mar', 3, 'T-shirt', pg_temp.col('maroon'));
select pg_temp.seg('s3grey', 3, 'T-shirt', pg_temp.col('grey'));
select is(pg_temp.same('016 two hidden siblings under 10 together'), 'same', 'two hidden siblings of 6 users together hide a third: identical cubes');
select pg_temp.clear();
select pg_temp.seg('s4navy', 40, 'T-shirt', pg_temp.col('navy'));
select pg_temp.seg('s4blue', 11, 'T-shirt', pg_temp.col('blue'));
select pg_temp.seg('s4mar', 5, 'T-shirt', pg_temp.col('maroon'));
select pg_temp.seg('s4grey', 5, 'T-shirt', pg_temp.col('grey'));
select is(pg_temp.same('016 two hidden siblings of 10 together'), 'same', 'two hidden siblings of 10 users together hide no third: identical cubes');
select pg_temp.clear();
select pg_temp.seg('s8navy', 40, 'T-shirt', pg_temp.col('navy'));
select pg_temp.seg('s8bs', 12, 'T-shirt', pg_temp.col('blue'), '{"sys":"Letter","size":"S"}');
select pg_temp.seg('s8bm', 9, 'T-shirt', pg_temp.col('blue'), '{"sys":"Letter","size":"M"}');
select pg_temp.seg('s8mar', 7, 'T-shirt', pg_temp.col('maroon'));
select is(pg_temp.same('016 a suppressed cell is not itself a parent'), 'same', 'a cell hidden by suppression hides nothing more (size cells): identical cubes');
select pg_temp.clear();
select pg_temp.seg('s6s', 40, 'T-shirt', pg_temp.col('navy'), '{"sys":"Letter","size":"S"}');
select pg_temp.seg('s6m', 10, 'T-shirt', pg_temp.col('navy'), '{"sys":"Letter","size":"M"}');
select pg_temp.seg('s6l', 7, 'T-shirt', pg_temp.col('navy'), '{"sys":"Letter","size":"L"}');
select is(pg_temp.same('016 filter children (sizes)'), 'same', 'a hidden size hides the smallest visible size: identical cubes');
select pg_temp.clear();
select pg_temp.seg('s5a', 40, 'T-shirt', pg_temp.col('navy'), '{"cond":5}');
select pg_temp.seg('s5b', 10, 'T-shirt', pg_temp.col('navy'), '{"cond":20}');
select pg_temp.seg('s5c', 7, 'T-shirt', pg_temp.col('navy'), '{"cond":40}');
select is(pg_temp.same('016 condition bands'), 'same', 'condition bands are children of their category: identical cubes');
select pg_temp.clear();
select pg_temp.seg('s5u', 12, 'T-shirt', pg_temp.col('navy'), '{"cond":5}');
select pg_temp.seg('s5v', 12, 'T-shirt', pg_temp.col('navy'));
select is(pg_temp.same('016 unrated items beside rated ones'), 'same', 'unrated items left out of the bands but counted in the category: identical cubes');
select pg_temp.clear();
select pg_temp.set_min(50);
select pg_temp.seg('s7t', 45, 'T-shirt', pg_temp.col('navy'));
select pg_temp.seg('s7b', 50, 'Jeans', pg_temp.col('black'));
select is(pg_temp.same('016 min_group_size 50, 45 and 50 users'), 'same', 'min_group_size 50 with 45 and 50 users: identical cubes');
select pg_temp.set_min(10);
select pg_temp.clear();

-- ======== 2. the WO-0110 cases (020): the distinct-user remainder ================================================================================================================
select pg_temp.mk('blk', 20); select pg_temp.own('blk', 1, 20, '{0,0,0}');
select pg_temp.mk('ov', 5); select pg_temp.own('ov', 1, 5, '{0,0,139}'); select pg_temp.own('ov', 1, 5, '{255,0,0}');
select is(pg_temp.same('020 A: 20 black, 5 users with navy and red'), 'same', 'WO-0110 counter-example A (5 distinct users in the hidden cells): identical cubes');
select pg_temp.clear();
select pg_temp.mk('blk', 20); select pg_temp.own('blk', 1, 20, '{0,0,0}');
select pg_temp.mk('nv', 6); select pg_temp.own('nv', 1, 6, '{0,0,139}');
select pg_temp.mk('rd', 6); select pg_temp.own('rd', 1, 6, '{255,0,0}');
select is(pg_temp.same('020 B: black 20, navy 6 and red 6 on different users'), 'same', 'WO-0110 case B (12 distinct users in the hidden cells): identical cubes');
select pg_temp.clear();
select pg_temp.mk('blk', 20); select pg_temp.own('blk', 1, 20, '{0,0,0}');
select pg_temp.mk('mx', 9); select pg_temp.own('mx', 1, 6, '{0,0,139}'); select pg_temp.own('mx', 1, 3, '{255,0,0}'); select pg_temp.own('mx', 7, 9, '{255,0,0}');
select is(pg_temp.same('020 C: navy 6 and red 6 sharing 3 users'), 'same', 'WO-0110 case C (9 distinct users, 6 + 6 = 12): identical cubes');
select pg_temp.clear();
-- the 30 seeded random populations of the WO-0110 test
create temp table rr (seed int primary key, verdict text);
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
do $d$ begin
  for s in 1..30 loop
    perform pg_temp.pop(s);
    insert into rr (seed, verdict) values (s, pg_temp.same('020 random population ' || s));
    perform pg_temp.clear();
  end loop;
end $d$;
select is((select count(*) from rr), 30::bigint, 'the 30 seeded WO-0110 populations were built and run through both functions');
select is((select count(*) from rr where verdict <> 'same'), 0::bigint, 'the 30 WO-0110 random populations: every cube is identical');
select ok((select count(*) from eqlog where label like '020 random%' and complementary > 0) >= 20, 'and complementary suppression had work to do in at least 20 of those populations (not vacuous)');

-- ======== 3. the random fixtures of thousands of facts ===========================================================================================================================
-- p_users users in four countries (one unsupported), 2 to 13 items each, skewed over 14 sub types, 6 colours, 3 fits, 9 brand spellings, 4 sizes, 4 season sets, 6 prices and 6 condition scores;
-- 0 to 3 wishlist entries each; a purchase for about a third of the items, spread over six months. setseed fixes the data.
insert into catalog.lk_brand (code, label) values ('wo177-a', 'Arden Row'), ('wo177-b', 'Brook & Vale'), ('wo177-c', 'Cedar Lane'), ('wo177-d', 'Dune Works'), ('wo177-e', 'Elm Street')
  on conflict do nothing;
update ops.settings set value = 'IN,US,GB' where key = 'supported_countries';   -- FR stays unsupported: those users are ineligible
insert into catalog.country_region (country, region) values ('IN', 'South Asia'), ('US', 'North America'), ('GB', 'Europe') on conflict do nothing;
create function pg_temp.big(p_seed int, p_users int) returns void language plpgsql as $f$
begin
  perform setseed(p_seed / 100.0);
  perform pg_temp.mk('big', p_users);
  update app.profiles p set country = (array['FR', 'IN', 'US', 'GB'])[1 + (random() >= 0.6)::int + (random() >= 0.85)::int + (random() >= 0.95)::int] where p.id in (select pg_temp.uid('big', g) from generate_series(1, p_users) g);
  create temp table if not exists bigsub on commit drop as
    select c.code, c.category, row_number() over (order by c.code) rn from catalog.lk_sub_type c
    where c.code in ('T-shirt', 'Shirt', 'Jeans', 'Chinos', 'Jacket', 'Sneakers', 'Boots', 'Watch', 'Belt', 'Hoodie', 'Sweater', 'Kurta', 'Track pants', 'Cap');
  with raw as (
    select g, k, 1 + floor(power(random(), 1.8) * 14)::int sub, 1 + floor(power(random(), 2.0) * 6)::int colr, 1 + floor(power(random(), 1.5) * 3)::int fitn,
           1 + floor(power(random(), 1.6) * 10)::int brn, 1 + floor(power(random(), 1.4) * 5)::int szn, 1 + floor(random() * 4)::int seas, 1 + floor(power(random(), 1.2) * 6)::int prc,
           1 + floor(power(random(), 1.3) * 6)::int cnd
    from generate_series(1, p_users) g cross join lateral generate_series(1, 2 + floor(random() * 12)::int) k)
  insert into app.items (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, fit, brand, size_system, size_value, seasons, price, currency, condition)
    select pg_temp.oid('item', pg_temp.uid('big', r.g), r.k), pg_temp.uid('big', r.g), 'x', s.category, s.code,
           (array[0, 0, 255, 192, 0, 21])[r.colr], (array[0, 0, 0, 192, 128, 96])[r.colr], (array[0, 139, 0, 192, 0, 189])[r.colr], 'manual',
           (array['Slim', 'Regular', null])[r.fitn],
           (array['Arden Row', 'brook&vale', 'CEDAR  LANE', 'Dune Works', 'Elm Street', 'Zed Unlisted', 'Yarn Co', null, '', ' '])[r.brn],
           case when r.szn <= 4 then 'Letter' end, case when r.szn <= 4 then (array['S', 'M', 'L', 'XL'])[r.szn] end,
           (array['{Summer}', '{All year}', '{Spring,Summer}', '{Autumn,Winter}'])[r.seas]::text[],
           (array[null, 12, 40, 80, 150, 320])[r.prc], case when r.prc > 1 then 'USD' end, (array[null, 5, 20, 45, 70, 95])[r.cnd]::smallint
    from raw r join bigsub s on s.rn = r.sub;
  insert into app.wishlist_entries (user_id, name, category, sub_type, colour_r, colour_g, colour_b, fit, brand, size_system, size_value, seasons, target_price, currency, status, origin, created_at)
    select pg_temp.uid('big', g), 'w', s.category, s.code, 255, 0, 0, (array['Slim', null])[1 + floor(random() * 2)::int], (array['Arden Row', 'Cedar Lane', null])[1 + floor(random() * 3)::int],
           'Letter', (array['S', 'M'])[1 + floor(random() * 2)::int], '{Summer}', (array[20, 60, 120])[1 + floor(random() * 3)::int], 'USD',
           (array['open', 'open', 'bought'])[1 + floor(random() * 3)::int], 'user', timestamptz '2026-11-15' - (floor(random() * 150) || ' days')::interval
    from generate_series(1, p_users) g cross join lateral generate_series(1, floor(random() * 4)::int) k join bigsub s on s.rn = 1 + floor(power(random(), 1.8) * 14)::int;
  insert into app.purchases (user_id, item_id, purchase_date, price, currency, quantity)
    select i.user_id, i.id, date '2026-11-15' - floor(random() * 180)::int, 10 + floor(random() * 200), 'USD', 1 from app.items i
    where i.user_id in (select pg_temp.uid('big', g) from generate_series(1, p_users) g) and random() < 0.33;
end $f$;
create function pg_temp.fact_count() returns bigint language plpgsql as $f$ declare n bigint; begin n := analytics_private.build_facts('wo0177-count'); truncate analytics_private.facts; return n; end $f$;
select pg_temp.big(17, 650);
select ok(pg_temp.fact_count() >= 3000, 'fixture 1 holds at least 3000 facts (650 users)');
select is(pg_temp.same('fixture 1 (650 users) at 10'), 'same', 'fixture 1 at min_group_size 10: the cubes are identical row for row');
select ok((select cube_rows >= 300 and suppressed >= 200 and complementary >= 20 from eqlog where label = 'fixture 1 (650 users) at 10'), 'fixture 1 at 10 is not vacuous: 300+ published rows, 200+ suppressed, 20+ of them complementary');
select pg_temp.set_min(5);
select is(pg_temp.same('fixture 1 at 5'), 'same', 'fixture 1 at min_group_size 5: identical');
select pg_temp.set_min(15);
select is(pg_temp.same('fixture 1 at 15'), 'same', 'fixture 1 at min_group_size 15: identical');
select pg_temp.set_min(25);
select is(pg_temp.same('fixture 1 at 25'), 'same', 'fixture 1 at min_group_size 25: identical');
select pg_temp.set_min(50);
select is(pg_temp.same('fixture 1 at 50'), 'same', 'fixture 1 at min_group_size 50 (the shipped value): identical');
select ok((select complementary > 0 from eqlog where label = 'fixture 1 at 50'), 'fixture 1 at 50 has complementary suppression too');
select pg_temp.set_min(10);
select pg_temp.clear();
select pg_temp.big(29, 300);
select ok(pg_temp.fact_count() >= 1500, 'fixture 2 holds at least 1500 facts (300 users)');
select is(pg_temp.same('fixture 2 (300 users) at 10'), 'same', 'fixture 2 at min_group_size 10: identical');
select pg_temp.set_min(5);
select is(pg_temp.same('fixture 2 at 5'), 'same', 'fixture 2 at min_group_size 5: identical');
select pg_temp.set_min(20);
select is(pg_temp.same('fixture 2 at 20'), 'same', 'fixture 2 at min_group_size 20: identical');
select pg_temp.set_min(10);
select pg_temp.clear();
-- the reference itself is stable: two runs of the old body on the same data agree (ties between equal siblings are broken by physical order, which must not depend on the run)
select pg_temp.big(17, 650);
select pg_temp.ref_run_aggregation();
create temp table once as select * from analytics.cube;
select pg_temp.ref_run_aggregation();
select is((select count(*) from (select kind, period, d_category, d_colour_family, d_fit, d_brand, f_size, f_season, f_price_band, f_region, condition_band, users_rounded, events_rounded, users_floor from once
  except all select kind, period, d_category, d_colour_family, d_fit, d_brand, f_size, f_season, f_price_band, f_region, condition_band, users_rounded, events_rounded, users_floor from analytics.cube) q), 0::bigint,
  'the reference is deterministic: two runs on the same data give the same cube');
select pg_temp.clear();

-- ======== 4. totals, and what was compared ==========================================================================================================================================
select ok((select count(*) from eqlog) >= 55, 'at least 55 comparisons were made and logged');
select ok((select sum(cube_rows) from eqlog) >= 10000, 'in all, 10000+ cube rows were compared row for row');
select diag(format('%s | %s | cube rows %s | suppressed %s | complementary %s', label, status, cube_rows, suppressed, complementary)) from eqlog where label not like '020 random%' order by n;
select diag(format('020 random populations: %s runs, %s cube rows, %s suppressed, %s complementary', count(*), sum(cube_rows), sum(suppressed), sum(complementary))) from eqlog where label like '020 random%';
select * from finish();
rollback;
