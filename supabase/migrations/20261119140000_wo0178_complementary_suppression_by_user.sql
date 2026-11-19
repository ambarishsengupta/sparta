-- WO-0178 (R8b) migration 1: analytics.run_aggregation() no longer lets a reader recover a hidden count by subtraction (privacy defect found by the WO-0177 privacy review; LLD 5.3 step 2
-- "so that no hidden value can be recovered by subtracting from the parent", FR-82). The output changes on purpose, in two places; k, rounding, grants, security definer, search_path = ''
-- and the WO-0177 method (set-based, parent/user/value sets read once, only dirty parents evaluated again) are unchanged.
-- Leak 1 (the remainder): the remainder counted the distinct users of the parent with ANY fact outside the visible children of the set, so a user who also has a fact in a visible child was
-- counted, and the remainder looked larger than what subtraction reveals (13 users, min 10: u1-u10 black Activewear, u1-u7 also red, u11-u13 navy only: Activewear 15 minus Black 10 gives
-- the 3 navy-only users). The remainder is now the number of distinct users of the parent who have NO fact in any visible child of the set (the parent minus the union of the visible
-- children); a user whose facts carry no value of the attribute is in no child and is counted. When it is under min_group_size the smallest visible child (fewest users, then physical order,
-- as before) is hidden too. The 'only one hidden child' trigger is unchanged.
-- Leak 1b (the complement of the condition bands): the condition bands of a category do not cover its users, because unrated items have no band row (LLD 5.2). With every band visible, the
-- users of the category with no band (no rated item) are a count a reader can recover by subtraction (WO-0178's own per-user check found 5 to 8 such users under Tops in 6 of the 30 seeded
-- populations of test 020). The bands of a category are therefore evaluated once from the start, whether or not a band is hidden: a remainder of 1 to min_group_size - 1 users (0 is a
-- partition, nothing to recover) hides the smallest visible band. This is the only attribute with such a complement (every fact column of the other attributes is not null, 'Unknown' is a row).
-- Leak 2 (the missing total): the cube has no all-null row, so the single-dimension sibling sets (category, colour, fit, brand on their own) had no parent and were never protected, while the
-- total of the cohort is published through coverage() (and rows such as fit = Unknown equal it): WO-0110 example A, colour Black 20 and Activewear 25, recovered 5 by 25 - 20. Step 2 now stages
-- one total row per kind and period (the grouping set (), all attributes null) as a parent of the single-dimension rows. It is a working row only: it is deleted before rounding and
-- publishing, so it is never in analytics.cube, and it is NOT counted in ops.aggregate_runs.rows_suppressed (that column counts published-cube rows that were hidden, as before). A total
-- that is itself under min_group_size is marked in step 1 like any cell, and, being marked, is not looked at as a parent (all its children are under the minimum too).

