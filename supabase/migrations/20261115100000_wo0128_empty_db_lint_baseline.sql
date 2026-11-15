-- WO-0128 (audit finding A10): empty the database lint baseline. New migration only; applied migrations are untouched.
-- 1. The five colour helpers of 20261105095807 pin an empty search_path. Every name they use is already schema-qualified (catalog.*), and the built-in
--    functions and operators they call (power, cbrt, to_hex, lpad, upper, ||) live in pg_catalog, which is always searched, so the bodies do not change.
--    ALTER FUNCTION keeps the signatures, volatility, strictness, owner and grants exactly as they are.
-- 2. app.confirm_receipt: the two uuid[] variables are initialised with an explicit cast ('{}'::uuid[]). The text is the WO-0092 body with that one change.
-- 3. analytics.run_aggregation: the run's suppression marks live in a tid[] variable instead of a temporary table, which the static check could not see.
--    The text is the WO-0110 body with the marks changed; the rows, the suppression and the rounding are the same.
alter function catalog.srgb_lin(float8) set search_path = '';
alter function catalog.rgb_to_lab(int, int, int) set search_path = '';
alter function catalog.colour_family(int, int, int) set search_path = '';
alter function catalog.rgb_hex(int, int, int) set search_path = '';
alter function catalog.set_colour_fields() set search_path = '';

create or replace function app.confirm_receipt(p_job_id bigint, p_lines jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  j app.jobs;
  r app.receipts;
  ln jsonb;
  v_action text; v_cat uuid; v_qty int; v_amount numeric; v_item uuid; v_pur uuid;
  v_def_store text; v_def_date date; v_def_cur text;
  v_store text; v_date date; v_cur text;
  v_h_store text; v_h_date date; v_h_cur text; v_first boolean := true;
  v_total numeric := 0; v_items uuid[] := '{}'::uuid[]; v_purs uuid[] := '{}'::uuid[];
  -- a skip line may carry the line keys, the item keys and `text` (the draft's printed text); nothing else
  v_skip_keys constant text[] := array['action', 'qty', 'amount', 'catalog_item_id', 'store', 'date', 'currency', 'text',
    'name', 'category', 'sub_type', 'colour_r', 'colour_g', 'colour_b', 'brand', 'fit', 'material', 'pattern', 'size_system', 'size_value',
    'seasons', 'occasions', 'condition'];
begin
  select x.* into j from app.jobs x where x.id = p_job_id and x.user_id = (select auth.uid()) and x.type = 'receipt';
  if not found then
    raise exception 'job_not_found';
  end if;
  if j.status <> 'done' then
    raise exception 'job_not_done';
  end if;
  select x.* into r from app.receipts x where x.user_id = (select auth.uid()) and x.storage_path = j.input ->> 'path' for update;
  if not found then
    raise exception 'receipt_not_found';
  end if;
  if r.confirmed_at is not null then
    raise exception 'already_confirmed';
  end if;
  begin
    if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 200 then
      raise exception 'invalid_lines' using errcode = '22023';
    end if;
    v_def_store := nullif(btrim(j.result ->> 'store'), '');
    v_def_date := (nullif(j.result ->> 'date', ''))::date;
    v_def_cur := coalesce(nullif(j.result ->> 'currency', ''), j.input ->> 'currency');
    for ln in select e from jsonb_array_elements(p_lines) e loop
      if jsonb_typeof(ln) is distinct from 'object' or (ln ->> 'action') is null or (ln ->> 'action') not in ('new', 'match', 'skip') then
        raise exception 'invalid_lines' using errcode = '22023';
      end if;
      v_action := ln ->> 'action';
      if v_action = 'skip' then
        -- WO-0092: a skip line is checked for unknown keys too
        if exists (select 1 from jsonb_object_keys(ln) k where k <> all (v_skip_keys)) then
          raise exception 'invalid_lines' using errcode = '22023';
        end if;
        continue;
      end if;
      v_cat := (ln ->> 'catalog_item_id')::uuid;
      if (v_action = 'match') is distinct from (v_cat is not null) or ln -> 'amount' is null or jsonb_typeof(ln -> 'amount') <> 'number' then
        raise exception 'invalid_lines' using errcode = '22023';
      end if;
      v_qty := coalesce((ln ->> 'qty')::int, 1);
      v_amount := (ln ->> 'amount')::numeric;
      -- WO-0092: the amount must be finite (NaN sorts above Infinity, so `>= Infinity` refuses both)
      if v_qty not between 1 and 999 or v_amount < 0 or v_amount >= 'Infinity'::numeric then
        raise exception 'invalid_lines' using errcode = '22023';
      end if;
      v_store := coalesce(nullif(btrim(ln ->> 'store'), ''), v_def_store);
      v_date := coalesce((ln ->> 'date')::date, v_def_date);
      v_cur := coalesce(ln ->> 'currency', v_def_cur);
      v_item := app.insert_item_from_json(ln - array['action', 'qty', 'amount', 'catalog_item_id', 'store', 'date', 'currency'], 'receipt', v_cat);
      v_pur := app.insert_purchase_from_json(v_item, jsonb_build_object('purchase_date', v_date, 'store', v_store,
                 'price', round(v_amount / v_qty, 2), 'currency', v_cur, 'quantity', v_qty));
      insert into app.purchase_receipts (purchase_id, receipt_id, user_id) values (v_pur, r.id, (select auth.uid()));
      v_items := v_items || v_item;
      v_purs := v_purs || v_pur;
      v_total := v_total + v_amount;
      if v_first then
        v_h_store := v_store; v_h_date := v_date; v_h_cur := v_cur; v_first := false;
      end if;
    end loop;
    update app.receipts x set store = case when v_first then v_def_store else v_h_store end,
                              receipt_date = case when v_first then v_def_date else v_h_date end,
                              currency = case when v_first then v_def_cur else v_h_cur end,
                              total = v_total, job_id = j.id, confirmed_at = now()
     where x.id = r.id;
  exception when data_exception or integrity_constraint_violation then
    raise exception 'invalid_lines' using errcode = '22023';
  end;
  return jsonb_build_object('receipt_id', r.id, 'items', to_jsonb(v_items), 'purchases', to_jsonb(v_purs));
end $$;

create or replace function analytics.run_aggregation() returns bigint
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
revoke execute on function analytics.run_aggregation() from public, anon, authenticated, service_role;
