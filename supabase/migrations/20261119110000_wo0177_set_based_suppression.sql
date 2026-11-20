-- WO-0177 (R8b) migration 1: analytics.run_aggregation() finishes at pilot scale. The OUTPUT is unchanged, row for row; only the way LLD 5.3 step 2 is computed changes.
-- Defect (WO-0165 load check, measured): at 500 users and 50,000 items the old complementary-suppression loop ran, for every parent with two or more hidden children and for every
-- attribute on every pass, a correlated count(distinct user_hash) over the whole of analytics_private.facts (no index, non-equality tests), and did not finish in 9.5 minutes.
-- New method, same rule: the cells of the staging table are copied once to a working table with a number in physical (ctid) order, which keeps the choice of the smallest
-- sibling (fewest users, then physical order) exactly; for each attribute the parent/child pairs are found once by an equality join; the (parent, user, child value) sets are read
-- from the facts once per parent, by an equality join per grouping set of the parent, and only for a parent that has two or more hidden children, and are kept for all passes (facts
-- do not change during a run); on each step only the parents whose children were newly hidden since the parent was last looked at are evaluated again (a parent's outcome depends on
-- nothing else, and marks only ever grow). Unchanged: grants, security definer, search_path = '', the WO-0110 remainder (distinct users of the parent with a fact outside every
-- visible child of the sibling set), the 'only one hidden child' trigger, the order of the attributes within a pass (each attribute sees the marks of the ones before it), the
-- pass count and the result. The working tables are private, like cube_stage: deny by default, emptied at the end of every run and when a run fails.

create table analytics_private.supp_cell (            -- one row per staged cell; cid follows the physical order of cube_stage, t is its ctid
  cid int primary key, t tid not null,
  kind text not null, period date not null,
  d_category text, d_colour_family text, d_fit text, d_brand text,
  f_size text, f_season text, f_price_band text, f_region text,
  condition_band text,
  users int not null, hid boolean not null
);
create table analytics_private.supp_sib (             -- a = attribute number, pid = the parent, cid = a child that adds that attribute, cv = the child's value of it
  a smallint not null, pid int not null, cid int not null, cv text not null,
  primary key (a, cid)
);
create index supp_sib_parent on analytics_private.supp_sib (a, pid);
create table analytics_private.supp_par (             -- the parents of an attribute and what is known about them
  a smallint not null, pid int not null,
  dirty boolean not null,                              -- a child was hidden since the parent was last evaluated
  ev boolean not null default false,                   -- being evaluated in the current step
  nh int not null default 0,                           -- hidden children in the current step
  loaded boolean not null default false,               -- supp_pu holds this parent's (user, child value) pairs
  primary key (a, pid)
);
create table analytics_private.supp_pu (              -- distinct (user, value of the attribute) of the facts of a parent
  a smallint not null, pid int not null, u text not null, cv text
);
create index supp_pu_parent on analytics_private.supp_pu (a, pid);

alter table analytics_private.supp_cell enable row level security;
alter table analytics_private.supp_cell force row level security;
alter table analytics_private.supp_sib enable row level security;
alter table analytics_private.supp_sib force row level security;
alter table analytics_private.supp_par enable row level security;
alter table analytics_private.supp_par force row level security;
alter table analytics_private.supp_pu enable row level security;
alter table analytics_private.supp_pu force row level security;
revoke all on analytics_private.supp_cell, analytics_private.supp_sib, analytics_private.supp_par, analytics_private.supp_pu from public, anon, authenticated, service_role;

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
      select s.a, s.pid, bool_or(c.hid) from analytics_private.supp_sib s join analytics_private.supp_cell c on c.cid = s.cid group by s.a, s.pid;
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
          || 'where sp.a = %2$s and sp.ev and sp.nh >= 2 and not sp.loaded', v_mxs[v_ai], v_ai) into v_masks;
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
            || 'where sp.a = %1$s and sp.ev and sp.nh >= 2 and not sp.loaded and %4$s = %5$L group by p.cid, f.user_hash, f.%2$s',
            v_ai, regexp_replace(v_a, '^[df]_', ''), v_eq, v_mxs[v_ai], v_mask);
        end loop;
        if cardinality(v_masks) > 0 then
          update analytics_private.supp_par sp set loaded = true where sp.a = v_ai and sp.ev and sp.nh >= 2 and not sp.loaded;
          analyze analytics_private.supp_pu;
        end if;
        -- need: one hidden child, or fewer than min distinct users of the parent with a fact outside every visible child of this set (a fact with no value counts only
        -- when no child is visible). pick: the smallest visible child (fewest users, then physical order) of each such parent.
        select array_agg(x.cid) into v_pick from (
          select distinct on (s.pid) s.cid
          from analytics_private.supp_par sp
          join analytics_private.supp_sib s on s.a = sp.a and s.pid = sp.pid
          join analytics_private.supp_cell c on c.cid = s.cid and not c.hid
          where sp.a = v_ai and sp.ev and (sp.nh = 1 or (
            select count(distinct pu.u) from analytics_private.supp_pu pu
            where pu.a = sp.a and pu.pid = sp.pid and not exists (
              select 1 from analytics_private.supp_sib vs join analytics_private.supp_cell vc on vc.cid = vs.cid and not vc.hid
              where vs.a = pu.a and vs.pid = pu.pid and (pu.cv is null or vs.cv = pu.cv))) < v_min)
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
    select count(*)::int into v_supp from analytics_private.supp_cell where hid;
    delete from analytics_private.cube_stage s using analytics_private.supp_cell m where m.hid and m.t = s.ctid;
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
