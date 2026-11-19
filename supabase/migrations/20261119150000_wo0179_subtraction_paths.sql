-- WO-0179 (R8b) migration 1: the subtraction paths WO-0178 left open in analytics.run_aggregation() (privacy review of WO-0178, LLD 5.3 step 2, FR-82). k, rounding, grants, security definer,
-- search_path = '' and the WO-0177 method (set-based, parent/user/value sets read once, only dirty parents evaluated again) are unchanged; the output changes on purpose in three places.
-- (0) The trigger. WO-0178 hid one more child also when the remainder was 0 and a child was hidden. A category every user owns (Tops) then made the total's remainder 0 and hid every category
--     row in turn, although nobody sits outside it. The rule is now the reviewer's variant Z: after a first hidden child, hide the smallest visible child when (a) the remainder, the distinct users of
--     the parent with NO fact in any visible child, is 1 to min_group_size - 1 (0 is a partition, nothing to recover), or (b) the facts of the parent outside the visible children (what parent events
--     minus child events leave) belong to 1 to min_group_size - 1 distinct users. (b) is the old "hidden children together hold fewer than min_group_size users" test, now also applied when no
--     child is hidden (see 2). The 'only one hidden child' trigger and the choice of the smallest sibling are unchanged.
-- (1) The cohort. ops.aggregate_runs.users_included, which coverage() publishes, counted the users of ALL kinds (an owner, a wishlist-only user, a purchaser). No published row partitions that
--     number (the rows of different kinds are separate sets), so cohort minus an owned total revealed 1 to k-1 users with no owned item. users_included is now the number of distinct users with an
--     owned fact, the same population as items_included: the owned total of the run (one period), the total row that step 2 already protects as a parent of the single-dimension rows. Why not make
--     the cohort a parent of the per-kind totals: the equality join of the set-based method is per kind and period, a cross-kind parent would need a second method, and the owned total is what the
--     dashboard header means by "users in this view".
-- (2) The band events. The condition bands of a category do not cover its facts: unrated items have no band row (LLD 5.2). With every band visible and nobody outside the bands (remainder 0),
--     category events minus band events still reveal the unrated items, owned by fewer than min_group_size users. Rule (b) above is evaluated for the band sets from the start, whether or
--     not a band is hidden: when the users owning an unrated item number 1 to min_group_size - 1, the smallest visible band is hidden. No other attribute has facts outside its children.

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
    select count(distinct f.user_hash) filter (where f.kind = 'owned'), count(*) filter (where f.kind = 'owned') into v_users, v_items from analytics_private.facts f;   -- WO-0179: the owned total, not the cohort of all kinds

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
        -- need: one hidden child, or 1 to min-1 distinct users of the parent with NO fact in any visible child (the parent minus the union of the visible children), or 1 to min-1 distinct users owning
        -- the facts of the parent outside the visible children (WO-0179: variant Z, and the band events; a user is counted once, whatever else they own). pick: the smallest visible child (fewest users, then physical order) of each such parent.
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
              group by pu.u having count(vs.cid) = 0) q) between 1 and v_min - 1
            or (select count(distinct pu.u) from analytics_private.supp_pu pu where pu.a = sp.a and pu.pid = sp.pid and not exists (
              select 1 from analytics_private.supp_sib vs join analytics_private.supp_cell vc on vc.cid = vs.cid and not vc.hid
              where vs.a = pu.a and vs.pid = pu.pid and vs.cv = pu.cv)) between 1 and v_min - 1)
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
