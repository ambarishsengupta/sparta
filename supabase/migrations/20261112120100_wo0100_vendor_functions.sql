-- WO-0100 (R7a) migration 2: the vendor guard, the query log writer and the first three vendor functions (LLD 5.4, 5.7; FR-72, FR-77, FR-80, FR-88).
-- One guard (analytics_private.vendor_guard) holds the checks, in this order: role, agreement, maintenance, log_and_limit. Every vendor function calls it first;
-- later work orders add functions, never a second copy of the checks. The internal q_* functions read only the published cube and only rows with
-- users_floor >= min_group_size (the second minimum-group check), and return rounded values only. The wrappers in schema analytics are thin: guard, then q_*.
-- Names are whitelisted with case expressions and values are plain parameters: no dynamic SQL anywhere. All functions are security definer or internal,
-- search_path = '' (every name schema-qualified). A call that raises rolls back its own log row, so refused calls leave no row (LLD 5.7).
-- Decisions where the documents are silent (workflow/evidence/R7/WO-0100-NOTES.md): `forbidden` carries SQLSTATE 42501 like every other `forbidden` in the
-- schema, the other codes use P0001; maintenance fails closed (anything but 'off', or no setting, refuses); coverage reads the run row (the cube has no total row).

-- LLD 5.7: counts the calls of all users of one vendor together, one vendor at a time (advisory lock), 200 an hour; zero or several memberships fail
create function analytics.log_and_limit(p_fn text, p_params jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_n int; v_vendor uuid;
begin
  select count(*), (array_agg(m.vendor_id))[1] into v_n, v_vendor from catalog.vendor_members m where m.user_id = (select auth.uid());
  if v_n is distinct from 1 then raise exception 'forbidden' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vendor_query_log:' || v_vendor::text, 0));
  if (select count(*) from ops.vendor_query_log l where l.vendor_id = v_vendor and l.called_at > now() - interval '1 hour') >= 200 then
    raise exception 'rate_limited';
  end if;
  insert into ops.vendor_query_log (vendor_id, user_id, fn, params) values (v_vendor, (select auth.uid()), p_fn, p_params);
end $$;

create function analytics_private.vendor_guard(p_fn text, p_params jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if (select app.current_role()) is distinct from 'vendor' then raise exception 'forbidden' using errcode = '42501'; end if;   -- a caller with no profile has a null role
  if not exists (select 1 from catalog.vendor_agreement_acceptances a where a.user_id = (select auth.uid())
                 and a.version = (select s.value from ops.settings s where s.key = 'current_vendor_agreement_version')) then
    raise exception 'agreement_required';
  end if;
  if coalesce((select s.value from ops.settings s where s.key = 'maintenance'), 'on') <> 'off' then raise exception 'maintenance'; end if;
  perform analytics.log_and_limit(p_fn, p_params);
end $$;

-- FR-72: one row per segment of the latest owned period. A dimension picks which of the four d_ columns are set; one optional filter picks one f_ column and its value.
create function analytics_private.q_ownership_mix(p_dim text, p_filter_dim text, p_filter_value text) returns table (segment text, users_rounded int)
language plpgsql stable set search_path = '' as $$
declare
  v_mask text := case p_dim when 'category' then '1000' when 'colour_family' then '0100' when 'fit' then '0010' when 'brand' then '0001'
    when 'category_colour_family' then '1100' when 'category_fit' then '1010' when 'category_brand' then '1001' end;
  v_fmask text := case when p_filter_dim is null then '0000' else case p_filter_dim when 'size' then '1000' when 'season' then '0100' when 'price_band' then '0010' when 'region' then '0001' end end;
  v_min int := (select s.value::int from ops.settings s where s.key = 'min_group_size');
  v_period date;
begin
  if v_mask is null or v_fmask is null or (p_filter_dim is null) <> (p_filter_value is null) or char_length(p_filter_value) > 100 then
    raise exception 'invalid_dimension';
  end if;
  select max(c.period) into v_period from analytics.cube c where c.kind = 'owned';   -- the latest period the cube holds; a stale month is never shown as current
  return query
    select concat_ws(' / ', c.d_category, c.d_colour_family, c.d_fit, c.d_brand), c.users_rounded
    from analytics.cube c
    where c.kind = 'owned' and c.period = v_period and c.condition_band is null and c.users_floor >= v_min
      and (c.d_category is not null) = (substr(v_mask, 1, 1) = '1') and (c.d_colour_family is not null) = (substr(v_mask, 2, 1) = '1')
      and (c.d_fit is not null) = (substr(v_mask, 3, 1) = '1') and (c.d_brand is not null) = (substr(v_mask, 4, 1) = '1')
      and (c.f_size is not null) = (substr(v_fmask, 1, 1) = '1') and (c.f_season is not null) = (substr(v_fmask, 2, 1) = '1')
      and (c.f_price_band is not null) = (substr(v_fmask, 3, 1) = '1') and (c.f_region is not null) = (substr(v_fmask, 4, 1) = '1')
      and (p_filter_value is null or case p_filter_dim when 'size' then c.f_size when 'season' then c.f_season when 'price_band' then c.f_price_band else c.f_region end = p_filter_value)
    order by 1;
end $$;

-- Dashboard header: the cohort of the last good run rounded to 5 (null when it is under the minimum group size) and when that run finished.
-- The cube has no total row, so the cohort comes from the run row, with the same floor test as users_floor (5.3 step 3).
create function analytics_private.q_coverage() returns table (users_rounded int, last_run_at timestamptz)
language plpgsql stable set search_path = '' as $$
declare v_min int := (select s.value::int from ops.settings s where s.key = 'min_group_size'); v_users int; v_at timestamptz;
begin
  select a.users_included, a.finished_at into v_users, v_at from ops.aggregate_runs a where a.status = 'ok' order by a.id desc limit 1;
  return query select case when floor(v_users / 5.0) * 5 >= v_min then (round(v_users / 5.0) * 5)::int end, v_at;
end $$;

-- FR-77: the filter values that have at least one visible row
create function analytics_private.q_filter_options() returns table (filter_dim text, filter_value text)
language plpgsql stable set search_path = '' as $$
declare v_min int := (select s.value::int from ops.settings s where s.key = 'min_group_size');
begin
  return query select distinct v.fd, v.fv from analytics.cube c
    cross join lateral (values ('size', c.f_size), ('season', c.f_season), ('price_band', c.f_price_band), ('region', c.f_region)) v(fd, fv)
    where c.users_floor >= v_min and c.condition_band is null and v.fv is not null order by 1, 2;
end $$;

create function analytics.ownership_mix(p_dim text, p_filter_dim text default null, p_filter_value text default null) returns table (segment text, users_rounded int)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform analytics_private.vendor_guard('ownership_mix', jsonb_build_object('dim', p_dim, 'filter_dim', p_filter_dim, 'filter_value', p_filter_value));
  return query select * from analytics_private.q_ownership_mix(p_dim, p_filter_dim, p_filter_value);
end $$;
create function analytics.coverage() returns table (users_rounded int, last_run_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform analytics_private.vendor_guard('coverage', '{}'::jsonb);
  return query select * from analytics_private.q_coverage();
end $$;
create function analytics.filter_options() returns table (filter_dim text, filter_value text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform analytics_private.vendor_guard('filter_options', '{}'::jsonb);
  return query select * from analytics_private.q_filter_options();
end $$;

-- the log writer, the guard and the q_* functions are reached only from definer functions (their owner): no client role may execute them
revoke execute on function analytics.log_and_limit(text, jsonb), analytics_private.vendor_guard(text, jsonb), analytics_private.q_ownership_mix(text, text, text),
  analytics_private.q_coverage(), analytics_private.q_filter_options() from public, anon, authenticated, service_role;
revoke execute on function analytics.ownership_mix(text, text, text), analytics.coverage(), analytics.filter_options() from public, anon, service_role;
grant execute on function analytics.ownership_mix(text, text, text), analytics.coverage(), analytics.filter_options() to authenticated;
