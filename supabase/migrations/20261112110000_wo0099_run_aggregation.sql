-- WO-0099 (R7a) migration 1: analytics.run_aggregation() implements LLD 5.1 to 5.3 (FR-80, FR-82, FR-83, FR-84, FR-86, FR-87, FR-63, FR-64; BR-26, BR-27, BR-33).
-- Security definer, owned by the migration role, search_path = '' (every name schema-qualified). Execute is revoked from public, anon, authenticated and
-- service_role, so only pg_cron or an admin in the SQL editor can run it. No caller input exists: the grouping sets are generated from fixed arrays.
-- Decisions where the documents are silent (see workflow/evidence/R7/WO-0099-NOTES.md):
--  * An error inside the run (including a min_group_size that is not a positive multiple of 5) is caught in an inner block, recorded on the run row with a
--    fixed code, and the function RETURNS the run id: re-raising would roll back the audit row (R7.md Document points). The previous cube is kept because
--    the inner block is a subtransaction. 'aggregation_running' is raised (no run row is written) because nothing ran.
--  * The hidden flags live in a temp table of row ids (cube_stage has no flag column and its columns are pinned by test 015).
create function analytics.run_aggregation() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  c_lock constant bigint := 7099001;                         -- advisory lock key of the aggregation run
  v_dims constant text[] := array['category', 'colour_family', 'fit', 'brand', 'category, colour_family', 'category, fit', 'category, brand'];
  v_filters constant text[] := array['', 'size', 'season', 'price_band', 'region'];
  v_attrs constant text[] := array['d_category', 'd_colour_family', 'd_fit', 'd_brand', 'f_size', 'f_season', 'f_price_band', 'f_region', 'condition_band'];
  v_start timestamptz := clock_timestamp();
  v_run bigint; v_salt text; v_min int; v_users int; v_items int; v_supp int; v_pass int := 0; v_new int; v_n int;
  v_sets text; v_on text; v_code text; a text; y text;
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
    drop table if exists pg_temp.run_marks;
    create temp table run_marks (t tid primary key);
    insert into pg_temp.run_marks select s.ctid from analytics_private.cube_stage s where s.users < v_min;

    -- LLD 5.3 step 2: complementary suppression. A child of a row has the same kind and period and the row's attributes plus exactly one more (a filter
    -- value, a finer dimension group or a condition band); each added attribute gives its own set of siblings. Repeat until no row is newly marked.
    loop
      v_pass := v_pass + 1;
      if v_pass > 1000 then raise exception 'suppression_did_not_converge'; end if;
      v_new := 0;
      foreach a in array v_attrs loop
        v_on := 'p.kind = c.kind and p.period = c.period';
        foreach y in array v_attrs loop
          if y <> a then v_on := v_on || format(' and coalesce(p.%1$s, chr(1)) = coalesce(c.%1$s, chr(1))', y); end if;
        end loop;
        execute format($q$
          with sib as (
            select p.ctid as pt, c.ctid as ct, c.users, (m.t is not null) as hid
            from analytics_private.cube_stage p
            join analytics_private.cube_stage c on c.%1$s is not null and p.%1$s is null and %2$s
            left join pg_temp.run_marks m on m.t = c.ctid
            where not exists (select 1 from pg_temp.run_marks pm where pm.t = p.ctid)
          ), need as (
            select pt from sib group by pt
            having count(*) filter (where hid) >= 1 and (count(*) filter (where hid) = 1 or sum(users) filter (where hid) < %3$s)
          ), pick as (
            select distinct on (s.pt) s.ct from sib s join need n on n.pt = s.pt where not s.hid order by s.pt, s.users, s.ct
          )
          insert into pg_temp.run_marks select ct from pick on conflict do nothing $q$, a, v_on, v_min);
        get diagnostics v_n = row_count;
        v_new := v_new + v_n;
      end loop;
      exit when v_new = 0;
    end loop;
    select count(*) into v_supp from pg_temp.run_marks;
    delete from analytics_private.cube_stage s using pg_temp.run_marks m where m.t = s.ctid;
    drop table pg_temp.run_marks;

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
revoke execute on function analytics.run_aggregation() from public, anon, authenticated, service_role;
