-- WO-0098 (R7a) migration 2: analytics_private.build_facts(p_salt) implements LLD 5.1 steps 3 and 4 (FR-83, FR-84, FR-85, FR-87, FR-63).
-- Set-based, security definer, search_path = '' (every name schema-qualified). It rebuilds analytics_private.facts from scratch for ELIGIBLE users only
-- (role consumer, not deleting, ops.is_eligible) from app.items, app.wishlist_entries and app.purchases, and from nothing else: never a receipt, an outfit
-- log, an item_features row or a job result. The salt is a parameter and is never stored; the run function (WO-0099) draws a new one every run.
-- Returns the number of fact rows written. The grouped columns are never null: an empty value is stored as 'Unknown' (brand and size: see below).
create function analytics_private.build_facts(p_salt text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', now() at time zone 'UTC')::date;   -- the period of owned and wishlist_open facts
  v_rows int;
begin
  if coalesce(p_salt, '') = '' then
    raise exception 'invalid_salt' using errcode = '22023';
  end if;
  truncate analytics_private.facts;

  insert into analytics_private.facts (user_hash, kind, period, category, sub_type, colour_family, fit, brand, size, season, price_band, condition_band, region)
  with elig as (            -- LLD 5.1 step 3; ops.is_eligible also checks consent, age, country and documents
    select p.id, p.country from app.profiles p
    where p.role = 'consumer' and not p.deleting and ops.is_eligible(p.id)
  ), src as (               -- one row per fact; a purchase takes its attributes from the linked item, archived or not
    select 'owned'::text as kind, v_month as period, i.user_id, i.category, i.sub_type, i.colour_family, i.fit, i.brand as brand_text,
           i.size_system, i.size_value, i.seasons, i.price, i.currency, i.condition
      from app.items i where i.status = 'active'
    union all
    select 'wishlist_open', v_month, w.user_id, w.category, w.sub_type, w.colour_family, w.fit, w.brand,
           w.size_system, w.size_value, w.seasons, w.target_price, w.currency, null
      from app.wishlist_entries w where w.status = 'open' and w.origin = 'user'
    union all
    select 'wishlist', date_trunc('month', w.created_at at time zone 'UTC')::date, w.user_id, w.category, w.sub_type, w.colour_family, w.fit, w.brand,
           w.size_system, w.size_value, w.seasons, w.target_price, w.currency, null
      from app.wishlist_entries w where w.origin = 'user'
    union all
    select 'purchase', date_trunc('month', coalesce(pu.purchase_date::timestamp, pu.created_at at time zone 'UTC'))::date, pu.user_id, i.category, i.sub_type,
           i.colour_family, i.fit, i.brand, i.size_system, i.size_value, i.seasons, pu.price, pu.currency, null
      from app.purchases pu join app.items i on i.id = pu.item_id and i.user_id = pu.user_id
  ), norm as (              -- typed text compared ignoring case and all white space; empty after normalising counts as blank
    select s.*, lower(regexp_replace(coalesce(s.brand_text, ''), '[[:space:]]', '', 'g')) as n_brand,
           lower(regexp_replace(coalesce(s.size_value, ''), '[[:space:]]', '', 'g')) as n_size
      from src s
  ), brands as (            -- first code wins when two labels normalise alike, so a typed brand never fans out into two rows
    select distinct on (n) n, code from (select lower(regexp_replace(b.label, '[[:space:]]', '', 'g')) as n, b.code from catalog.lk_brand b) q order by n, code
  ), sizes as (
    select distinct on (size_system, n) size_system, n, code
      from (select z.size_system, lower(regexp_replace(z.code, '[[:space:]]', '', 'g')) as n, z.code from catalog.lk_size z) q order by size_system, n, code
  ), fx as (                -- the newest row per currency
    select distinct on (f.currency) f.currency, f.per_usd from ops.fx_rates f order by f.currency, f.rate_date desc
  )
  select encode(extensions.digest(n.user_id::text || p_salt, 'sha256'), 'hex'), n.kind, n.period,
         n.category, n.sub_type, coalesce(n.colour_family, 'Unknown'), coalesce(n.fit, 'Unknown'),
         case when n.n_brand = '' then 'Unknown' else coalesce(br.code, 'Other') end,
         case when n.n_size = '' then 'Unknown' else coalesce(sz.size_system || ':' || sz.code, 'Other') end,
         case when cardinality(n.seasons) = 0 or 'All year' = any (n.seasons) then 'All year'      -- never depends on the stored order
              when (select count(distinct x) from unnest(n.seasons) x) = 1 then (select min(x) from unnest(n.seasons) x)
              else 'Multi-season' end,
         case when u.usd is null then 'Unknown' when u.usd < 25 then '<25' when u.usd < 50 then '25-50'
              when u.usd < 100 then '50-100' when u.usd < 200 then '100-200' else '200+' end,
         case when n.kind = 'owned' then coalesce(cb.code, 'Unrated') end,
         coalesce(cr.region, 'Unknown')
  from norm n
  join elig e on e.id = n.user_id
  left join brands br on br.n = n.n_brand
  left join sizes sz on sz.size_system = n.size_system and sz.n = n.n_size
  left join fx on fx.currency = n.currency
  cross join lateral (select case when n.price is null or n.currency is null then null::numeric
                                  when n.currency = 'USD' then n.price else n.price / fx.per_usd end as usd) u
  left join catalog.lk_condition_band cb on n.kind = 'owned' and n.condition between cb.min_score and cb.max_score
  left join catalog.country_region cr on cr.country = e.country;

  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke execute on function analytics_private.build_facts(text) from public, anon, authenticated, service_role;
