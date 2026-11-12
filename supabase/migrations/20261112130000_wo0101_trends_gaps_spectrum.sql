-- WO-0101 (R7a): the trend, gaps and condition spectrum vendor functions (LLD 5.4; FR-73 to FR-77, FR-81, FR-84).
-- Every wrapper in schema analytics calls analytics_private.vendor_guard of WO-0100 first (role, agreement, maintenance, log and limit): there is no second copy of
-- those checks here. The internal q_* functions read only the published cube, only rows with users_floor >= min_group_size, and return rounded values only.
-- Names are whitelisted with case expressions, values are plain parameters, no dynamic SQL. All functions pin search_path = ''.
-- Decisions where the documents are silent (workflow/evidence/R7/WO-0101-NOTES.md): `trend` returns users_rounded for kind wishlist and events_rounded for kind
-- purchase (the other column is null); an unknown p_kind raises invalid_dimension; `gaps` adds a `label` column ('no visible ownership' or null); gaps rank
-- by score descending with null scores last, then by segment name; the condition spectrum returns every lk_condition_band row.

-- Shared reader of the trend and gaps functions: one kind, one dimension group, at most one filter; segments of the published, visible rows only.
create function analytics_private.q_cube_slice(p_kind text, p_dim text, p_filter_dim text, p_filter_value text)
returns table (period date, segment text, users_rounded int, events_rounded int)
language plpgsql stable set search_path = '' as $$
declare
  v_mask text := case p_dim when 'category' then '1000' when 'colour_family' then '0100' when 'fit' then '0010' when 'brand' then '0001'
    when 'category_colour_family' then '1100' when 'category_fit' then '1010' when 'category_brand' then '1001' end;
  v_fmask text := case when p_filter_dim is null then '0000' else case p_filter_dim when 'size' then '1000' when 'season' then '0100' when 'price_band' then '0010' when 'region' then '0001' end end;
  v_min int := (select s.value::int from ops.settings s where s.key = 'min_group_size');
begin
  if v_mask is null or v_fmask is null or (p_filter_dim is null) <> (p_filter_value is null) or char_length(p_filter_value) > 100 then
    raise exception 'invalid_dimension';
  end if;
  return query
    select c.period, concat_ws(' / ', c.d_category, c.d_colour_family, c.d_fit, c.d_brand), c.users_rounded, c.events_rounded
    from analytics.cube c
    where c.kind = p_kind and c.condition_band is null and c.users_floor >= v_min
      and (c.d_category is not null) = (substr(v_mask, 1, 1) = '1') and (c.d_colour_family is not null) = (substr(v_mask, 2, 1) = '1')
      and (c.d_fit is not null) = (substr(v_mask, 3, 1) = '1') and (c.d_brand is not null) = (substr(v_mask, 4, 1) = '1')
      and (c.f_size is not null) = (substr(v_fmask, 1, 1) = '1') and (c.f_season is not null) = (substr(v_fmask, 2, 1) = '1')
      and (c.f_price_band is not null) = (substr(v_fmask, 3, 1) = '1') and (c.f_region is not null) = (substr(v_fmask, 4, 1) = '1')
      and (p_filter_value is null or case p_filter_dim when 'size' then c.f_size when 'season' then c.f_season when 'price_band' then c.f_price_band else c.f_region end = p_filter_value);
end $$;

-- FR-73 / FR-74: the monthly rows of a kind; a month whose row was suppressed is simply absent. Only the month period exists (LLD 5.4).
create function analytics_private.q_trend(p_kind text, p_dim text, p_period_unit text, p_filter_dim text, p_filter_value text)
returns table (period date, segment text, users_rounded int, events_rounded int)
language plpgsql stable set search_path = '' as $$
begin
  if p_kind is null or p_kind not in ('purchase', 'wishlist') then raise exception 'invalid_dimension'; end if;
  if p_period_unit is distinct from 'month' then raise exception 'unsupported_period'; end if;
  return query
    select s.period, s.segment, case when p_kind = 'wishlist' then s.users_rounded end, case when p_kind = 'purchase' then s.events_rounded end
    from analytics_private.q_cube_slice(p_kind, p_dim, p_filter_dim, p_filter_value) s order by 1, 2;
end $$;