create or replace function analytics.run_aggregation() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  c_lock constant bigint := 7099001;                         -- advisory lock key of the aggregation run
  v_dims constant text[] := array['category', 'colour_family', 'fit', 'brand', 'category, colour_family', 'category, fit', 'category, brand'];
  v_filters constant text[] := array['', 'size', 'season', 'price_band', 'region'];
  v_attrs constant text[] := array['d_category', 'd_colour_family', 'd_fit', 'd_brand', 'f_size', 'f_season', 'f_price_band', 'f_region', 'condition_band'];
  v_start timestamptz := clock_timestamp();
  v_run bigint; v_salt text; v_min int; v_users int; v_items int; v_supp int; v_pass int := 0; v_new int; v_n int; v_pick int[];
  v_sets text; v_on text; v_mx text; v_eq text; v_code text; v_a text; y text; v_k int; v_mask text; v_masks text[];
  v_mxs text[] := '{}'::text[];
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
    truncate analytics_private.supp_cell, analytics_private.supp_sib, analytics_private.supp_par, analytics_private.supp_pu;
    select string_agg('(' || concat_ws(', ', d, nullif(f, '')) || ')', ', ') into v_sets from unnest(v_dims) d cross join unnest(v_filters) f;
    execute 'insert into analytics_private.cube_stage (kind, period, d_category, d_colour_family, d_fit, d_brand, f_size, f_season, f_price_band, f_region, users, events) '
      || 'select kind, period, category, colour_family, fit, brand, size, season, price_band, region, count(distinct user_hash), count(*) '
      || 'from analytics_private.facts group by kind, period, grouping sets (' || v_sets || ')';
    insert into analytics_private.cube_stage (kind, period, d_category, condition_band, users, events)
      select 'owned', f.period, f.category, f.condition_band, count(distinct f.user_hash), count(*)
      from analytics_private.facts f where f.kind = 'owned' and f.condition_band <> 'Unrated' group by f.period, f.category, f.condition_band;
    -- WO-0178: the total of each kind and period (all attributes null), a parent of the single-dimension rows in step 2 only; deleted again before rounding, never published
    insert into analytics_private.cube_stage (kind, period, users, events)
      select f.kind, f.period, count(distinct f.user_hash), count(*) from analytics_private.facts f group by f.kind, f.period;

    -- LLD 5.3 step 1: mark rows under the minimum group size. The cells are copied once, numbered in physical order (the order that breaks ties between equal siblings).
    insert into analytics_private.supp_cell (cid, t, kind, period, d_category, d_colour_family, d_fit, d_brand, f_size, f_season, f_price_band, f_region, condition_band, users, hid)
      select (row_number() over (order by s.ctid))::int, s.ctid, s.kind, s.period, s.d_category, s.d_colour_family, s.d_fit, s.d_brand, s.f_size, s.f_season, s.f_price_band, s.f_region,
             s.condition_band, s.users, s.users < v_min
      from analytics_private.cube_stage s;

    -- The parent/child pairs of every attribute, found once. A child has the same kind and period and the parent's attributes plus exactly one more (a filter value, a finer
    -- dimension group or a condition band); the parent's other attributes are equal, nulls included, so the join is an equality join.
    for v_ai in 1 .. cardinality(v_attrs) loop
      v_a := v_attrs[v_ai];
      v_on := 'p.kind = c.kind and p.period = c.period';
      v_mx := '';                                                -- the parent's null pattern over the other attributes, as a text of 0 and 1
      foreach y in array v_attrs loop
        if y <> v_a then
          v_on := v_on || format(' and coalesce(p.%1$s, chr(1)) = coalesce(c.%1$s, chr(1))', y);
          v_mx := v_mx || case when v_mx = '' then '' else ' || ' end || format('(case when p.%1$s is null then ''0'' else ''1'' end)', y);
        end if;
      end loop;
      v_mxs := v_mxs || v_mx;
      execute format('insert into analytics_private.supp_sib (a, pid, cid, cv) select %1$s, p.cid, c.cid, c.%2$s from analytics_private.supp_cell p '
        || 'join analytics_private.supp_cell c on c.%2$s is not null and p.%2$s is null and %3$s', v_ai, v_a, v_on);
    end loop;
    insert into analytics_private.supp_par (a, pid, dirty)
      select s.a, s.pid, bool_or(c.hid) or s.a = cardinality(v_attrs) from analytics_private.supp_sib s join analytics_private.supp_cell c on c.cid = s.cid group by s.a, s.pid;
    analyze analytics_private.supp_cell;
    analyze analytics_private.supp_sib;
    analyze analytics_private.supp_par;

    -- LLD 5.3 step 2: complementary suppression. Repeat until no row is newly marked.
    loop
      v_pass := v_pass + 1;
      if v_pass > 1000 then raise exception 'suppression_did_not_converge'; end if;
      v_new := 0;
      for v_ai in 1 .. cardinality(v_attrs) loop
        v_a := v_attrs[v_ai];
        -- the parents to look at: unmarked parents with a child hidden since they were last looked at; and how many children of each are hidden now
        update analytics_private.supp_par sp set ev = true, dirty = false
          from analytics_private.supp_cell p where sp.a = v_ai and sp.dirty and p.cid = sp.pid and not p.hid;
        update analytics_private.supp_par sp set nh = q.n::int
          from (select s.pid, count(*)::int as n from analytics_private.supp_sib s join analytics_private.supp_cell c on c.cid = s.cid
                where s.a = v_ai and c.hid and s.pid in (select e.pid from analytics_private.supp_par e where e.a = v_ai and e.ev) group by s.pid) q
          where sp.a = v_ai and sp.ev and sp.pid = q.pid;
        -- parents with two or more hidden children need the remainder in distinct users: read their (user, child value) pairs from the facts, once, per null pattern
        execute format('select coalesce(array_agg(distinct %1$s), ''{}'') from analytics_private.supp_par sp join analytics_private.supp_cell p on p.cid = sp.pid '
          || 'where sp.a = %2$s and sp.ev and sp.nh <> 1 and not sp.loaded', v_mxs[v_ai], v_ai) into v_masks;
        foreach v_mask in array v_masks loop
          v_eq := ''; v_k := 0;
          foreach y in array v_attrs loop
            if y <> v_a then
              v_k := v_k + 1;
              if substr(v_mask, v_k, 1) = '1' then
                v_eq := v_eq || format(' and f.%1$s = p.%2$s', regexp_replace(y, '^[df]_', ''), y);      -- fact column = name without d_ or f_
              end if;
            end if;
          end loop;
          execute format('insert into analytics_private.supp_pu (a, pid, u, cv) select %1$s, p.cid, f.user_hash, f.%2$s '
            || 'from analytics_private.supp_par sp join analytics_private.supp_cell p on p.cid = sp.pid '
            || 'join analytics_private.facts f on f.kind = p.kind and f.period = p.period%3$s '
            || 'where sp.a = %1$s and sp.ev and sp.nh <> 1 and not sp.loaded and %4$s = %5$L group by p.cid, f.user_hash, f.%2$s',
            v_ai, regexp_replace(v_a, '^[df]_', ''), v_eq, v_mxs[v_ai], v_mask);
        end loop;
        if cardinality(v_masks) > 0 then
          update analytics_private.supp_par sp set loaded = true where sp.a = v_ai and sp.ev and sp.nh <> 1 and not sp.loaded;
          analyze analytics_private.supp_pu;
        end if;
        -- need: one hidden child, or fewer than min distinct users of the parent with NO fact in any visible child of this set (WO-0178: the parent minus the union of the visible children;
        -- a user is counted once, whatever else they own). pick: the smallest visible child (fewest users, then physical order) of each such parent.
        select array_agg(x.cid) into v_pick from (
          select distinct on (s.pid) s.cid
          from analytics_private.supp_par sp
          join analytics_private.supp_sib s on s.a = sp.a and s.pid = sp.pid
          join analytics_private.supp_cell c on c.cid = s.cid and not c.hid
          where sp.a = v_ai and sp.ev and (sp.nh = 1 or (
            select count(*) from (
              select pu.u from analytics_private.supp_pu pu
              left join (analytics_private.supp_sib vs join analytics_private.supp_cell vc on vc.cid = vs.cid and not vc.hid)
                on vs.a = pu.a and vs.pid = pu.pid and vs.cv = pu.cv
              where pu.a = sp.a and pu.pid = sp.pid
              group by pu.u having count(vs.cid) = 0) q) between case when sp.nh = 0 then 1 else 0 end and v_min - 1)
          order by s.pid, c.users, s.cid) x;
        update analytics_private.supp_par sp set ev = false where sp.a = v_ai and sp.ev;
        v_n := coalesce(cardinality(v_pick), 0);                 -- a pick is never already marked, so these are all new marks
        if v_n > 0 then
          update analytics_private.supp_cell set hid = true where cid = any (v_pick);
          update analytics_private.supp_par sp set dirty = true
            from analytics_private.supp_sib s where s.cid = any (v_pick) and sp.a = s.a and sp.pid = s.pid;
        end if;
        v_new := v_new + v_n;
      end loop;
      exit when v_new = 0;
    end loop;
    -- the total rows are working rows: not counted as suppressed, and removed from the staging before rounding
    select count(*)::int into v_supp from analytics_private.supp_cell
      where hid and num_nonnulls(d_category, d_colour_family, d_fit, d_brand, f_size, f_season, f_price_band, f_region, condition_band) > 0;
    delete from analytics_private.cube_stage s using analytics_private.supp_cell m where m.hid and m.t = s.ctid;
    delete from analytics_private.cube_stage s
      where num_nonnulls(s.d_category, s.d_colour_family, s.d_fit, s.d_brand, s.f_size, s.f_season, s.f_price_band, s.f_region, s.condition_band) = 0;
    truncate analytics_private.supp_cell, analytics_private.supp_sib, analytics_private.supp_par, analytics_private.supp_pu;

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
    truncate analytics_private.supp_cell, analytics_private.supp_sib, analytics_private.supp_par, analytics_private.supp_pu;
    truncate analytics_private.facts;
    update ops.aggregate_runs set status = 'error', error_code = v_code, finished_at = clock_timestamp(),
      duration_ms = (extract(epoch from clock_timestamp() - v_start) * 1000)::int where id = v_run;
  end;
  return v_run;
end $$;
revoke execute on function analytics.run_aggregation() from public, anon, authenticated, service_role;