-- FR-75 / FR-81: wishlist_open users over owned users of the current period, both the published rounded values. A segment is listed only when its wishlist
-- row is visible; an owner row that is missing, hidden or zero gives a null score and the label. The period is the latest one the two kinds hold, shared by both.
create function analytics_private.q_gaps(p_dim text, p_filter_dim text, p_filter_value text, p_top_n int)
returns table (segment text, owner_users_rounded int, wishlist_users_rounded int, gap_score numeric, label text)
language plpgsql stable set search_path = '' as $$
begin
  if p_top_n is null or p_top_n not between 1 and 50 then raise exception 'invalid_top_n'; end if;
  return query
    with w as (select x.period, x.segment, x.users_rounded from analytics_private.q_cube_slice('wishlist_open', p_dim, p_filter_dim, p_filter_value) x),
         o as (select x.period, x.segment, x.users_rounded from analytics_private.q_cube_slice('owned', p_dim, p_filter_dim, p_filter_value) x),
         cur as (select max(y.period) p from (select w.period from w union all select o.period from o) y)
    select w.segment, o.users_rounded, w.users_rounded, round(w.users_rounded::numeric / nullif(o.users_rounded, 0), 1),
           case when coalesce(o.users_rounded, 0) = 0 then 'no visible ownership' end
    from w left join o on o.segment = w.segment and o.period = w.period
    where w.period = (select cur.p from cur)
    order by 4 desc nulls last, 1 limit p_top_n;
end $$;

-- FR-76: the visible condition bands of one category (owned, rated, no other attribute, latest period). Shares are events_rounded over the sum of the visible
-- bands, to the nearest 5 points; fewer than two visible bands gives every band a null share. Every lk_condition_band row comes back.
create function analytics_private.q_condition_spectrum(p_category text) returns table (band text, share int)
language plpgsql stable set search_path = '' as $$
declare v_min int := (select s.value::int from ops.settings s where s.key = 'min_group_size'); v_period date;
begin
  if char_length(p_category) > 100 then raise exception 'invalid_dimension'; end if;
  select max(c.period) into v_period from analytics.cube c where c.kind = 'owned' and c.condition_band is not null;
  return query
    with v as (select c.condition_band b, c.events_rounded e from analytics.cube c
               where c.kind = 'owned' and c.period = v_period and c.condition_band is not null and c.condition_band <> 'Unrated' and c.users_floor >= v_min
                 and c.d_category = p_category and c.d_colour_family is null and c.d_fit is null and c.d_brand is null
                 and c.f_size is null and c.f_season is null and c.f_price_band is null and c.f_region is null),
         t as (select count(*) n, sum(v.e) s from v)
    select l.code, case when t.n >= 2 and t.s > 0 then (round(100.0 * v.e / t.s / 5) * 5)::int end
    from catalog.lk_condition_band l left join v on v.b = l.code cross join t order by l.sort, l.code;
end $$;

create function analytics.trend(p_kind text, p_dim text, p_period_unit text default 'month', p_filter_dim text default null, p_filter_value text default null)
returns table (period date, segment text, users_rounded int, events_rounded int)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform analytics_private.vendor_guard('trend', jsonb_build_object('kind', p_kind, 'dim', p_dim, 'period_unit', p_period_unit, 'filter_dim', p_filter_dim, 'filter_value', p_filter_value));
  return query select * from analytics_private.q_trend(p_kind, p_dim, p_period_unit, p_filter_dim, p_filter_value);
end $$;
create function analytics.gaps(p_dim text, p_filter_dim text default null, p_filter_value text default null, p_top_n int default 20)
returns table (segment text, owner_users_rounded int, wishlist_users_rounded int, gap_score numeric, label text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform analytics_private.vendor_guard('gaps', jsonb_build_object('dim', p_dim, 'filter_dim', p_filter_dim, 'filter_value', p_filter_value, 'top_n', p_top_n));
  return query select * from analytics_private.q_gaps(p_dim, p_filter_dim, p_filter_value, p_top_n);
end $$;
create function analytics.condition_spectrum(p_category text) returns table (band text, share int)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform analytics_private.vendor_guard('condition_spectrum', jsonb_build_object('category', p_category));
  return query select * from analytics_private.q_condition_spectrum(p_category);
end $$;

revoke execute on function analytics_private.q_cube_slice(text, text, text, text), analytics_private.q_trend(text, text, text, text, text),
  analytics_private.q_gaps(text, text, text, int), analytics_private.q_condition_spectrum(text) from public, anon, authenticated, service_role;
revoke execute on function analytics.trend(text, text, text, text, text), analytics.gaps(text, text, text, int), analytics.condition_spectrum(text) from public, anon, service_role;
grant execute on function analytics.trend(text, text, text, text, text), analytics.gaps(text, text, text, int), analytics.condition_spectrum(text) to authenticated;
